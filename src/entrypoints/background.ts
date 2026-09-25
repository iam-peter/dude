// Background: recorder → log → projector (SPEC §11). All listeners are registered
// synchronously here, as MV3 requires.
import { installRecorder } from '@/background/recorder';
import { installCapture } from '@/background/capture';
import { installMaintenance, run as runMaintenance } from '@/background/maintenance';
import { installNavigation } from '@/background/navigate';
import { LiveSettings } from '@/background/settings';
import { importChromeHistory } from '@/background/history-import';
import { REPORT_KEY } from '@/background/maintenance';
import { getMeta } from '@/storage/db';
import { fromExtensionPage, fromTestRelay } from '@/background/trust';
import { SITE } from '@/spike/site';
import { Service } from '@/background/service';
import type { Request } from '@/background/protocol';
import { installS1Recorder } from '@/spike/s1-recorder';
import { installS2Probe } from '@/spike/s2-capture';

export default defineBackground(() => {
  const service = new Service();
  const settings = new LiveSettings();
  const recorder = installRecorder(service, settings);
  const capture = installCapture(service, settings);
  installMaintenance(service, settings);
  const nav = installNavigation(service);
  if (__DUDE_TEST_HOOKS__) {
    // Spike tooling, compiled in only for test builds (wxt.config.ts).
    installS1Recorder();
    installS2Probe();
  }

  // First run: explain what is recorded and which permissions are for what (H1).
  browser.runtime.onInstalled.addListener((d) => {
    if (d.reason === 'install') browser.tabs.create({ url: browser.runtime.getURL('/options.html#welcome') });
  });

  const extensionBase = browser.runtime.getURL('/');
  // Compiled out of normal builds entirely, together with the test site's address.
  const testRelay = (sender: Browser.runtime.MessageSender) => __DUDE_TEST_HOOKS__ && fromTestRelay(sender, true, `${SITE}/s1-control`);

  browser.runtime.onMessage.addListener((msg: Request, sender, sendResponse) => {
    // Only the extension's own pages may use these commands (see trust.ts); in test builds
    // also the automation relay.
    if (!msg?.cmd?.startsWith('dude.')) return undefined;
    if (!fromExtensionPage(sender, extensionBase, browser.runtime.id) && !testRelay(sender)) {
      console.warn('dude: refused', msg.cmd, 'from', sender.url);
      return undefined;
    }
    const reply = (p: Promise<unknown>) => {
      p.then(sendResponse, (e) => sendResponse({ error: String(e) }));
      return true;
    };
    if (__DUDE_TEST_HOOKS__) {
      // Commands only the automation uses.
      switch (msg.cmd) {
        case 'dude.describeSince':
          return reply(service.describeSince(msg.since, msg.media));
        case 'dude.quickSearch':
          return reply(service.quickSearch(msg.q));
        case 'dude.setDenyHosts':
          return reply(browser.storage.local.set({ 'dude.denyHosts': msg.hosts }).then(() => settings.ready).then(() => true));
        case 'dude.grepLog':
          return reply(service.grepLog(msg.needle));
      }
    }
    switch (msg.cmd) {
      case 'dude.session':
        return reply(service.session(msg));
      case 'dude.sessions':
        return reply(service.sessions(msg));
      case 'dude.open':
        return reply(nav.open(msg.url, msg.visitId).then(() => true));
      case 'dude.openPath':
        return reply(nav.openPath(msg.visitId));
      case 'dude.openPath.cancel':
        return reply(Promise.resolve(nav.cancel(msg.job)));
      case 'dude.semanticBack':
        return reply(nav.semanticBack(msg.tabId));
      case 'dude.pendingFocus':
        return reply(Promise.resolve(nav.takePendingFocus(msg.tabId)));
      case 'dude.searchDocs':
        return reply(service.searchDocs());
      case 'dude.debug':
        return reply(service.debug());
      case 'dude.pause':
        return reply(
          settings.setPaused(msg.paused, msg.tabId).then(() => {
            service.enqueue(() => [{ type: 'recorder.pause', t: Date.now(), tabId: msg.tabId, paused: msg.paused }]);
            return true;
          }),
        );
      case 'dude.pauseState':
        return reply(settings.ready.then(() => ({ global: settings.paused, tab: msg.tabId !== undefined && settings.pausedTabs.has(msg.tabId) })));
      case 'dude.maintenance':
        return reply(runMaintenance(service, settings));
      case 'dude.deleteAll':
        return reply(service.deleteAll().then(() => (recorder.restart(), true)));
      case 'dude.importLog':
        return reply(service.importLog(msg.observations).then((n) => (recorder.restart(), n)));
      case 'dude.importHistory':
        return reply(importChromeHistory(service, settings, msg.days));
      case 'dude.captureLog':
        return reply(Promise.resolve(capture.attempts()));
      case 'dude.storageReport':
        return reply(getMeta(REPORT_KEY));
      case 'dude.delete':
        // Real delete, then drop the deleted pages' images and texts right away.
        return reply(service.delete(msg.what).then((r) => runMaintenance(service, settings, 0).then(() => r)));
      case 'dude.rebuild':
        return reply(service.rebuild().then(() => true));
      default:
        return undefined;
    }
  });
});
