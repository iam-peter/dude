// The AMO auth used for signing (scripts/lib/amo.mjs): tokens must stay under AMO's 300 s.
import { describe, expect, test } from 'vitest';
import { decodeJwt, decodeProtectedHeader, jwtVerify } from 'jose';
// @ts-expect-error plain JS module
import { ShortLivedJwtAuth, JWT_LIFETIME_S, submitAddon } from '../scripts/lib/amo.mjs';

describe('AMO signing auth', () => {
  const auth = new ShortLivedJwtAuth({ apiKey: 'user:1:2', apiSecret: 'not-a-real-secret' });

  test('lifetime is below the 300 s AMO allows, from a single clock reading', async () => {
    for (let i = 0; i < 50; i++) {
      const c = decodeJwt(await auth.signJWT());
      expect(c.exp! - c.iat!).toBe(JWT_LIFETIME_S);
    }
    expect(JWT_LIFETIME_S).toBeLessThan(300);
  });

  test('carries the issuer and a unique jti, HS256 over the secret', async () => {
    const [a, b] = [await auth.signJWT(), await auth.signJWT()];
    expect(decodeProtectedHeader(a).alg).toBe('HS256');
    expect(decodeJwt(a).iss).toBe('user:1:2');
    expect(decodeJwt(a).jti).not.toBe(decodeJwt(b).jti);
    await expect(jwtVerify(a, new TextEncoder().encode('not-a-real-secret'))).resolves.toBeTruthy();
    expect((await auth.getAuthHeader()).startsWith('JWT ')).toBe(true);
  });

  test('web-ext gets our auth class', async () => {
    let seen: unknown;
    await submitAddon({ xpiPath: 'x' }, async (opts: { ApiAuthClass: unknown }) => (seen = opts.ApiAuthClass));
    expect(seen).toBe(ShortLivedJwtAuth);
  });
});
