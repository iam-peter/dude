// Who may send which command to the background. The history can be read, rewritten and
// deleted through these messages, so they are accepted only from the extension's own
// pages (popup, sidebar, sessions app, settings) — never from content scripts, which run
// inside web pages. Page data from our content scripts goes through separate listeners
// that only record it for the sending tab (recorder.ts, capture.ts).

export interface Sender {
  id?: string;
  url?: string;
  tab?: { id?: number };
}

/** A page of this extension: its URL is under the extension's own base URL. */
export function fromExtensionPage(sender: Sender, extensionBase: string, extensionId: string): boolean {
  return sender.id === extensionId && !!sender.url?.startsWith(extensionBase);
}

/** Test builds only: the automation relay on the test site's control page (S1 Firefox driver). */
export function fromTestRelay(sender: Sender, testHooks: boolean, controlUrl: string): boolean {
  return testHooks && !!sender.url && sender.url.split('?')[0] === controlUrl;
}
