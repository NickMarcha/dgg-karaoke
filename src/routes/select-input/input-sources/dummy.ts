import { getInputId } from '~/modules/players/utils';
import isE2E from '~/modules/utils/is-e2-e';

import { InputSource } from './interfaces';

const inputList = [
  {
    channels: 2,
    channel: 0,
    label: 'Dummy Input 1',
    id: getInputId({ deviceId: 'default', channel: 0 }),
    deviceId: 'default',
  },
  {
    channels: 2,
    channel: 1,
    label: 'Dummy Input 2',
    id: getInputId({ deviceId: 'default', channel: 1 }),
    deviceId: 'default',
  },
];

/**
 * The fake input "sings" a sine wave, which is useful for developing and for the e2e specs. In
 * production it marks a player nobody has assigned a microphone to, and it never sings.
 */
export const fakeInputsAvailable = () => import.meta.env.DEV || isE2E();

export class DummyInputSource {
  public static readonly inputName = 'Dummy';

  public static getDefault = () => inputList[0];

  public static getInputs = async (): Promise<InputSource[]> => inputList;

  public static subscribeToListChange = (_callback: () => void) => undefined;
  public static unsubscribeToListChange = (_callback: () => void) => undefined;
}
