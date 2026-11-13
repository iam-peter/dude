// Publish a signed Firefox release to the `updates` branch (see updates.mjs), without touching
// the working tree: the commit is built with git plumbing on top of origin/updates.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { UPDATES_BRANCH, addRelease, sha256Of, xpiName } from './updates.mjs';

const gitIn = (cwd) => (args, input) => execFileSync('git', args, { cwd, encoding: 'utf8', input, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] }).trim();

/** Throws when the release can't be published; run before signing so no AMO version is spent on it. */
export function checkPublishable(version, cwd = process.cwd()) {
  const git = gitIn(cwd);
  const gitOk = (args) => {
    try {
      git(args);
      return true;
    } catch {
      return false;
    }
  };
  if (git(['status', '--porcelain'])) throw new Error('uncommitted changes: publish only a committed state, so the tag matches the build');
  if (gitOk(['rev-parse', '-q', '--verify', `refs/tags/v${version}`])) throw new Error(`tag v${version} exists already: bump the version first`);
  if (git(['ls-remote', '--tags', 'origin', `v${version}`])) throw new Error(`tag v${version} exists on origin already: bump the version first`);
}

export function publishUpdate({ xpi, id, version, minVersion, cwd = process.cwd() }) {
  const git = gitIn(cwd);
  const hasBranch = !!git(['ls-remote', '--heads', 'origin', UPDATES_BRANCH]);
  const parent = hasBranch ? (git(['fetch', '-q', 'origin', UPDATES_BRANCH]), git(['rev-parse', 'FETCH_HEAD'])) : undefined;

  const entries = new Map(); // name → mktree line
  if (parent) for (const line of git(['ls-tree', parent]).split('\n').filter(Boolean)) entries.set(line.split('\t')[1], line);
  const manifest = entries.has('updates.json') ? JSON.parse(git(['show', `${parent}:updates.json`])) : {};
  const json = JSON.stringify(addRelease(manifest, { id, version, hash: sha256Of(xpi), minVersion }), null, 2) + '\n';

  entries.set(xpiName(version), `100644 blob ${git(['hash-object', '-w', xpi])}\t${xpiName(version)}`);
  entries.set('updates.json', `100644 blob ${git(['hash-object', '-w', '--stdin'], json)}\tupdates.json`);
  const tree = git(['mktree'], [...entries.values()].join('\n') + '\n');
  const commit = git(['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', `Release dude ${version}`]);

  // One push for both refs, and the local tag only after it: a failed push can simply be retried.
  execFileSync('git', ['push', '--atomic', 'origin', `${commit}:refs/heads/${UPDATES_BRANCH}`, `HEAD:refs/tags/v${version}`], { cwd, stdio: 'inherit' });
  git(['tag', `v${version}`, 'HEAD']);
}

export const releaseNotes = (version) => `Prebuilt packages of dude ${version}.

- **Firefox:** download \`${xpiName(version)}\` (signed by Mozilla as an unlisted add-on), then \`about:addons\` → ⚙ → *Install Add-on From File*. It updates itself from then on.
- **Chrome:** download \`dude-${version}-chrome.zip\` and unzip it. In \`chrome://extensions\` turn on *Developer mode*, choose *Load unpacked* and pick the unzipped folder. Keep the folder: Chrome loads it from there.`;

const ghCli = (args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/**
 * A GitHub release for the tag v<version>, with the signed xpi and the Chrome zip attached, so
 * nobody has to build dude to try it. Needs the gh CLI (GH_TOKEN in CI); skips a release that
 * exists already, so a rerun only adds what is missing.
 */
export function publishGithubRelease({ version, xpi, chromeZip, gh = ghCli }) {
  const tag = `v${version}`;
  try {
    gh(['release', 'view', tag, '--json', 'tagName']);
    console.log(`GitHub release ${tag} exists already`);
    return false;
  } catch {
    /* not there yet */
  }
  // The signed xpi is named after the AMO id; attach it under the same name as on the updates branch.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-release-'));
  try {
    const named = path.join(dir, xpiName(version));
    fs.copyFileSync(xpi, named);
    gh(['release', 'create', tag, '--verify-tag', '--title', `dude ${version}`, '--notes', releaseNotes(version), named, chromeZip]);
    return true;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
