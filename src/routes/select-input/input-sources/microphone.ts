import { range } from 'es-toolkit';
import posthog from 'posthog-js';

import { getInputId } from '~/modules/players/utils';
import userMediaService from '~/modules/user-media/user-media-service';

import { InputSource } from './interfaces';

interface NameMapper {
  test: (label: string, channel: number, channels: number) => boolean;
  map: (label: string, channel: number) => string;
}

const singstarWirelessMicMapper: NameMapper = {
  test: (label) =>
    label.toLowerCase().includes('wireless mic #') || label.toLowerCase().includes('sony wireless singstar'),
  map: (_, channel) => `SingStar Wireless - ${channel === 0 ? 'Blue' : 'Red'}`,
};
const singstarWiredMicMapper: NameMapper = {
  test: (label) => label.toLowerCase().includes('usbmic serial#') || label.toLowerCase().includes('singstar'),
  map: (_, channel) => `SingStar Wired - ${channel === 0 ? 'Blue' : 'Red'}`,
};
const singstarGenericMapper: NameMapper = {
  test: (label, _, channels) => channels === 2 && label.toLowerCase().includes('singstar'),
  map: (_, channel) => `SingStar Mic - ${channel === 0 ? 'Blue' : 'Red'}`,
};

const getPreferred = (...[label, ch, channels]: Parameters<NameMapper['test']>) =>
  singstarWiredMicMapper.test(label, ch, channels) ||
  singstarWirelessMicMapper.test(label, ch, channels) ||
  singstarGenericMapper.test(label, ch, channels)
    ? ch
    : undefined;

const mapInputName = (label: string, channel: number, channels: number) => {
  if (singstarWirelessMicMapper.test(label, channel, channels)) return singstarWirelessMicMapper.map(label, channel);
  if (singstarWiredMicMapper.test(label, channel, channels)) return singstarWiredMicMapper.map(label, channel);
  if (singstarGenericMapper.test(label, channel, channels)) return singstarGenericMapper.map(label, channel);

  return channels > 1 ? `${label} (ch ${channel + 1})` : label;
};

export class MicrophoneInputSource {
  private static inputList: InputSource[] = [];
  public static readonly inputName = 'Microphone';

  public static getDefault = () =>
    MicrophoneInputSource.inputList.find((input) => input.id === getInputId({ deviceId: 'default', channel: 0 })) ??
    MicrophoneInputSource.inputList[0] ??
    null;

  private static pending: Promise<InputSource[]> | null = null;
  private static granted = false;
  /** Channel counts already read, by device and label: reading one opens the device, which can prompt. */
  private static channelCounts = new Map<string, number>();

  /**
   * Overlapping callers share one round of requests: Firefox in a private window asks again for
   * every one, and a device change arriving while the setup screen loads the list would otherwise
   * start a second round on top of the first.
   */
  public static getInputs = (): Promise<InputSource[]> => {
    MicrophoneInputSource.pending ??= MicrophoneInputSource.readInputs().finally(() => {
      MicrophoneInputSource.pending = null;
    });
    return MicrophoneInputSource.pending;
  };

  private static readInputs = async (): Promise<InputSource[]> => {
    let devices: MediaDeviceInfo[] = [];

    try {
      // Once per page: a grant makes Firefox fire `devicechange`, and asking again on every one of
      // those prompts again in a private window, forever.
      if (!MicrophoneInputSource.granted) {
        await userMediaService.getUserMedia({ audio: true, video: false });
        MicrophoneInputSource.granted = true;
      }

      devices = await userMediaService.enumerateDevices();
    } catch (e) {
      posthog.captureException(e, { message: 'Microphone.getInputs' });
      console.warn(e);
    }

    const inputList = await Promise.all(
      devices
        .filter((device) => device.kind === 'audioinput')
        .map(async (device) => {
          const channels = await MicrophoneInputSource.readChannelCount(device);

          return range(0, channels).map((channel) => ({
            label: mapInputName(device.label, channel, channels),
            channel,
            channels,
            deviceId: device.deviceId,
            id: getInputId({ deviceId: device.deviceId, channel }),
            preferred: getPreferred(device.label, channel, channels),
          }));
        }),
    );
    MicrophoneInputSource.inputList = inputList.flat();

    return MicrophoneInputSource.inputList;
  };

  private static readChannelCount = async (device: MediaDeviceInfo) => {
    // The label is part of the key because Chrome's `default` keeps its id when it moves to another device
    const key = `${device.deviceId};${device.label}`;
    const known = MicrophoneInputSource.channelCounts.get(key);
    if (known !== undefined) return known;

    // device.getCapabilities() stopped returning channelCount, so instead we have to get
    // the stream and check the track's settings to get the channel count
    let channels = 1;
    try {
      const stream = await userMediaService.getUserMedia({
        audio: {
          deviceId: { exact: device.deviceId },
          echoCancellation: { exact: false },
        },
        video: false,
      });
      channels = stream.getAudioTracks()[0].getSettings().channelCount ?? 1;
    } catch (e) {
      console.warn(e);
    }
    MicrophoneInputSource.channelCounts.set(key, channels);

    return channels;
  };

  public static subscribeToListChange = (callback: () => void) =>
    navigator.mediaDevices.addEventListener('devicechange', callback);
  public static unsubscribeToListChange = (callback: () => void) =>
    navigator.mediaDevices.removeEventListener('devicechange', callback);
}
