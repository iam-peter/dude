// Background: recorder → log → projector (SPEC §11). All listeners are registered
// synchronously here, as MV3 requires.
import { installRecorder } from '@/background/recorder';
import { installCapture } from '@/background/capture';
import { installMaintenance, run as runMaintenance } from '@/background/maintenance';
import { installNavigation } from '@/background/navigate';
import { Service } from '@/background/service';
import type { Request } from '@/background/protocol';
import { installS1Recorder } from '@/spike/s1-recorder';
import { installS2Probe } from '@/spike/s2-capture';

export default defineBackground(() => {
  const service = new Service();
  installRecorder(service);
  installCapture(service);
  installMaintenance(service);
  const nav = installNavigation(service);
  installS1Recorder();
  installS2Probe();

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
      case 'dude.maintenance':
        return reply(runMaintenance(service));
      case 'dude.rebuild':
        return reply(service.rebuild().then(() => true));
      default:
        return undefined;
    }
  });
});
