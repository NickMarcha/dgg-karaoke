import { describe, expect, it } from 'vitest';

import * as server from '../../../server/src/leaderboard/rules';
import * as site from './consts';

// The API image holds only `server/`, so it keeps its own copy of the numbers both sides check
describe('leaderboard rules', () => {
  it('are the same on the site and the API', () => {
    expect({
      MAX_POINTS: server.MAX_POINTS,
      QUALIFYING_SCORE: server.QUALIFYING_SCORE,
      MAX_SUBMITTED_TOLERANCE: server.MAX_SUBMITTED_TOLERANCE,
      MAX_GLOBAL_BOARD_TOLERANCE: server.MAX_GLOBAL_BOARD_TOLERANCE,
      SONG_BOARD_SIZE: server.SONG_BOARD_SIZE,
      SONG_BOARD_NEIGHBOURS: server.SONG_BOARD_NEIGHBOURS,
    }).toEqual({
      MAX_POINTS: site.MAX_POINTS,
      QUALIFYING_SCORE: site.QUALIFYING_SCORE,
      MAX_SUBMITTED_TOLERANCE: site.MAX_SUBMITTED_TOLERANCE,
      MAX_GLOBAL_BOARD_TOLERANCE: site.MAX_GLOBAL_BOARD_TOLERANCE,
      SONG_BOARD_SIZE: site.SONG_BOARD_SIZE,
      SONG_BOARD_NEIGHBOURS: site.SONG_BOARD_NEIGHBOURS,
    });
  });
});
