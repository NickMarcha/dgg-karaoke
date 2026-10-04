/**
 * sha-256 over the packed notes bytes concatenated with the score.
 *
 * This is integrity, not authenticity: it stops someone editing the score field of a captured
 * request, but anyone reading the bundle can compute a valid hash for a fabricated record. See the
 * "Abuse Posture" section of the design doc.
 *
 * The API recomputes it (server/src/leaderboard/submission.ts), so the byte layout must stay identical —
 * the score is stringified as an integer.
 */
export async function computeNotesHash(notes: Uint8Array, score: number): Promise<string> {
  const scoreBytes = new TextEncoder().encode(String(Math.round(score)));

  const payload = new Uint8Array(notes.byteLength + scoreBytes.byteLength);
  payload.set(notes, 0);
  payload.set(scoreBytes, notes.byteLength);

  const digest = await crypto.subtle.digest('SHA-256', payload as Uint8Array<ArrayBuffer>);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
