import { describe, expect, test } from 'vitest';
import { fromExtensionPage, fromTestRelay } from '@/background/trust';

const BASE = 'moz-extension://d0de5100-0000-4000-8000-000000000001/';
const ID = '{53952834-ba6a-4072-9c32-c836b5a38a3c}';

describe('who may command the background', () => {
  test('extension pages may', () => {
    expect(fromExtensionPage({ id: ID, url: `${BASE}sessions.html?session=s1` }, BASE, ID)).toBe(true);
    expect(fromExtensionPage({ id: ID, url: `${BASE}popup.html` }, BASE, ID)).toBe(true);
  });

  test('content scripts in web pages may not, even our own', () => {
    expect(fromExtensionPage({ id: ID, url: 'https://evil.example/', tab: { id: 3 } }, BASE, ID)).toBe(false);
    expect(fromExtensionPage({ id: ID, url: 'http://localhost:8765/s1-control', tab: { id: 3 } }, BASE, ID)).toBe(false);
  });

  test('another extension may not', () => {
    expect(fromExtensionPage({ id: 'other@ext', url: `${BASE}x.html` }, BASE, ID)).toBe(false);
  });

  test('a look-alike base URL may not', () => {
    expect(fromExtensionPage({ id: ID, url: 'moz-extension://d0de5100-0000-4000-8000-0000000000012/x.html' }, BASE, ID)).toBe(false);
  });

  test('the automation relay only in test builds, only from the control page', () => {
    const control = 'http://localhost:8765/s1-control';
    expect(fromTestRelay({ url: control }, true, control)).toBe(true);
    expect(fromTestRelay({ url: control }, false, control)).toBe(false);
    expect(fromTestRelay({ url: 'http://localhost:8765/a' }, true, control)).toBe(false);
  });
});
