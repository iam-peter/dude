// S2 spike (SPEC §7.1, D1–D4): what do the capture APIs deliver, how fast, and can the
// background encode WebP thumbnails itself? Driven by scripts/s2/capture.mjs through the
// same control channels as S1. The average colour of a capture's centre tells which page
// was captured — the S2 test pages are solid colours.

type Rgb = [number, number, number];

interface CaptureResult {
  ok: boolean;
  ms: number;
  bytes?: number;
  w?: number;
  h?: number;
  avg?: Rgb;
  activeTabId?: number;
  error?: string;
}

type Msg =
  | { cmd: 's2.env' }
  | { cmd: 's2.capture'; how: 'visible' | 'tab'; windowId?: number; tabId?: number; n?: number }
  | { cmd: 's2.encode'; how: 'visible' | 'tab'; windowId?: number; tabId?: number };

const COMMANDS = new Set(['s2.env', 's2.capture', 's2.encode']);

interface CaptureApis {
  captureVisibleTab(windowId?: number, options?: { format?: string }): Promise<string>;
  captureTab?(tabId: number, options?: { format?: string }): Promise<string>;
}

export function installS2Probe() {
  const tabs = browser.tabs as unknown as CaptureApis;

  browser.runtime.onMessage.addListener((msg: Msg, _sender, sendResponse) => {
    if (!COMMANDS.has(msg?.cmd)) return undefined;
    handle(msg).then(sendResponse, (e) => sendResponse({ error: String(e) }));
    return true;
  });

  async function handle(msg: Msg): Promise<unknown> {
    switch (msg.cmd) {
      case 's2.env':
        return env();
      case 's2.capture': {
        const out: CaptureResult[] = [];
        for (let i = 0; i < (msg.n ?? 1); i++) out.push(await measure(msg));
        return out;
      }
      case 's2.encode':
        return encode(msg);
    }
  }

  async function grab(m: { how: 'visible' | 'tab'; windowId?: number; tabId?: number }): Promise<string> {
    if (m.how === 'tab') {
      if (!tabs.captureTab) throw new Error('tabs.captureTab not available');
      return tabs.captureTab(m.tabId!, { format: 'png' });
    }
    return tabs.captureVisibleTab(m.windowId, { format: 'png' });
  }

  async function measure(m: { how: 'visible' | 'tab'; windowId?: number; tabId?: number }): Promise<CaptureResult> {
    const [active] = await browser.tabs.query({ active: true, windowId: m.windowId ?? undefined, ...(m.windowId === undefined ? { lastFocusedWindow: true } : {}) });
    const t0 = performance.now();
    try {
      const url = await grab(m);
      const ms = performance.now() - t0;
      const bitmap = await createImageBitmap(await (await fetch(url)).blob());
      return { ok: true, ms: Math.round(ms), bytes: url.length, w: bitmap.width, h: bitmap.height, avg: centreColour(bitmap), activeTabId: active?.id };
    } catch (e) {
      return { ok: false, ms: Math.round(performance.now() - t0), error: String(e), activeTabId: active?.id };
    }
  }

  function centreColour(b: ImageBitmap): Rgb {
    const c = new OffscreenCanvas(40, 40);
    const g = c.getContext('2d')!;
    g.drawImage(b, b.width / 2 - 20, b.height / 2 - 20, 40, 40, 0, 0, 40, 40);
    const d = g.getImageData(0, 0, 40, 40).data;
    const sum: Rgb = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) sum[k] += d[i + k];
    const n = d.length / 4;
    return sum.map((x) => Math.round(x / n)) as Rgb;
  }

  async function env() {
    // convertToBlob throws on a canvas that never had a context, so draw into it first.
    let probe: Blob | undefined;
    if (typeof OffscreenCanvas !== 'undefined') {
      const c = new OffscreenCanvas(2, 2);
      c.getContext('2d')!.fillRect(0, 0, 1, 1);
      probe = await c.convertToBlob({ type: 'image/webp' }).catch(() => undefined);
    }
    return {
      context: typeof window === 'undefined' ? 'service worker' : 'event page',
      captureTab: typeof tabs.captureTab === 'function',
      offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
      createImageBitmap: typeof createImageBitmap !== 'undefined',
      // convertToBlob silently falls back to PNG when a type is unsupported.
      webpEncode: probe?.type ?? 'unavailable',
    };
  }

  /** Thumbnail ~320 px and preview ~1280 px wide, WebP (D4). */
  async function encode(m: { how: 'visible' | 'tab'; windowId?: number; tabId?: number }) {
    const url = await grab(m);
    const src = await createImageBitmap(await (await fetch(url)).blob());
    const out: Record<string, unknown> = { sourceBytes: url.length, source: [src.width, src.height] };
    for (const width of [320, 1280]) {
      const t0 = performance.now();
      const h = Math.round((src.height * width) / src.width);
      const c = new OffscreenCanvas(width, h);
      c.getContext('2d')!.drawImage(src, 0, 0, width, h);
      const blob = await c.convertToBlob({ type: 'image/webp', quality: 0.8 });
      out[`w${width}`] = { ms: Math.round(performance.now() - t0), bytes: blob.size, type: blob.type, size: [width, h] };
    }
    return out;
  }
}
