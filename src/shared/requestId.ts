/**
 * A random UUID (v4) for an action's request ID.
 *
 * Not crypto.randomUUID(): browsers only provide it in secure contexts (HTTPS or localhost),
 * so it is missing when a phone opens the dev server by LAN address (http://10.0.0.x).
 * crypto.getRandomValues() is available everywhere.
 */
export function newRequestId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
