// @vitest-environment node
// PR tracking check (#36) against fixture issues: no network.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkTracking, closingReferences, githubLookup, type IssueInfo } from '../../scripts/pr-tracking.ts';

const REPO = 'Aha43/FriendlyGames';

const ISSUES: Record<number, IssueInfo> = {
  36: { number: 36, title: 'Check PR primary issue', isPullRequest: false, milestone: 'v0.1.1 — Correct starts and repeatable development' },
  20: { number: 20, title: 'Pin explanations', isPullRequest: false, milestone: 'v0.2.0 — Learn the board while playing' },
  11: { number: 11, title: 'Old work', isPullRequest: false, milestone: 'Sprint 2 — Across the table from Harald' },
  38: { number: 38, title: 'Backlog idea', isPullRequest: false, milestone: null },
  40: { number: 40, title: 'A pull request', isPullRequest: true, milestone: null },
};
const lookup = vi.fn(async (n: number) => ISSUES[n] ?? null);
const check = (body: string) => checkTracking(body, REPO, lookup);

/** The PR template as GitHub pre-fills it, with the given Result line. */
const template = (result: string) => `## Result

${result}

<!-- Exactly one primary closing issue. Additional links use Refs #N.
     Assign the primary issue's version milestone and list it in the sprint plan
     before implementation. Sprint/area labels are optional, not CI gates. -->

Target version: v0.1.1
Sprint: 3
`;

afterEach(() => {
  lookup.mockClear();
  vi.unstubAllGlobals();
});

describe('PR tracking', () => {
  it('passes one primary issue with a version milestone, with no labels required', async () => {
    expect(await check(template('Closes #36'))).toEqual({
      ok: true,
      issue: 36,
      milestone: 'v0.1.1 — Correct starts and repeatable development',
    });
    expect(await check(template('Fixes #20\n\nRefs #11, #38'))).toMatchObject({ ok: true, issue: 20 });
    // Other spellings GitHub links: this repository named explicitly, or the issue URL.
    expect(await check('closes Aha43/friendlygames#36')).toMatchObject({ ok: true, issue: 36 });
    expect(await check('Resolves https://github.com/Aha43/FriendlyGames/issues/36')).toMatchObject({ ok: true, issue: 36 });
    // The same issue twice is still one primary issue.
    expect(await check('Closes #36\n\nThis closes #36 once merged.')).toMatchObject({ ok: true, issue: 36 });
  });

  it('fails without a primary issue, including the untouched template', async () => {
    for (const body of [template('Closes #'), template('Refs #36'), '', 'Implements issue 36.']) {
      const result = await check(body);
      expect(result).toMatchObject({ ok: false });
      expect((result as { error: string }).error).toMatch(/^No primary issue: .*Put exactly one "Closes #N"/);
    }
    expect(lookup).not.toHaveBeenCalled();
  });

  it('ignores closing words inside comments and code', async () => {
    const result = await check(template('Refs #36') + '\n<!-- Closes #20 -->\n`Closes #20`\n```\nCloses #20\n```\n');
    expect(result).toMatchObject({ ok: false });
    expect(closingReferences('<!-- Closes #20 --> `fixes #1`')).toEqual([]);
  });

  it('fails with two primary issues and names them', async () => {
    const result = await check(template('Closes #36\nCloses #20'));
    expect(result).toEqual({
      ok: false,
      error: expect.stringMatching(/^More than one primary issue \(#36, #20\)\. .*use "Refs #N" for other issues/),
    });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('fails for an issue in another repository', async () => {
    for (const body of ['Closes someone/else#36', 'Fixes https://github.com/someone/else/issues/36']) {
      const result = await check(body);
      expect(result).toEqual({ ok: false, error: expect.stringMatching(/someone\/else#36 is in another repository; it must be an issue in Aha43\/FriendlyGames/) });
    }
    expect(lookup).not.toHaveBeenCalled();
  });

  it('fails for an issue that does not exist, or is a pull request', async () => {
    expect(await check('Closes #999')).toEqual({ ok: false, error: 'Issue #999 doesn\'t exist in Aha43/FriendlyGames. Check the number.' });
    expect(await check('Closes #40')).toMatchObject({ ok: false, error: expect.stringMatching(/#40 is a pull request/) });
  });

  it('fails without a milestone, or with a legacy sprint milestone, saying how to fix it', async () => {
    expect(await check('Closes #38')).toMatchObject({
      ok: false,
      error: expect.stringMatching(/Issue #38 has no milestone\. Give it a version milestone .*then re-run this check/),
    });
    expect(await check('Closes #11')).toMatchObject({
      ok: false,
      error: expect.stringMatching(/Issue #11 is in "Sprint 2 — Across the table from Harald", which is not a version milestone/),
    });
  });
});

describe('reading issues from GitHub', () => {
  it('maps the REST answer, and treats a missing issue as absent', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith('/issues/36')
        ? new Response(JSON.stringify({ number: 36, title: 't', milestone: { title: 'v0.1.1 — x' } }), { status: 200 })
        : url.endsWith('/issues/40')
          ? new Response(JSON.stringify({ number: 40, title: 'p', pull_request: {}, milestone: null }), { status: 200 })
          : new Response('{}', { status: 404 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const read = githubLookup(REPO, 'token-123');
    expect(await read(36)).toEqual({ number: 36, title: 't', isPullRequest: false, milestone: 'v0.1.1 — x' });
    expect(await read(40)).toMatchObject({ isPullRequest: true });
    expect(await read(1)).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith('https://api.github.com/repos/Aha43/FriendlyGames/issues/36', expect.anything());
  });

  it('reports a GitHub failure instead of passing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
    await expect(githubLookup(REPO, 't')(36)).rejects.toThrow('GitHub answered 500');
  });
});
