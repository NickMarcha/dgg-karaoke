import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import PlayersManager, { PlayerEntity, PlayersSnapshot } from '~/modules/players/players-manager';

const fake = (number: 0 | 1 | 2 | 3) => new PlayerEntity(number, { source: 'Dummy', deviceId: 'default', channel: 0 });
const phone = (number: 0 | 1 | 2 | 3) =>
  new PlayerEntity(number, { source: 'Remote Microphone', deviceId: `phone-${number}`, channel: 0 });

describe('PlayersManager.dropFakeInputs', () => {
  let before: PlayersSnapshot;

  beforeEach(() => {
    before = PlayersManager.snapshot();
  });

  afterEach(() => {
    PlayersManager.restore(before);
  });

  it('drops a player nobody gave a microphone, and does not add one back', () => {
    PlayersManager.restore({ players: [phone(0), fake(1)], minPlayerNumber: 2 });

    expect(PlayersManager.dropFakeInputs()).toBe(true);

    expect(PlayersManager.getPlayers().map((player) => player.number)).toEqual([0]);
    expect(PlayersManager.getMinPlayerNumber()).toBe(1);
  });

  it('leaves a fully set up game alone', () => {
    PlayersManager.restore({ players: [phone(0), phone(1)], minPlayerNumber: 2 });

    expect(PlayersManager.dropFakeInputs()).toBe(true);

    expect(PlayersManager.getPlayers()).toHaveLength(2);
    expect(PlayersManager.getMinPlayerNumber()).toBe(2);
  });

  it('changes nothing and says so when nobody has a microphone', () => {
    PlayersManager.restore({ players: [fake(0), fake(1)], minPlayerNumber: 2 });

    expect(PlayersManager.dropFakeInputs()).toBe(false);

    expect(PlayersManager.getPlayers()).toHaveLength(2);
  });
});
