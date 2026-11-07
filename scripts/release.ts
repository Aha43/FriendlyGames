// make release (#49): tag and publish the merged release commit of the version in package.json.
//
// Owner-run only (`make release`); never part of help defaults, setup, verify, CI or deploys.
// It does not deploy, bump versions, edit the changelog or close milestones. Plain TypeScript
// that Node 24 runs directly (type stripping), no dependencies. Every external command runs with
// an argument list, never through a shell, so release text is never interpolated into a command.
//
// 1. Preflight (no writes): clean main equal to a fresh origin/main; version, lockfile and a dated
//    CHANGELOG section agree; the release commit is the first-parent commit where package.json's
//    version changed to this version; GitHub CLI access; local tag, remote tag and release are
//    each absent, matching, or a conflict (which stops); read-only production status.
// 2. Publication, only the missing steps: annotated tag on the release commit, push the tag,
//    `gh release create --verify-tag` with that commit's changelog section as the notes file.
//    After a failure it re-queries and reports what is confirmed and what is unknown; a rerun
//    resumes safely. Tags are never moved or deleted, a release is never overwritten.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export class Stop extends Error {}

interface Result {
  status: number;
  stdout: string;
  stderr: string;
}

function exec(cmd: string, args: string[], input?: string): Result {
  const r = spawnSync(cmd, args, { encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024 });
  if (r.error) return { status: 127, stdout: '', stderr: String(r.error.message) };
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

const git = (...args: string[]) => exec('git', args);
function gitOk(what: string, ...args: string[]): string {
  const r = git(...args);
  if (r.status !== 0) throw new Stop(`${what} failed: ${r.stderr.trim() || `git ${args[0]} exited ${r.status}`}`);
  return r.stdout.trim();
}

const say = (line = '') => process.stdout.write(`${line}\n`);

// ---------- version, lockfile and changelog ----------

const HEADING = /^## v(\d+\.\d+\.\d+) — (.+) \((\d{4}-\d{2}-\d{2})\)\s*$/;

export interface ChangelogSection {
  title: string; // "v0.2.0 — Chess and Fischer Random"
  date: string;
  notes: string; // the section body, without its heading
}

/** The dated section for `version`, or null. Exactly one heading may match. */
export function changelogSection(changelog: string, version: string): ChangelogSection | null {
  const lines = changelog.split('\n');
  const starts = lines.flatMap((line, i) => (HEADING.exec(line)?.[1] === version ? [i] : []));
  if (starts.length !== 1) return null;
  const [, , name, date] = HEADING.exec(lines[starts[0]])!;
  let end = lines.findIndex((line, i) => i > starts[0] && /^## /.test(line));
  if (end === -1) end = lines.length;
  const notes = lines.slice(starts[0] + 1, end).join('\n').trim();
  if (!notes) return null;
  return { title: `v${version} — ${name}`, date, notes: `${notes}\n` };
}

function versionAt(rev: string, cache: Map<string, string | null>): string | null {
  if (cache.has(rev)) return cache.get(rev)!;
  const r = git('show', `${rev}:package.json`);
  let version: string | null = null;
  if (r.status === 0) {
    try {
      version = JSON.parse(r.stdout).version ?? null;
    } catch {
      version = null;
    }
  }
  cache.set(rev, version);
  return version;
}

function checkLockfile(rev: string, version: string) {
  const r = git('show', `${rev}:package-lock.json`);
  if (r.status !== 0) throw new Stop(`package-lock.json is missing at ${rev.slice(0, 7)}.`);
  const lock = JSON.parse(r.stdout);
  if (lock.version !== version || lock.packages?.['']?.version !== version) {
    throw new Stop(
      `package-lock.json at ${rev.slice(0, 7)} says ${lock.version}/${lock.packages?.['']?.version}, not ${version}: update both files together.`,
    );
  }
}

/**
 * The first-parent commit of `head` where package.json's version changed to `version`. Later
 * commits may touch package.json (or anything else) without changing the version. More than one
 * such change (the version left and came back) is ambiguous and refused.
 */
export function findReleaseCommit(head: string, version: string): string {
  const cache = new Map<string, string | null>();
  const lines = gitOk('Reading main history', 'rev-list', '--first-parent', '--parents', head).split('\n');
  const candidates = lines.filter(Boolean).flatMap((line) => {
    const [commit, parent] = line.split(' ');
    if (versionAt(commit, cache) !== version) return [];
    return parent === undefined || versionAt(parent, cache) !== version ? [commit] : [];
  });
  if (candidates.length === 0) throw new Stop(`No commit on main's first-parent history changes package.json to ${version}.`);
  if (candidates.length > 1) {
    throw new Stop(
      `Ambiguous: package.json changed to ${version} in ${candidates.length} commits on main (${candidates
        .map((c) => c.slice(0, 7))
        .join(', ')}). Resolve this by hand; nothing was written.`,
    );
  }
  return candidates[0];
}

// ---------- remote and release state ----------

type TagState = { kind: 'absent' } | { kind: 'match'; object: string } | { kind: 'conflict'; why: string };

function localTag(tag: string, sha: string, message: string): TagState {
  const ref = git('rev-parse', '-q', '--verify', `refs/tags/${tag}`);
  if (ref.status !== 0) return { kind: 'absent' };
  return inspectTagObject(ref.stdout.trim(), sha, message, 'local');
}

function inspectTagObject(object: string, sha: string, message: string, where: string): TagState {
  if (gitOk('Reading the tag', 'cat-file', '-t', object) !== 'tag') {
    return { kind: 'conflict', why: `the ${where} tag is lightweight, not annotated` };
  }
  const target = gitOk('Reading the tag', 'rev-parse', `${object}^{commit}`);
  if (target !== sha) return { kind: 'conflict', why: `the ${where} tag points at ${target.slice(0, 7)}, not ${sha.slice(0, 7)}` };
  const body = gitOk('Reading the tag', 'cat-file', 'tag', object);
  const text = body.slice(body.indexOf('\n\n') + 2).trim();
  if (text !== message) return { kind: 'conflict', why: `the ${where} tag's message is "${text.split('\n')[0]}", not "${message}"` };
  return { kind: 'match', object };
}

/** The tag on origin. A failed lookup is never taken to mean "absent". */
function remoteTag(tag: string, sha: string, message: string): TagState {
  const r = git('ls-remote', '--tags', 'origin', `refs/tags/${tag}`);
  if (r.status !== 0) throw new Stop(`Couldn't read tags on origin (${r.stderr.trim() || `exit ${r.status}`}); the state is unknown.`);
  const object = r.stdout
    .split('\n')
    .map((l) => l.split('\t'))
    .find(([, name]) => name === `refs/tags/${tag}`)?.[0];
  if (!object) return { kind: 'absent' };
  if (git('cat-file', '-e', object).status !== 0) {
    // Not known locally yet: fetch only that tag object into FETCH_HEAD (no refs change).
    const f = git('fetch', '-q', '--no-tags', 'origin', `refs/tags/${tag}`);
    if (f.status !== 0) throw new Stop(`Couldn't fetch the ${tag} tag from origin to check it; the state is unknown.`);
  }
  return inspectTagObject(object, sha, message, 'remote');
}

type ReleaseState = { kind: 'absent' } | { kind: 'match'; url: string } | { kind: 'conflict'; why: string };

/** The GitHub release for `tag`. Only GitHub's "not found" means absent; other failures stop. */
function release(tag: string, title: string, notes: string): ReleaseState {
  const r = exec('gh', ['release', 'view', tag, '--json', 'tagName,name,isDraft,body,url']);
  if (r.status !== 0) {
    if (/release not found/i.test(r.stderr)) return { kind: 'absent' };
    throw new Stop(`Couldn't read the ${tag} release from GitHub (${r.stderr.trim() || `exit ${r.status}`}); the state is unknown.`);
  }
  const found = JSON.parse(r.stdout);
  if (found.tagName !== tag) return { kind: 'conflict', why: `GitHub returned a release for ${found.tagName}` };
  if (found.isDraft) return { kind: 'conflict', why: 'the release is a draft' };
  if (found.name !== title) return { kind: 'conflict', why: `the release is titled "${found.name}", not "${title}"` };
  if (String(found.body ?? '').trim() !== notes.trim()) {
    return { kind: 'conflict', why: 'its notes differ from the changelog section' };
  }
  return { kind: 'match', url: found.url };
}

// ---------- the command ----------

export function main(): number {
  try {
    return releaseCommand();
  } catch (e) {
    if (e instanceof Stop) {
      process.stderr.write(`\nmake release stopped: ${e.message}\n`);
      return 1;
    }
    throw e;
  }
}

function releaseCommand(): number {
  say('make release: tag and publish the release commit of the version in package.json.');
  say('It does not deploy, bump versions, edit the changelog or close milestones.\n');

  // Preflight. Nothing below writes a tag or release until "Publishing".
  const branch = gitOk('Reading the branch', 'rev-parse', '--abbrev-ref', 'HEAD');
  if (branch !== 'main') throw new Stop(`Run this on main (you are on ${branch}). Nothing was written.`);
  if (gitOk('Reading the status', 'status', '--porcelain', '--untracked-files=normal')) {
    throw new Stop('The checkout has uncommitted or untracked changes: commit, stash or remove them. Nothing was written.');
  }
  const fetched = git('fetch', '-q', 'origin', 'main');
  if (fetched.status !== 0) throw new Stop(`Couldn't fetch origin/main (${fetched.stderr.trim()}). Nothing was written.`);
  const head = gitOk('Reading HEAD', 'rev-parse', 'HEAD');
  const upstream = gitOk('Reading origin/main', 'rev-parse', 'FETCH_HEAD');
  if (head !== upstream) {
    const behind = git('merge-base', '--is-ancestor', head, upstream).status === 0;
    throw new Stop(
      behind
        ? 'Local main is behind origin/main: git pull --ff-only, then run again. Nothing was written.'
        : 'Local main has diverged from origin/main. Nothing was written.',
    );
  }

  const version: string = JSON.parse(readFileSync('package.json', 'utf8')).version;
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Stop(`package.json has no plain version (found "${version}").`);
  const tag = `v${version}`;
  checkLockfile('HEAD', version);
  if (!changelogSection(readFileSync('CHANGELOG.md', 'utf8'), version)) {
    throw new Stop(`CHANGELOG.md has no dated "## ${tag} — <title> (YYYY-MM-DD)" section with notes. Nothing was written.`);
  }

  const sha = findReleaseCommit(head, version);
  if (git('merge-base', '--is-ancestor', sha, upstream).status !== 0) throw new Stop(`${sha.slice(0, 7)} is not on origin/main.`);
  checkLockfile(sha, version);
  const changelogAtRelease = git('show', `${sha}:CHANGELOG.md`);
  const section = changelogAtRelease.status === 0 ? changelogSection(changelogAtRelease.stdout, version) : null;
  if (!section) throw new Stop(`CHANGELOG.md at the release commit ${sha.slice(0, 7)} has no dated ${tag} section.`);
  const subject = gitOk('Reading the release commit', 'log', '-1', '--format=%s', sha);

  say(`Version   ${version} (tag ${tag})`);
  say(`Release   ${sha} ${subject}`);
  if (sha !== head) say(`          main has moved on since then (now ${head.slice(0, 7)}); the tag goes on the release commit.`);
  say(`Title     ${section.title}`);
  say(`Notes     the ${tag} section of CHANGELOG.md at ${sha.slice(0, 7)} (${section.notes.split('\n').length - 1} lines)`);

  const auth = exec('gh', ['auth', 'status']);
  if (auth.status !== 0) throw new Stop('The GitHub CLI is not signed in or cannot reach GitHub (gh auth status). Nothing was written.');

  const local = localTag(tag, sha, section.title);
  if (local.kind === 'conflict') throw new Stop(`An existing ${tag} tag conflicts: ${local.why}. Tags are never moved; resolve it by hand.`);
  const remote = remoteTag(tag, sha, section.title);
  if (remote.kind === 'conflict') throw new Stop(`${tag} on origin conflicts: ${remote.why}. Tags are never moved; resolve it by hand.`);
  if (local.kind === 'match' && remote.kind === 'match' && local.object !== remote.object) {
    throw new Stop(`The local and remote ${tag} tags are different tag objects. Resolve it by hand.`);
  }
  const published = release(tag, section.title, section.notes);
  if (published.kind === 'conflict') throw new Stop(`The ${tag} release on GitHub conflicts: ${published.why}. It is never overwritten.`);
  if (published.kind === 'match' && remote.kind === 'absent') {
    throw new Stop(`A ${tag} release exists but its tag is not on origin. Resolve it by hand.`);
  }

  say('\nProduction now (read-only; this command does not deploy, and the live site may be a later build):');
  const status = spawnSync('make', ['-s', 'prod-status'], { stdio: 'inherit' });
  if (status.status !== 0) throw new Stop('make prod-status failed. Nothing was written.');

  const steps = [
    local.kind === 'absent' && remote.kind === 'absent' ? 'create the annotated tag' : null,
    remote.kind === 'absent' ? 'push the tag' : null,
    published.kind === 'absent' ? 'publish the GitHub release' : null,
  ].filter(Boolean);
  if (steps.length === 0) {
    say(`\n${tag} is already published (${published.kind === 'match' ? published.url : ''}). Nothing to do.`);
    followUps(tag);
    return 0;
  }
  if (local.kind === 'match' || remote.kind === 'match') say(`\nResuming an earlier run: ${tag} exists ${remote.kind === 'match' ? 'on origin' : 'locally'} as expected.`);
  say(`\nPublishing: ${steps.join(', then ')}.`);

  // Publication. From here an external failure can leave a tag or release behind; nothing is
  // rolled back or deleted. Each step re-queries after a failure before reporting.
  if (local.kind === 'absent' && remote.kind === 'absent') {
    const t = git('tag', '-a', tag, sha, '-m', section.title);
    if (t.status !== 0) throw new Stop(`Creating the local tag failed (${t.stderr.trim()}). Nothing was published; run make release again.`);
    say(`  tagged   ${tag} → ${sha.slice(0, 7)} (local)`);
  }

  if (remote.kind === 'absent') {
    const p = git('push', 'origin', `refs/tags/${tag}`);
    if (p.status !== 0) {
      let after: TagState | null;
      try {
        after = remoteTag(tag, sha, section.title);
      } catch {
        after = null;
      }
      if (after?.kind !== 'match') {
        const known = after?.kind === 'absent' ? 'origin does not have it' : 'whether origin has it is unknown';
        throw new Stop(
          `Pushing ${tag} failed (${p.stderr.trim() || `exit ${p.status}`}). The tag exists locally; ${known}. ` +
            'No release was created. Run make release again: it reuses the local tag.',
        );
      }
      say(`  pushed   ${tag} (the push reported an error, but origin has the tag)`);
    } else {
      say(`  pushed   ${tag} to origin`);
    }
  }

  if (published.kind === 'absent') {
    const dir = mkdtempSync(join(tmpdir(), 'fg-release-'));
    const notesFile = join(dir, 'notes.md');
    writeFileSync(notesFile, section.notes);
    try {
      const c = exec('gh', ['release', 'create', tag, '--verify-tag', '--title', section.title, '--notes-file', notesFile]);
      if (c.status !== 0) {
        let after: ReleaseState | null;
        try {
          after = release(tag, section.title, section.notes);
        } catch {
          after = null;
        }
        if (after?.kind !== 'match') {
          const known = after?.kind === 'absent' ? 'GitHub has no release for it' : 'whether GitHub created the release is unknown';
          throw new Stop(
            `Creating the ${tag} release failed (${c.stderr.trim() || `exit ${c.status}`}). The tag is on origin; ${known}. ` +
              'Run make release again: it finds the tag and only creates a missing release, never a second one.',
          );
        }
        say(`  released ${after.url} (the request reported an error, but the release exists)`);
      } else {
        say(`  released ${c.stdout.trim()}`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  say(`\n${tag} is published.`);
  followUps(tag);
  return 0;
}

function followUps(tag: string) {
  say('\nBy hand, after owner acceptance (this command does none of them):');
  say(`  - Record ${tag} in docs/deployment.md "Deployed versions" with the site and backend commits shown above.`);
  say('  - Close the version milestone on GitHub.');
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main());
