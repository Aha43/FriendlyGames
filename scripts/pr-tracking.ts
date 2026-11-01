// PR tracking check (#36): a pull request names exactly one primary issue with
// `Closes #N` (or GitHub's other closing keywords), that issue is in this repository, and it
// has a version milestone such as "v0.1.1 — …". Labels are optional and never checked.
//
// Run by .github/workflows/pr-tracking.yml with a read-only token:
//   PR_BODY=… GITHUB_REPOSITORY=owner/repo GITHUB_TOKEN=… node scripts/pr-tracking.ts
// Plain TypeScript that Node 24 runs directly (type stripping): no dependencies.

export interface IssueInfo {
  number: number;
  title: string;
  isPullRequest: boolean;
  milestone: string | null;
}

/** Looks an issue up in the repository; null if it does not exist. */
export type IssueLookup = (number: number) => Promise<IssueInfo | null>;

export type TrackingResult = { ok: true; issue: number; milestone: string } | { ok: false; error: string };

const KEYWORDS = 'close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved';
// `#12`, `owner/repo#12`, or an issue URL, after a closing keyword (as GitHub links them).
const CLOSING = new RegExp(
  `\\b(?:${KEYWORDS})\\s*:?\\s+(?:https://github\\.com/([\\w.-]+/[\\w.-]+)/issues/(\\d+)|(?:([\\w.-]+/[\\w.-]+))?#(\\d+))\\b`,
  'gi',
);
const VERSION_MILESTONE = /^v\d+\.\d+\.\d+\b/;

const HOW_TO_FIX =
  'Put exactly one "Closes #N" for this repository\'s primary issue in the PR description; use "Refs #N" for other issues.';

/** The primary closing references, ignoring comments and code (e.g. the PR template's guidance). */
export function closingReferences(body: string): { repo: string | null; number: number }[] {
  const text = body
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ');
  return [...text.matchAll(CLOSING)].map((m) => ({
    repo: m[1] ?? m[3] ?? null,
    number: Number(m[2] ?? m[4]),
  }));
}

export async function checkTracking(body: string, repository: string, lookup: IssueLookup): Promise<TrackingResult> {
  const refs = closingReferences(body);
  const distinct = [...new Map(refs.map((r) => [`${(r.repo ?? repository).toLowerCase()}#${r.number}`, r])).values()];

  if (distinct.length === 0) {
    return { ok: false, error: `No primary issue: the PR description has no "Closes #N". ${HOW_TO_FIX}` };
  }
  if (distinct.length > 1) {
    const list = distinct.map((r) => (r.repo ? `${r.repo}#${r.number}` : `#${r.number}`)).join(', ');
    return { ok: false, error: `More than one primary issue (${list}). ${HOW_TO_FIX}` };
  }
  const [ref] = distinct;
  if (ref.repo && ref.repo.toLowerCase() !== repository.toLowerCase()) {
    return {
      ok: false,
      error: `The primary issue ${ref.repo}#${ref.number} is in another repository; it must be an issue in ${repository}.`,
    };
  }

  const issue = await lookup(ref.number);
  if (!issue) return { ok: false, error: `Issue #${ref.number} doesn't exist in ${repository}. Check the number.` };
  if (issue.isPullRequest) {
    return { ok: false, error: `#${ref.number} is a pull request, not an issue. Close the issue this PR implements.` };
  }
  if (!issue.milestone) {
    return {
      ok: false,
      error: `Issue #${ref.number} has no milestone. Give it a version milestone (e.g. "v0.1.1 — …"), then re-run this check.`,
    };
  }
  if (!VERSION_MILESTONE.test(issue.milestone)) {
    return {
      ok: false,
      error: `Issue #${ref.number} is in "${issue.milestone}", which is not a version milestone. Move it to one such as "v0.1.1 — …", then re-run this check.`,
    };
  }
  return { ok: true, issue: ref.number, milestone: issue.milestone };
}

/** Reads an issue through the GitHub REST API with the workflow's read-only token. */
export function githubLookup(repository: string, token: string): IssueLookup {
  return async (number) => {
    const response = await fetch(`https://api.github.com/repos/${repository}/issues/${number}`, {
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' },
    });
    if (response.status === 404 || response.status === 410) return null;
    if (!response.ok) throw new Error(`GitHub answered ${response.status} when reading issue #${number}`);
    const data = (await response.json()) as { number: number; title: string; pull_request?: unknown; milestone: { title: string } | null };
    return { number: data.number, title: data.title, isPullRequest: data.pull_request !== undefined, milestone: data.milestone?.title ?? null };
  };
}

async function main() {
  const { PR_BODY = '', GITHUB_REPOSITORY = '', GITHUB_TOKEN = '', GITHUB_STEP_SUMMARY } = process.env;
  const result: TrackingResult = await checkTracking(PR_BODY, GITHUB_REPOSITORY, githubLookup(GITHUB_REPOSITORY, GITHUB_TOKEN)).catch(
    (e: unknown) => ({ ok: false, error: `Couldn't read the issue from GitHub (${e instanceof Error ? e.message : 'unknown error'}). Re-run this check.` }),
  );
  const line = result.ok
    ? `Tracking ok: closes #${result.issue}, milestone "${result.milestone}".`
    : `Tracking check failed: ${result.error}`;
  console.log(result.ok ? line : `::error title=PR tracking::${result.error}`);
  if (GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(GITHUB_STEP_SUMMARY, `${line}\n`);
  }
  process.exitCode = result.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) await main();
