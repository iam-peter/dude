// Sign the Firefox build as an unlisted add-on through AMO's v5 submission API, via
// web-ext's `sign` used as a library.
//
// Why not plain `web-ext sign`: it signs each API request with a JWT valid for exactly
// 300 s, AMO's maximum, and jose reads the clock separately for `iat` and `exp`. When a
// second boundary falls between the two reads the token claims 301 s and AMO answers
// "JWT exp (expiration) is too long" — rare per request, but web-ext polls the validation
// every second, so over a run it becomes likely. The auth class here reads the clock once
// and stays well under the limit.

import crypto from 'node:crypto';
import { SignJWT } from 'jose';
import { cmd } from 'web-ext';
import { signAddon } from 'web-ext/util/submit-addon';

export const AMO_BASE_URL = 'https://addons.mozilla.org/api/v5/';
export const JWT_LIFETIME_S = 240; // AMO allows at most 300

export class ShortLivedJwtAuth {
  #apiKey;
  #secret;
  constructor({ apiKey, apiSecret }) {
    this.#apiKey = apiKey;
    this.#secret = new TextEncoder().encode(apiSecret);
  }
  async signJWT(now = Math.floor(Date.now() / 1000)) {
    return new SignJWT({ iss: this.#apiKey, jti: crypto.randomUUID() })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(now)
      .setExpirationTime(now + JWT_LIFETIME_S)
      .sign(this.#secret);
  }
  async getAuthHeader() {
    return `JWT ${await this.signJWT()}`;
  }
}

/** web-ext's signer, with our auth class; `signer` is replaceable for tests. */
export const submitAddon = (opts, signer = signAddon) => signer({ ...opts, ApiAuthClass: ShortLivedJwtAuth });

export function signUnlisted({ sourceDir, artifactsDir, sourcesZip, apiKey, apiSecret, submit = submitAddon }) {
  return cmd.sign(
    {
      amoBaseUrl: AMO_BASE_URL,
      apiKey,
      apiSecret,
      artifactsDir,
      sourceDir,
      channel: 'unlisted',
      uploadSourceCode: sourcesZip,
      timeout: 15 * 60_000, // validation
      approvalTimeout: 15 * 60_000, // automatic signing of unlisted add-ons is usually minutes
    },
    { submitAddon: submit },
  );
}
