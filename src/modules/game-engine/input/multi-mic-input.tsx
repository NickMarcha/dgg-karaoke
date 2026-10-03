import InputInterface from '~/modules/game-engine/input/interface';
import { MicInput } from '~/modules/game-engine/input/mic-input';
import { SelectedPlayerInput } from '~/modules/players/players-manager';

const isDeviceSelectedForMultipleChannels = (allInputs: SelectedPlayerInput[] = [], deviceId: string | undefined) => {
  const playerInputs = allInputs.filter((input) => input.deviceId === deviceId).map((input) => input.channel);
  return playerInputs.some((channel) => playerInputs[0] !== channel);
};

class MultiMicInput implements InputInterface {
  /** Kept between monitoring sessions, so each device is asked for once; see {@link releaseUnused}. */
  private devices: Record<string, MicInput> = {};
  public startMonitoring = async (deviceId?: string, allInputs?: SelectedPlayerInput[]) => {
    if (deviceId) {
      this.devices[deviceId] ??= new MicInput();
      this.devices[deviceId].channels = isDeviceSelectedForMultipleChannels(allInputs, deviceId) ? 2 : 1;
      await this.devices[deviceId].startMonitoring(deviceId);
    }
  };

  /** Gives back the devices none of `inputs` sings through. */
  public releaseUnused = async (inputs: SelectedPlayerInput[]) => {
    const used = new Set(inputs.filter((input) => input.source === 'Microphone').map((input) => input.deviceId));
    const unused = Object.keys(this.devices).filter((deviceId) => !used.has(deviceId));

    await Promise.all(unused.map((deviceId) => this.devices[deviceId].release()));
    unused.forEach((deviceId) => delete this.devices[deviceId]);
  };

  public getFrequencies = (deviceId?: string) => {
    if (deviceId && this.devices[deviceId]) {
      return this.devices[deviceId].getFrequencies();
    }
    return [0, 0];
  };

  public getVolumes = (deviceId?: string) => {
    if (deviceId && this.devices[deviceId]) {
      return this.devices[deviceId].getVolumes();
    }
    return [0, 0];
  };
  public clearFrequencies = (deviceId?: string) => {
    if (deviceId && this.devices[deviceId]) {
      return this.devices[deviceId].clearFrequencies();
    }
  };
  public stopMonitoring = async () => {
    await Promise.all(Object.values(this.devices).map((device) => device.stopMonitoring()));
  };

  public getInputLag = (deviceId?: string) => {
    if (deviceId && this.devices[deviceId]) {
      return this.devices[deviceId].getInputLag();
    }

    return 180;
  };
  public requestReadiness = async (deviceId?: string) => {
    if (deviceId && this.devices[deviceId]) {
      return this.devices[deviceId].requestReadiness();
    }

    return true;
  };

  public getStatus = (deviceId?: string) => {
    if (deviceId && this.devices[deviceId]) {
      return this.devices[deviceId].getStatus();
    }
    return 'ok' as const;
  };
}

export default new MultiMicInput();
