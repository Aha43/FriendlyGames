// @vitest-environment node
// make release (#49) against isolated fixture repositories: a real bare "origin" (tag pushes are
// real but local), a stub `gh` that keeps releases in a file, a `git` wrapper that can fail a push
// or lookup, and a stub `curl` for the read-only production status. Nothing here reaches GitHub,
// the real repository or production.
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { changelogSection, findReleaseCommit, Stop } from '../../scripts/release.ts';

// Each case builds repositories and runs many real git processes: well beyond the 5 s default.
vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, '../..');
const REAL_GIT = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
const NODE = process.execPath;
// Fixture repositories ignore the machine's own git settings (signing, push negotiation, …).
const ISOLATED = {
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@example.test',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@example.test',
};

// gh: auth status | release view TAG --json … | release create TAG --verify-tag --title T --notes-file F
const GH = `#!${NODE}
const fs = require('fs'), { execFileSync } = require('child_process');
const args = process.argv.slice(2), env = process.env;
fs.appendFileSync(env.STUB_LOG, 'gh ' + args.join(' ') + '\\n');
const file = env.STUB_RELEASES, releases = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
const save = () => fs.writeFileSync(file, JSON.stringify(releases));
const fail = (msg) => { process.stderr.write(msg + '\\n'); process.exit(1); };
if (args[0] === 'auth') { if (env.STUB_GH_AUTH === 'fail') fail('You are not logged into any GitHub hosts.'); process.exit(0); }
const tag = args[2];
if (args[1] === 'view') {
  if (env.STUB_GH_VIEW === 'network') fail('error connecting to api.github.com');
  if (!releases[tag]) fail('release not found');
  process.stdout.write(JSON.stringify(releases[tag])); process.exit(0);
}
if (args[1] === 'create') {
  if (!args.includes('--verify-tag')) fail('test stub: --verify-tag is required');
  const out = execFileSync(env.REAL_GIT, ['ls-remote', '--tags', env.STUB_ORIGIN, 'refs/tags/' + tag], { encoding: 'utf8' });
  if (!out.trim()) fail('tag ' + tag + ' does not exist on the remote');
  if (env.STUB_GH_CREATE === 'fail') fail('HTTP 502: Bad Gateway');
  const title = args[args.indexOf('--title') + 1], body = fs.readFileSync(args[args.indexOf('--notes-file') + 1], 'utf8');
  if (releases[tag]) fail('a release with the same tag name already exists');
  releases[tag] = { tagName: tag, name: title, isDraft: false, body, url: 'https://github.test/releases/' + tag }; save();
  if (env.STUB_GH_CREATE === 'lost') fail('connection reset by peer');
  process.stdout.write('https://github.test/releases/' + tag + '\\n'); process.exit(0);
}
fail('unexpected gh call');
`;

// git: the real git, except an injected failure of a push, tag lookup or fetch.
const GIT = `#!/bin/sh
case "$1" in
  push) echo "git $*" >> "$STUB_LOG"
        [ "$STUB_PUSH" = fail ] && { echo "fatal: unable to access origin" >&2; exit 128; }
        if [ "$STUB_PUSH" = lost ]; then "$REAL_GIT" "$@" >/dev/null 2>&1; echo "fatal: the remote end hung up" >&2; exit 128; fi ;;
  ls-remote) [ "$STUB_LSREMOTE" = fail ] && { echo "fatal: could not read from remote" >&2; exit 128; } ;;
  fetch) [ "$STUB_FETCH" = fail ] && { echo "fatal: could not resolve host" >&2; exit 128; } ;;
  tag) echo "git $*" >> "$STUB_LOG" ;;
esac
exec "$REAL_GIT" "$@"
`;

const CURL = `#!/bin/sh
[ "$STUB_STATUS" = down ] && exit 22
case "$*" in *-w*) printf "\${STUB_SITE:-200}" ;; *) echo '{"ok":true,"commit":"abc1234","pooled":true}' ;; esac
`;

let dir: string;
let work: string;
let origin: string;
let bin: string;
let log: string;
let releasesFile: string;

const g = (...args: string[]) =>
  execFileSync(REAL_GIT, args, { cwd: work, encoding: 'utf8', env: { ...process.env, ...ISOLATED } }).trim();

const SECTION_020 = `### Added

- Fischer Random next to chess (#55).
- A line with "quotes", $(dollar) and \`backticks\` that must reach the notes untouched.
`;

function changelog(sections: string[]) {
  return `# Changelog\n\n## Unreleased\n\n${sections.join('\n')}`;
}
const v012 = `## v0.1.2 — Captured pieces at a glance (2026-11-03)\n\n### Added\n\n- Captured pieces (#44).\n`;
const v020 = (body = SECTION_020) => `## v0.2.0 — Chess and Fischer Random (2026-11-08)\n\n${body}`;

function writeVersion(version: string, { lock = version, extra = {} as Record<string, unknown> } = {}) {
  writeFileSync(join(work, 'package.json'), `${JSON.stringify({ name: 'friendlygames', version, ...extra }, null, 2)}\n`);
  writeFileSync(
    join(work, 'package-lock.json'),
    `${JSON.stringify({ name: 'friendlygames', version: lock, lockfileVersion: 3, packages: { '': { name: 'friendlygames', version: lock } } }, null, 2)}\n`,
  );
}

function commit(message: string) {
  g('add', '-A');
  g('commit', '-qm', message);
  return g('rev-parse', 'HEAD');
}

/** Two released versions on main: v0.1.2, then the v0.2.0 release commit. Returns its SHA. */
function standardHistory(): string {
  writeVersion('0.1.2');
  writeFileSync(join(work, 'CHANGELOG.md'), changelog([v012]));
  commit('Prepare the v0.1.2 release (#48)');
  writeFileSync(join(work, 'feature.txt'), 'game\n');
  commit('Fischer Random (#55)');
  writeVersion('0.2.0');
  writeFileSync(join(work, 'CHANGELOG.md'), changelog([v020(), v012]));
  return commit('Prepare the v0.2.0 release (#56)');
}

const push = () => g('push', '-q', 'origin', 'main');

function run(env: Record<string, string> = {}, cwd = work) {
  const result = spawnSync('make', ['-s', 'release'], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...ISOLATED,
      PATH: `${bin}:${process.env.PATH}`,
      STUB_LOG: log,
      STUB_RELEASES: releasesFile,
      STUB_ORIGIN: origin,
      REAL_GIT,
      ...env,
    },
  });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : []);
const writes = () => calls().filter((c) => /^git (tag|push)|^gh release create/.test(c));
const releases = () => (existsSync(releasesFile) ? JSON.parse(readFileSync(releasesFile, 'utf8')) : {});
const remoteTag = (tag = 'v0.2.0') =>
  execFileSync(REAL_GIT, ['ls-remote', '--tags', origin, `refs/tags/${tag}`], { encoding: 'utf8', env: { ...process.env, ...ISOLATED } }).trim();
const peeled = (tag = 'v0.2.0') => g('rev-parse', `${tag}^{commit}`);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fg-release-'));
  origin = join(dir, 'origin.git');
  work = join(dir, 'work');
  bin = join(dir, 'bin');
  log = join(dir, 'calls.log');
  releasesFile = join(dir, 'releases.json');
  execFileSync(REAL_GIT, ['init', '-q', '--bare', '-b', 'main', origin], { env: { ...process.env, ...ISOLATED } });
  mkdirSync(work);
  g('init', '-q', '-b', 'main');
  g('remote', 'add', 'origin', origin);
  mkdirSync(join(work, 'scripts'));
  mkdirSync(join(work, 'supabase/.temp'), { recursive: true });
  copyFileSync(join(ROOT, 'Makefile'), join(work, 'Makefile'));
  copyFileSync(join(ROOT, 'scripts/release.ts'), join(work, 'scripts/release.ts'));
  writeFileSync(join(work, 'supabase/.temp/project-ref'), 'testref\n');
  writeFileSync(join(work, '.gitignore'), 'supabase/.temp/\nbackups/\n');
  mkdirSync(bin);
  for (const [name, body] of [['gh', GH], ['git', GIT], ['curl', CURL]] as const) {
    writeFileSync(join(bin, name), body);
    chmodSync(join(bin, name), 0o755);
  }
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('make release publishes the release commit', () => {
  it('tags the release commit, pushes the tag and publishes that version’s changelog section', () => {
    const sha = standardHistory();
    push();
    const { status, out } = run();
    expect(status, out).toBe(0);
    expect(out).toContain(`Release   ${sha} Prepare the v0.2.0 release (#56)`);
    expect(out).toContain('commit abc1234, database ok'); // read-only production status shown first
    expect(out).toContain('does not deploy');
    expect(writes()).toEqual([
      'git tag -a v0.2.0 ' + sha + ' -m v0.2.0 — Chess and Fischer Random',
      'git push origin refs/tags/v0.2.0',
      expect.stringMatching(/^gh release create v0\.2\.0 --verify-tag --title v0\.2\.0 — Chess and Fischer Random --notes-file /),
    ]);
    expect(peeled()).toBe(sha);
    expect(g('cat-file', '-t', 'v0.2.0')).toBe('tag');
    expect(remoteTag()).toContain('refs/tags/v0.2.0');
    expect(releases()['v0.2.0']).toMatchObject({ name: 'v0.2.0 — Chess and Fischer Random', body: SECTION_020 });
    expect(out).toContain('Close the version milestone');
    expect(out).toContain('docs/deployment.md');
  });

  it('keeps the tag on the release commit after main moved on, even through a later package.json edit', () => {
    const sha = standardHistory();
    writeFileSync(join(work, 'docs.md'), 'deployment record\n');
    commit('Record the v0.2.0 deployment');
    writeVersion('0.2.0', { extra: { scripts: { check: 'true' } } }); // same version, another field
    commit('Add a script');
    push();
    const { status, out } = run();
    expect(status, out).toBe(0);
    expect(out).toContain('main has moved on since then');
    expect(peeled()).toBe(sha);
  });

  it('takes the notes from the release commit, not a later edit of the same section', () => {
    standardHistory();
    writeFileSync(join(work, 'CHANGELOG.md'), changelog([v020('### Added\n\n- Edited afterwards.\n'), v012]));
    commit('Reword the changelog');
    push();
    expect(run().status).toBe(0);
    expect(releases()['v0.2.0'].body).toBe(SECTION_020);
  });
});

describe('finding the release commit and its notes', () => {
  const inWork = <T,>(fn: () => T): T => {
    const cwd = process.cwd();
    const env = { ...process.env };
    Object.assign(process.env, ISOLATED);
    process.chdir(work);
    try {
      return fn();
    } finally {
      process.chdir(cwd);
      process.env = env;
    }
  };

  it('refuses a version main never changed to, rather than guessing', () => {
    standardHistory();
    const head = g('rev-parse', 'HEAD');
    expect(() => inWork(() => findReleaseCommit(head, '0.3.0'))).toThrow(Stop);
    expect(() => inWork(() => findReleaseCommit(head, '0.3.0'))).toThrow(/No commit on main's first-parent history changes package\.json to 0\.3\.0/);
    expect(inWork(() => findReleaseCommit(head, '0.1.2'))).toBe(g('rev-parse', 'HEAD~2'));
  });

  it('reads exactly one dated section, without its heading or the next version', () => {
    expect(changelogSection(changelog([v020(), v012]), '0.2.0')).toEqual({
      title: 'v0.2.0 — Chess and Fischer Random',
      date: '2026-11-08',
      notes: SECTION_020,
    });
    expect(changelogSection(changelog([v020(), v012]), '0.1.2')?.notes).toBe('### Added\n\n- Captured pieces (#44).\n');
    expect(changelogSection(changelog([v020(), v020()]), '0.2.0')).toBeNull(); // duplicated heading
    expect(changelogSection(changelog(['## v0.2.0 — Empty (2026-11-08)\n']), '0.2.0')).toBeNull();
  });
});

describe('preflight refuses without writing anything', () => {
  const refuses = (env: Record<string, string>, message: RegExp) => {
    const { status, out } = run(env);
    expect(status, out).not.toBe(0);
    expect(out).toMatch(message);
    expect(writes()).toEqual([]);
    expect(remoteTag()).toBe('');
    expect(releases()).toEqual({});
  };

  it('on another branch', () => {
    standardHistory();
    push();
    g('checkout', '-qb', 'feature');
    refuses({}, /Run this on main \(you are on feature\)/);
  });

  it('with uncommitted or untracked changes', () => {
    standardHistory();
    push();
    writeFileSync(join(work, 'stray.txt'), 'x');
    refuses({}, /uncommitted or untracked changes/);
  });

  it('when main is behind or has diverged from origin', () => {
    standardHistory();
    push();
    g('reset', '-q', '--hard', 'HEAD~1');
    refuses({}, /behind origin\/main/);
    writeFileSync(join(work, 'other.txt'), 'x');
    commit('Local only');
    refuses({}, /diverged from origin\/main/);
  });

  it('when origin, GitHub or the remote tags cannot be read (never taken as "absent")', () => {
    standardHistory();
    push();
    refuses({ STUB_FETCH: 'fail' }, /Couldn't fetch origin\/main/);
    refuses({ STUB_GH_AUTH: 'fail' }, /GitHub CLI is not signed in/);
    refuses({ STUB_LSREMOTE: 'fail' }, /Couldn't read tags on origin .*unknown/);
    refuses({ STUB_GH_VIEW: 'network' }, /Couldn't read the v0\.2\.0 release from GitHub .*unknown/);
  });

  it('when the backend or the website is down', () => {
    standardHistory();
    push();
    refuses({ STUB_STATUS: 'down' }, /Production is not healthy or could not be checked/);
    // The site answering 503 is shown, and stops the release before anything is written.
    const { status, out } = run({ STUB_SITE: '503' });
    expect(status).not.toBe(0);
    expect(out).toContain('did not answer normally (HTTP 503)');
    expect(out).toMatch(/Production is not healthy/);
    expect(writes()).toEqual([]);
    expect(remoteTag()).toBe('');
    expect(releases()).toEqual({});
  });

  it('in a shallow clone, where a later commit could pass for the version change', () => {
    standardHistory();
    writeFileSync(join(work, 'docs.md'), 'deployment record\n');
    commit('Record the v0.2.0 deployment');
    push();
    const shallow = join(dir, 'shallow');
    execFileSync(REAL_GIT, ['clone', '-q', '--depth', '1', '--branch', 'main', `file://${origin}`, shallow], {
      env: { ...process.env, ...ISOLATED },
    });
    mkdirSync(join(shallow, 'supabase/.temp'), { recursive: true });
    writeFileSync(join(shallow, 'supabase/.temp/project-ref'), 'testref\n');
    const { status, out } = run({}, shallow);
    expect(status, out).not.toBe(0);
    expect(out).toMatch(/shallow clone.*git fetch --unshallow origin/);
    expect(writes()).toEqual([]);
    expect(remoteTag()).toBe('');
    expect(releases()).toEqual({});
  });

  it('without a dated changelog section for the version', () => {
    writeVersion('0.2.0');
    writeFileSync(join(work, 'CHANGELOG.md'), changelog(['## v0.2.0 — Chess and Fischer Random\n\n- undated\n', v012]));
    commit('Prepare without a date');
    push();
    refuses({}, /no dated "## v0\.2\.0 — <title> \(YYYY-MM-DD\)" section/);
  });

  it('when the lockfile disagrees with package.json', () => {
    writeVersion('0.2.0', { lock: '0.1.2' });
    writeFileSync(join(work, 'CHANGELOG.md'), changelog([v020(), v012]));
    commit('Half-bumped');
    push();
    refuses({}, /package-lock\.json at HEAD says 0\.1\.2\/0\.1\.2, not 0\.2\.0/);
  });

  it('when the version changed to this one more than once on main', () => {
    standardHistory();
    writeVersion('0.2.1');
    commit('Bump by mistake');
    writeVersion('0.2.0');
    commit('Revert the bump');
    push();
    refuses({}, /Ambiguous: package\.json changed to 0\.2\.0 in 2 commits/);
  });

  it('when a tag or release for this version conflicts', () => {
    const sha = standardHistory();
    push();
    g('tag', '-a', 'v0.2.0', `${sha}~1`, '-m', 'v0.2.0 — Chess and Fischer Random');
    refuses({}, /existing v0\.2\.0 tag conflicts: the local tag points at [0-9a-f]{7}, not/);
    g('tag', '-d', 'v0.2.0');

    g('tag', 'v0.2.0', sha); // lightweight
    refuses({}, /the local tag is lightweight/);
    g('tag', '-d', 'v0.2.0');

    g('tag', '-a', 'v0.2.0', sha, '-m', 'something else');
    refuses({}, /the local tag's message is "something else"/);
    g('tag', '-d', 'v0.2.0');

    const other = { 'v0.2.0': { tagName: 'v0.2.0', name: 'Another title', isDraft: false, body: SECTION_020, url: 'u' } };
    writeFileSync(releasesFile, JSON.stringify(other));
    const { status, out } = run();
    expect(status).not.toBe(0);
    expect(out).toMatch(/release on GitHub conflicts: the release is titled "Another title", not "v0\.2\.0 — Chess and Fischer Random"\. It is never overwritten/);
    expect(writes()).toEqual([]);
    expect(remoteTag()).toBe('');
    expect(releases()).toEqual(other);
  });

  it('when the tag on origin points elsewhere', () => {
    const sha = standardHistory();
    push();
    g('tag', '-a', 'v0.2.0', `${sha}~1`, '-m', 'v0.2.0 — Chess and Fischer Random');
    g('push', '-q', 'origin', 'refs/tags/v0.2.0');
    g('tag', '-d', 'v0.2.0');
    const before = remoteTag();
    const { status, out } = run();
    expect(status).not.toBe(0);
    expect(out).toMatch(/v0\.2\.0 on origin conflicts: the remote tag points at/);
    expect(writes()).toEqual([]);
    expect(remoteTag()).toBe(before);
  });
});

describe('a partial or interrupted publication', () => {
  it('finishes from a matching local tag without retagging', () => {
    const sha = standardHistory();
    push();
    g('tag', '-a', 'v0.2.0', sha, '-m', 'v0.2.0 — Chess and Fischer Random');
    const object = g('rev-parse', 'refs/tags/v0.2.0');
    const { status, out } = run();
    expect(status, out).toBe(0);
    expect(out).toContain('Resuming an earlier run');
    expect(writes().some((c) => c.startsWith('git tag'))).toBe(false);
    expect(remoteTag()).toContain(object);
    expect(releases()['v0.2.0']).toBeDefined();
  });

  it('only creates the release when the tag is already on origin', () => {
    const sha = standardHistory();
    push();
    g('tag', '-a', 'v0.2.0', sha, '-m', 'v0.2.0 — Chess and Fischer Random');
    g('push', '-q', 'origin', 'refs/tags/v0.2.0');
    g('tag', '-d', 'v0.2.0'); // e.g. another checkout pushed it
    const { status, out } = run();
    expect(status, out).toBe(0);
    expect(writes()).toEqual([expect.stringMatching(/^gh release create v0\.2\.0 /)]);
  });

  it('reports an existing, matching publication and does nothing', () => {
    standardHistory();
    push();
    expect(run().status).toBe(0);
    const firstCalls = writes().length;
    const { status, out } = run();
    expect(status, out).toBe(0);
    expect(out).toContain('v0.2.0 is already published');
    expect(writes()).toHaveLength(firstCalls);
  });

  it('keeps the local tag when the push fails, and a rerun pushes that same tag', () => {
    const sha = standardHistory();
    push();
    const failed = run({ STUB_PUSH: 'fail' });
    expect(failed.status).not.toBe(0);
    expect(failed.out).toMatch(/Pushing v0\.2\.0 failed .*The tag exists locally; origin does not have it\. No release was created/);
    expect(remoteTag()).toBe('');
    expect(releases()).toEqual({});
    const object = g('rev-parse', 'refs/tags/v0.2.0');

    const rerun = run();
    expect(rerun.status, rerun.out).toBe(0);
    expect(remoteTag()).toContain(object);
    expect(peeled()).toBe(sha);
    expect(writes().filter((c) => c.startsWith('git tag'))).toHaveLength(1);
  });

  it('continues after a push whose answer was lost, once origin shows the tag', () => {
    standardHistory();
    push();
    const { status, out } = run({ STUB_PUSH: 'lost' });
    expect(status, out).toBe(0);
    expect(out).toContain('the push reported an error, but origin has the tag');
    expect(releases()['v0.2.0']).toBeDefined();
  });

  it('confirms a release whose creation answer was lost instead of creating a second one', () => {
    standardHistory();
    push();
    const { status, out } = run({ STUB_GH_CREATE: 'lost' });
    expect(status, out).toBe(0);
    expect(out).toContain('the request reported an error, but the release exists');
    expect(calls().filter((c) => c.startsWith('gh release create'))).toHaveLength(1);
    const rerun = run();
    expect(rerun.out).toContain('already published');
    expect(calls().filter((c) => c.startsWith('gh release create'))).toHaveLength(1);
  });

  it('reports a failed release creation precisely, and a rerun creates it once without retagging', () => {
    standardHistory();
    push();
    const failed = run({ STUB_GH_CREATE: 'fail' });
    expect(failed.status).not.toBe(0);
    expect(failed.out).toMatch(/Creating the v0\.2\.0 release failed .*The tag is on origin; GitHub has no release for it/);
    expect(remoteTag()).toContain('refs/tags/v0.2.0');
    const rerun = run();
    expect(rerun.status, rerun.out).toBe(0);
    expect(writes().filter((c) => c.startsWith('git tag'))).toHaveLength(1);
    expect(writes().filter((c) => c.startsWith('git push'))).toHaveLength(1);
    expect(releases()['v0.2.0'].body).toBe(SECTION_020);
  });

  it('never deletes a pushed tag when a later step fails', () => {
    standardHistory();
    push();
    run({ STUB_GH_CREATE: 'fail' });
    expect(calls().some((c) => /tag (-d|--delete)|push .*(--delete|:refs)/.test(c))).toBe(false);
    expect(remoteTag()).toContain('refs/tags/v0.2.0');
  });
});

describe('only the owner runs it', () => {
  it('is not part of the default target, verify, setup, CI or deployment', () => {
    const makefile = readFileSync(join(ROOT, 'Makefile'), 'utf8');
    expect(makefile).toMatch(/^\.DEFAULT_GOAL := help$/m);
    for (const target of ['verify', 'setup', 'check', 'deploy-backend', 'help']) {
      const body = makefile.split(new RegExp(`^${target}:`, 'm'))[1]?.split(/^\S/m)[0] ?? '';
      expect(body, target).not.toMatch(/release\.ts|\$\(MAKE\) release|make release/);
    }
    for (const workflow of ['ci.yml', 'pr-tracking.yml', 'keep-alive.yml']) {
      expect(readFileSync(join(ROOT, '.github/workflows', workflow), 'utf8')).not.toMatch(/release/);
    }
    expect(JSON.stringify(JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts)).not.toMatch(/release/);
    expect(readFileSync(join(ROOT, 'scripts/deploy-backend.sh'), 'utf8')).not.toMatch(/release/);
  });
});
