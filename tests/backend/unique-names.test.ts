// Unique player names (#76), against the real local backend: one rule (trim, NFC, ignore case),
// enforced by the database, with a clean refusal that never reveals or opens the name's holder.
import { afterAll, describe, expect, it } from 'vitest';
import { call, db, uniqueSuffix } from './client';

const sql = db();
afterAll(() => sql.end());

const enter = (email: string, displayName?: string) =>
  call('POST', '/players', { body: displayName === undefined ? { email } : { email, displayName } });
const newEmail = (base: string) => `${base}-${uniqueSuffix()}@example.test`;

async function rowsForEmail(email: string) {
  const [row] = await sql`
    select count(distinct c.player_id)::int as players,
           (select count(*)::int from player_credentials pc where pc.player_id = any(array_agg(c.player_id))) as credentials
      from player_contacts c where lower(c.email) = lower(${email})`;
  return { players: row.players, credentials: row.credentials ?? 0 };
}

describe('player names are unique', () => {
  it('refuse a name that differs only in case, surrounding spaces or Unicode composition', async () => {
    const suffix = uniqueSuffix();
    const holderEmail = newEmail('holder');
    const holder = await enter(holderEmail, `Åse ${suffix}`); // precomposed Å
    expect(holder.status).toBe(201);

    for (const variant of [`åse ${suffix}`, `  ÅSE ${suffix}  `, `Åse ${suffix}`, `åse ${suffix.toUpperCase()}`]) {
      const email = newEmail('other');
      const refused = await enter(email, variant);
      expect(refused.status, JSON.stringify(variant)).toBe(409);
      expect(refused.body.error.code).toBe('name_taken');
      // Nothing about the holder, and no partial player, contact or credential left behind.
      expect(JSON.stringify(refused.body)).not.toContain(holderEmail);
      expect(JSON.stringify(refused.body)).not.toContain(holder.body.player.id);
      expect(refused.body.deviceCredential).toBeUndefined();
      expect(refused.body.player).toBeUndefined();
      expect(await rowsForEmail(email)).toEqual({ players: 0, credentials: 0 });
    }
    // Inner spaces still count: a different name.
    expect((await enter(newEmail('spaced'), `Åse  ${suffix}`)).status).toBe(201);
  });

  it('keep the chosen spelling for display', async () => {
    const name = `Ærlig Ørn ${uniqueSuffix()}`;
    const created = await enter(newEmail('display'), `  ${name} `);
    expect(created.body.player.displayName).toBe(name);
  });

  it('never stop an existing player from opening their own player, whatever name is typed', async () => {
    const email = newEmail('existing');
    const name = `Existing ${uniqueSuffix()}`;
    const first = await enter(email, name);
    const other = await enter(newEmail('someone'), `Someone ${uniqueSuffix()}`);
    // A second browser types someone else's name: it still opens this player, with its own name.
    const again = await enter(email, other.body.player.displayName);
    expect(again.status).toBe(200);
    expect(again.body.player).toMatchObject({ id: first.body.player.id, displayName: name });
  });

  it('give exactly one of several new emails racing for one name that name', async () => {
    const name = `Racer ${uniqueSuffix()}`;
    const emails = [1, 2, 3, 4].map((i) => newEmail(`race${i}`));
    const results = await Promise.all(emails.map((email) => enter(email, name)));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409]);
    for (const r of results.filter((r) => r.status === 409)) expect(r.body.error.code).toBe('name_taken');
    const [count] = await sql`select count(*)::int as n from players where display_name = ${name}`;
    expect(count.n).toBe(1);
    const winner = emails[results.findIndex((r) => r.status === 201)];
    for (const email of emails) expect(await rowsForEmail(email)).toEqual(email === winner ? { players: 1, credentials: 1 } : { players: 0, credentials: 0 });
  });

  it('open the winner’s player for the same new email racing with the same name, never refusing it', async () => {
    const email = newEmail('same');
    const name = `Same ${uniqueSuffix()}`;
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => enter(email, name)));
    expect(results.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 201]);
    expect(new Set(results.map((r) => r.body.player.id)).size).toBe(1);
    expect(await rowsForEmail(email)).toEqual({ players: 1, credentials: 5 });
  });
});
