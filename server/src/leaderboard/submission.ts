import { unpack } from 'msgpackr';
import { z } from 'zod';

import { decodeNotesPayload, type DecodedFrequencyRecord } from '~/modules/leaderboard/notes-payload';

import {
  MAX_ID_LENGTH,
  MAX_NOTES_BYTES,
  MAX_NOTES_RECORDS,
  MAX_RECORDING_BYTES,
  MAX_SUBMITTED_TOLERANCE,
  MIN_NOTES_RECORDS,
} from './rules.js';

const schema = z.object({
  songId: z.string().min(1).max(MAX_ID_LENGTH),
  tolerance: z.number().int().min(1).max(MAX_SUBMITTED_TOLERANCE),
  mode: z.string().min(1).max(32),
  trackIndex: z.number().int().min(0).max(1),
  /** Sung against both tracks merged into one, as every game but a two-singer one is. */
  mergedTrack: z.boolean(),
  inputLag: z.number().int().min(-10_000).max(10_000),
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
  /** The video's time, in milliseconds, when the recording began: where playback starts the video. */
  recordingOffsetMs: z.number().int().min(-600_000).max(600_000).optional(),
});

export type Submission = z.infer<typeof schema> & { records: DecodedFrequencyRecord[] };

/** A run once the API has scored it against its song, with the song's own artist and title. */
export type ScoredSubmission = Submission & {
  score: number;
  artist: string;
  title: string;
  songLastUpdate: string | null;
};

export class SubmissionRefused extends Error {}

/**
 * A run as the game packs it: msgpack, with the sung frequency records packed again inside. It
 * carries no score: the API scores the records against the song itself (`scoreRun`).
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

  let records: DecodedFrequencyRecord[];
  try {
    records = decodeNotesPayload(run.notes);
  } catch {
    throw new SubmissionRefused('The run has no readable notes.');
  }
  const readable = records.every(
    ({ timestamp, frequency }) => Number.isFinite(timestamp) && Number.isFinite(frequency),
  );
  if (!readable) throw new SubmissionRefused('The run has no readable notes.');
  if (records.length < MIN_NOTES_RECORDS || records.length > MAX_NOTES_RECORDS) {
    throw new SubmissionRefused('The run has too few or too many notes to be sung.');
  }
  return { ...run, records };
}
