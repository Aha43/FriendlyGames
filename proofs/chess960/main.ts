// Chess960 engine proof (#52) in a Vite-built browser bundle; run by scripts/chess960-browser-proof.mjs.
import { runSelfCheck } from '../../supabase/functions/_shared/chess960/fixtures.ts';

const result = runSelfCheck();
document.getElementById('result')!.textContent = JSON.stringify(result, null, 2);
(window as unknown as { chess960Proof: unknown }).chess960Proof = result;
