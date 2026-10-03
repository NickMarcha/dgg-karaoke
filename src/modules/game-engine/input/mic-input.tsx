import posthog from 'posthog-js';

import InputInterface from '~/modules/game-engine/input/interface';
import AubioStrategy from '~/modules/game-engine/input/mic-strategies/aubio';
import events from '~/modules/game-events/game-events';
import userMediaService from '~/modules/user-media/user-media-service';

export class MicInput implements InputInterface {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;

  private interval: ReturnType<typeof setInterval> | null = null;

  private frequencies: number[] = [0, 0];
  private volumes: number[] = [0, 0];

  private startedMonitoring = false;

  /** Read when monitoring starts: one analyser per channel. */
  public channels = 2;

  public startMonitoring = async (deviceId?: string) => {
    if (this.startedMonitoring) return;
    this.startedMonitoring = true;

    try {
      this.stream = await this.acquireStream(deviceId);
      this.stream.getTracks().forEach((track) => {
        track.enabled = true;
      });
      try {
        this.context = new AudioContext({
          sampleRate: 44100,
        });

        const source = this.context.createMediaStreamSource(this.stream);

        const analysers = Array.from({ length: this.channels }, () => {
          const analyser = this.context!.createAnalyser();
          analyser.fftSize = 2048;
          analyser.minDecibels = -100;
          return analyser;
        });

        if (this.channels > 1) {
          const splitter = this.context.createChannelSplitter(2);
          source.connect(splitter);

          analysers.forEach((analyser, i) => {
            splitter.connect(analyser, i);
          });
        } else {
          source.connect(analysers[0]);
        }

        console.log(this.channels);

        const strategy = new AubioStrategy();
        await strategy.init(this.context, analysers[0].fftSize);

        this.interval = setInterval(async () => {
          const frequencyData = analysers.map((analyser) => new Float32Array(analyser.fftSize));

          analysers.forEach((analyser, i) => {
            analyser.getFloatTimeDomainData(frequencyData[i]);
          });

          this.frequencies = await Promise.all(frequencyData.map((data) => strategy.getFrequency(data)));
          this.volumes = frequencyData.map((data) => this.calculateVolume(data));
        }, this.context.sampleRate / analysers[0].fftSize);

        events.micMonitoringStarted.dispatch();
      } catch (e) {
        console.error(e);
        posthog.captureException(e);
      }
    } catch (e) {
      posthog.captureException(e, { message: 'MicInput.startMonitoring' });
      console.warn(e);
    }
  };

  public getFrequencies = () => {
    return this.frequencies;
  };
  public getVolumes = () => this.volumes;
  public clearFrequencies = () => undefined;

  /** Reuses the stream from the last session while it is live: a fresh request makes Firefox ask again. */
  private acquireStream = async (deviceId?: string) => {
    const tracks = this.stream?.getTracks() ?? [];
    if (this.stream && tracks.length > 0 && tracks.every((track) => track.readyState === 'live')) return this.stream;

    return userMediaService.getUserMedia({
      audio: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        echoCancellation: false,
      },
      video: false,
    });
  };

  public stopMonitoring = async () => {
    if (!this.startedMonitoring) return;
    this.startedMonitoring = false;
    this.interval && clearInterval(this.interval);
    // Muted, not stopped: Firefox asks again for a device stopped more than a few seconds ago,
    // and the game turns monitoring on and off around every song. `release()` gives the mic back.
    this.stream?.getTracks().forEach((track) => {
      track.enabled = false;
    });
    try {
      await this.context?.close();
    } catch (e) {
      console.log('MicInput.stoMonitoring error', e);
    }

    events.micMonitoringStopped.dispatch();
  };

  /** Stops monitoring and gives the microphone back to the browser. */
  public release = async () => {
    await this.stopMonitoring();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  };

  public getInputLag = () => 180;

  private calculateVolume(input: Float32Array) {
    let i;
    let sum = 0.0;
    for (i = 0; i < input.length; ++i) {
      sum += input[i] * input[i];
    }
    return Math.sqrt(sum / input.length);
  }
  public requestReadiness = () => Promise.resolve(true);

  public getStatus = () => 'ok' as const;
}

export default new MicInput();
