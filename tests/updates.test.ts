// Firefox self-hosted updates (scripts/lib/updates.mjs, publish.mjs): the updates.json
// format and the commit on the `updates` branch, against a throwaway repository.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
// @ts-expect-error plain JS module
import { addRelease, RAW_BASE, UPDATE_URL } from '../scripts/lib/updates.mjs';
// @ts-expect-error plain JS module
import { checkPublishable, publishUpdate } from '../scripts/lib/publish.mjs';

const ID = '{53952834-ba6a-4072-9c32-c836b5a38a3c}';

describe('updates.json', () => {
  test('adds versions in order and replaces a republished one', () => {
    let m = addRelease({}, { id: ID, version: '0.1.10', hash: 'sha256:a', minVersion: '140.0' });
    m = addRelease(m, { id: ID, version: '0.1.2', hash: 'sha256:b', minVersion: '140.0' });
    m = addRelease(m, { id: ID, version: '0.1.2', hash: 'sha256:c', minVersion: '140.0' });
    const u = m.addons[ID].updates;
    expect(u.map((x: { version: string }) => x.version)).toEqual(['0.1.2', '0.1.10']);
    expect(u[0]).toEqual({ version: '0.1.2', update_link: `${RAW_BASE}/dude-0.1.2.xpi`, update_hash: 'sha256:c', applications: { gecko: { strict_min_version: '140.0' } } });
  });

  test('the manifest points at the same file', () => {
    expect(fs.readFileSync(path.resolve(__dirname, '../wxt.config.ts'), 'utf8')).toContain(`update_url: '${UPDATE_URL}'`);
  });
});

describe('publish', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-publish-'));
  const origin = path.join(tmp, 'origin.git');
  const work = path.join(tmp, 'work');
  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  execFileSync('git', ['init', '-q', '--bare', origin]);
  execFileSync('git', ['init', '-q', '-b', 'master', work]);
  git(work, 'config', 'user.email', 't@example.com');
  git(work, 'config', 'user.name', 't');
  git(work, 'remote', 'add', 'origin', origin);
  fs.writeFileSync(path.join(work, 'a.txt'), 'a');
  git(work, 'add', '.');
  git(work, 'commit', '-qm', 'A');
  const xpi = (v: string) => {
    const f = path.join(tmp, `x-${v}.xpi`);
    fs.writeFileSync(f, `xpi ${v}`);
    return f;
  };
  const opts = { id: ID, minVersion: '140.0', cwd: work };

  test('first release creates the branch, then releases stack on it', () => {
    checkPublishable('0.1.2', work);
    publishUpdate({ ...opts, xpi: xpi('0.1.2'), version: '0.1.2' });
    fs.writeFileSync(path.join(work, 'a.txt'), 'b');
    git(work, 'commit', '-qam', 'B');
    publishUpdate({ ...opts, xpi: xpi('0.1.3'), version: '0.1.3' });

    expect(git(origin, 'ls-tree', '--name-only', 'updates').split('\n')).toEqual(['dude-0.1.2.xpi', 'dude-0.1.3.xpi', 'updates.json']);
    expect(git(origin, 'show', 'updates:dude-0.1.2.xpi')).toBe('xpi 0.1.2');
    const m = JSON.parse(git(origin, 'show', 'updates:updates.json'));
    expect(m.addons[ID].updates.map((x: { version: string }) => x.version)).toEqual(['0.1.2', '0.1.3']);
    expect(git(origin, 'rev-list', '--count', 'updates')).toBe('2');
    expect(git(origin, 'rev-parse', 'v0.1.2^{commit}')).toBe(git(work, 'rev-parse', 'HEAD~1'));
    expect(git(work, 'status', '--porcelain')).toBe(''); // working tree untouched
    expect(git(work, 'branch', '--show-current')).toBe('master');
  });

  test('refuses a published version and uncommitted changes', () => {
    expect(() => checkPublishable('0.1.2', work)).toThrow(/tag v0.1.2 exists/);
    git(work, 'tag', '-d', 'v0.1.2');
    expect(() => checkPublishable('0.1.2', work)).toThrow(/on origin/);
    fs.writeFileSync(path.join(work, 'a.txt'), 'dirty');
    expect(() => checkPublishable('0.1.9', work)).toThrow(/uncommitted/);
  });
});
