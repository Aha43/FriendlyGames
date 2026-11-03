// Chess960 engine proof (#52) in the real Supabase Edge runtime: the local stack serves
// supabase/functions/chess960-proof, which runs the shared fixtures with chessops under Deno.
// CI's backend job (real Supabase) is the authoritative run. A workspace whose stand-in backend
// has no Edge runtime may set FG_NO_EDGE_RUNTIME=1 and must say so; CI never sets it.
import { describe, expect, it } from 'vitest';
import { API_URL } from './client';

const PROOF_URL = API_URL.replace(/\/game-api\/?$/, '/chess960-proof');

describe.skipIf(process.env.FG_NO_EDGE_RUNTIME === '1')('Chess960 rules in the Edge runtime', () => {
  it('passes every fixture under the Edge runtime’s Deno', async () => {
    const response = await fetch(PROOF_URL);
    const body = await response.json();
    expect(body.failures).toEqual([]);
    expect(response.status).toBe(200);
    expect(body.checks).toBe(7);
    // The Edge runtime reports e.g. "supabase-edge-runtime-1.74.0 (compatible with Deno v2.1.4)".
    expect(body.runtime.deno).toMatch(/(^|Deno v)2\.\d+/);
  });
});
