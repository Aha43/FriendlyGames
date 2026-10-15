// Regression check (#21 review): failing setup calls must not reveal credentials or tokens.
import { expect, test } from './fixtures';

const CREDENTIAL = 'Dummy-credential_for-the-leak-check-0123456'; // 43 chars, like a real one
const TOKEN = 'Dummy-invitation-token_for-the-leak-check-9'; // 43 chars

test.describe('setup call failures', () => {
  // Port 9 (discard) is closed on test machines, so the connection fails at transport level.
  test.use({ apiBaseUrl: 'http://127.0.0.1:9/functions/v1/game-api' });

  test('report the operation but never the credential or request body', async ({ api }) => {
    const error = await api('POST', '/invitations/redeem', { credential: CREDENTIAL, data: { token: TOKEN } }).then(
      () => null,
      (e: Error) => e,
    );
    expect(error).not.toBeNull();
    expect(error!.message).toBe(
      'Setup call POST /invitations/redeem could not reach the API (transport error; details withheld)',
    );
    const everything = `${error!.message}\n${error!.stack ?? ''}`;
    expect(everything).not.toContain(CREDENTIAL);
    expect(everything).not.toContain(TOKEN);
    expect(everything).not.toMatch(/x-device-credential/i);
  });
});
