import { describe, expect, test } from 'vitest';
import { isSensitive } from '@/core/sensitive';
import { dHashFromGray, hamming, textHash } from '@/core/imagehash';

describe('sensitive pages (D6)', () => {
  test.each([
    ['https://www.sparkasse.de/konto', true],
    ['https://onlinebanking.example.com/', true],
    ['https://my-bank.example.org/', true],
    ['https://www.paypal.com/myaccount', true],
    ['https://vault.bitwarden.com/', true],
    ['https://shop.example.com/checkout/step1', true],
    ['https://example.com/pay', true],
    ['https://en.wikipedia.org/wiki/Bank', false],
    ['https://banksy.co.uk/', false],
    ['https://github.com/', false],
  ])('%s → %s', (url, expected) => {
    expect(isSensitive(url)).toBe(expected);
  });

  test('user hosts: plain entries include subdomains, *. entries only subdomains', () => {
    expect(isSensitive('https://mail.corp.example/', ['corp.example'])).toBe(true);
    expect(isSensitive('https://corp.example/', ['*.corp.example'])).toBe(false);
    expect(isSensitive('https://a.corp.example/', ['*.corp.example'])).toBe(true);
  });
});

describe('dHash', () => {
  const ramp = Array.from({ length: 72 }, (_, i) => (i % 9) * 10); // brightening left to right
  test('identical images have distance 0, opposite gradients 64', () => {
    const a = dHashFromGray(ramp);
    const b = dHashFromGray(ramp.map((x) => 80 - x));
    expect(hamming(a, a)).toBe(0);
    expect(hamming(a, b)).toBe(64);
  });
  test('a small change moves only a few bits', () => {
    const noisy = [...ramp];
    noisy[40] = 100;
    expect(hamming(dHashFromGray(ramp), dHashFromGray(noisy))).toBeLessThanOrEqual(2);
  });
  test('text hash differs for different text', () => {
    expect(textHash('abc')).not.toBe(textHash('abd'));
  });
});
