// Chess960 engine proof (#52) inside the Supabase Edge runtime. Served only by the local stack
// (`supabase start`, also in CI, where tests/backend/chess960-runtime.test.ts calls it). It is
// never deployed: scripts/deploy-backend.sh deploys game-api alone. Answers with the fixture
// results: 200 when every check passes in this runtime, 500 otherwise.
import { runSelfCheck } from '../_shared/chess960/fixtures.ts';

Deno.serve(() => {
  const started = performance.now();
  const result = runSelfCheck();
  const body = {
    ...result,
    runtime: { deno: Deno.version?.deno ?? null, v8: Deno.version?.v8 ?? null },
    ms: Math.round(performance.now() - started),
  };
  return new Response(JSON.stringify(body), {
    status: result.failures.length === 0 ? 200 : 500,
    headers: { 'Content-Type': 'application/json' },
  });
});
