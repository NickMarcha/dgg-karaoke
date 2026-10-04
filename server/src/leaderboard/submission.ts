import { createHash } from 'node:crypto';

import { unpack } from 'msgpackr';
import { z } from 'zod';

import {
  MAX_ID_LENGTH,
  MAX_NOTES_BYTES,
  MAX_NOTES_RECORDS,
  MAX_RECORDING_BYTES,
  MAX_POINTS,
  MAX_SONG_TEXT_LENGTH,
  MAX_SUBMITTED_TOLERANCE,
  MIN_NOTES_RECORDS,
  QUALIFYING_SCORE,
} from './rules.js';

const songText = z.string().min(1).max(MAX_SONG_TEXT_LENGTH);

const schema = z.object({
  songId: z.string().min(1).max(MAX_ID_LENGTH),
  artist: songText,
  title: songText,
  songLastUpdate: z.string().max(MAX_ID_LENGTH).nullable(),
  score: z.number().int().min(Math.ceil(QUALIFYING_SCORE)).max(MAX_POINTS),
  tolerance: z.number().int().min(1).max(MAX_SUBMITTED_TOLERANCE),
  mode: z.string().min(1).max(32),
  trackIndex: z.number().int().min(0).max(1),
  inputLag: z.number().int().min(-10_000).max(10_000),
  notesHash: z.string().regex(/^[0-9a-f]{64}$/),
  notes: z.instanceof(Uint8Array).refine((notes) => notes.byteLength <= MAX_NOTES_BYTES),
  /** The singer's voice through the run, when they chose to send it; see `leaderboard_recordings`. */
  recording: z
    .instanceof(Uint8Array)
    .refine((audio) => audio.byteLength > 0 && audio.byteLength <= MAX_RECORDING_BYTES)
    .optional(),
  recordingType: z
    .string()
    .regex(/^audio\/(webm|ogg|mp4)(;\s*codecs=[a-z0-9.]+)?$/i)
    .optional(),
  /** The song's time, in milliseconds, when the recording began. */
  recordingOffsetMs: z.number().int().min(-600_000).max(600_000).optional(),
});

export type Submission = z.infer<typeof schema>;

export class SubmissionRefused extends Error {}

/**
 * A run as the game packs it: msgpack, with the sung frequency records packed again inside. The hash
 * over notes and score is integrity, not authenticity, since anyone reading the site can compute
 * it; recomputing scores from the notes (layer 5 of the plan) is what will make them trustworthy.
 */
export function readSubmission(body: Uint8Array): Submission {
  let parsed: unknown;
  try {
    parsed = unpack(body);
  } catch {
    throw new SubmissionRefused('That is not a packed run.');
  }
  const result = schema.safeParse(parsed);
  if (!result.success) throw new SubmissionRefused('That run is missing something, or has an impossible value.');
  const run = result.data;
  if (run.recording && (run.recordingType === undefined || run.recordingOffsetMs === undefined)) {
    throw new SubmissionRefused('A recording needs its type and where it starts in the song.');
  }

  const expected = createHash('sha256').update(run.notes).update(String(run.score)).digest('hex');
  if (expected !== run.notesHash) throw new SubmissionRefused('The score does not match the run.');

  let records: unknown;
  try {
    records = unpack(run.notes);
  } catch {
    throw new SubmissionRefused('The run has no readable notes.');
  }
  if (!Array.isArray(records) || records.length < MIN_NOTES_RECORDS || records.length > MAX_NOTES_RECORDS) {
    throw new SubmissionRefused('The run has too few or too many notes to be sung.');
  }
  return run;
}
