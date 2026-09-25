// Firefox self-hosted updates: the signed xpi files and updates.json live on the `updates`
// branch of the public GitHub repository and are read through raw.githubusercontent.com.
// https://extensionworkshop.com/documentation/manage/updating-your-extension/
import crypto from 'node:crypto';
import fs from 'node:fs';

export const REPO = 'iam-peter/dude';
export const UPDATES_BRANCH = 'updates';
export const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/${UPDATES_BRANCH}`;
/** Must match browser_specific_settings.gecko.update_url in wxt.config.ts (checked by check-release). */
export const UPDATE_URL = `${RAW_BASE}/updates.json`;

export const xpiName = (version) => `dude-${version}.xpi`;

export const sha256Of = (file) => `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;

const cmpVersion = (a, b) => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
};

/** updates.json with `version` added (or replaced), oldest first; `manifest` is not modified. */
export function addRelease(manifest, { id, version, hash, minVersion }) {
  const old = manifest?.addons?.[id]?.updates ?? [];
  const entry = {
    version,
    update_link: `${RAW_BASE}/${xpiName(version)}`,
    update_hash: hash,
    ...(minVersion ? { applications: { gecko: { strict_min_version: minVersion } } } : {}),
  };
  const updates = [...old.filter((u) => u.version !== version), entry].sort((a, b) => cmpVersion(a.version, b.version));
  return { addons: { ...manifest?.addons, [id]: { updates } } };
}
