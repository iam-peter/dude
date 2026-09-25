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
import { Service } from '@/background/service';
import type { Request } from '@/background/protocol';
import { installS1Recorder } from '@/spike/s1-recorder';
import { installS2Probe } from '@/spike/s2-capture';

export default defineBackground(() => {
  const service = new Service();
  const settings = new LiveSettings();
  const recorder = installRecorder(service, settings);
  installCapture(service, settings);
  installMaintenance(service, settings);
  const nav = installNavigation(service);
  installS1Recorder();
  installS2Probe();

  // First run: explain what is recorded and which permissions are for what (H1).
  browser.runtime.onInstalled.addListener((d) => {
    if (d.reason === 'install') browser.tabs.create({ url: browser.runtime.getURL('/options.html#welcome') });
  });

  browser.runtime.onMessage.addListener((msg: Request, _sender, sendResponse) => {
    const reply = (p: Promise<unknown>) => {
      p.then(sendResponse, (e) => sendResponse({ error: String(e) }));
      return true;
    };
    switch (msg?.cmd) {
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
      case 'dude.quickSearch':
        return reply(service.quickSearch(msg.q));
      case 'dude.debug':
        return reply(service.debug());
      case 'dude.describeSince':
        return reply(service.describeSince(msg.since, msg.media));
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
      case 'dude.setDenyHosts':
        return reply(browser.storage.local.set({ 'dude.denyHosts': msg.hosts }).then(() => settings.ready).then(() => true));
      case 'dude.grepLog':
        return reply(service.grepLog(msg.needle));
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
