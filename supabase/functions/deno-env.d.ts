// Minimal Deno globals used by the Edge Functions, so `npm run typecheck` can check them
// with the project's TypeScript (the Supabase runtime itself only transpiles).
declare namespace Deno {
  const env: { get(key: string): string | undefined };
  function serve(handler: (request: Request) => Response | Promise<Response>): unknown;
}
