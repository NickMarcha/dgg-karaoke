import isE2E from '~/modules/utils/is-e2-e';
import { MasterVolumeSetting } from '~/routes/settings/settings-state';

/**
 * "black lover, instrumental only" by Tiny Ghost Studios, the menus' soundtrack. It plays through
 * SoundCloud's embedded player, driven by its Widget API, which is how SoundCloud lets a track play on
 * another site: the audio stays on SoundCloud and the menu footer credits the uploader. The player
 * is loaded the first time music is wanted and kept out of sight.
 */
const TRACK_URL = 'https://api.soundcloud.com/tracks/813856564';
const WIDGET_API = 'https://w.soundcloud.com/player/api.js';
/** Of the master volume: a soundtrack under the menus, not over them. */
const VOLUME = 0.3;

interface Widget {
  bind(event: string, listener: () => void): void;
  play(): void;
  pause(): void;
  seekTo(milliseconds: number): void;
  setVolume(percent: number): void;
}

declare global {
  interface Window {
    SC?: { Widget: ((iframe: HTMLIFrameElement) => Widget) & { Events: Record<string, string> } };
  }
}

class SoundCloudMusic {
  private widget: Promise<Widget> | null = null;
  private wanted = false;
  private isPlaying = false;

  constructor() {
    MasterVolumeSetting.addListener(() => void this.widget?.then(this.applyVolume));
    // A browser refuses sound until the page has been used, so the first click or key starts it
    global.addEventListener?.('pointerdown', this.resume, { capture: true });
    global.addEventListener?.('keydown', this.resume, { capture: true });
  }

  private applyVolume = (widget: Widget) => widget.setVolume(VOLUME * MasterVolumeSetting.get() * 100);

  private load = () =>
    (this.widget ??= new Promise<Widget>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = WIDGET_API;
      script.onerror = reject;
      script.onload = () => {
        const iframe = document.createElement('iframe');
        iframe.src = `https://w.soundcloud.com/player/?${new URLSearchParams({
          url: TRACK_URL,
          auto_play: 'false',
          visual: 'false',
          show_artwork: 'false',
        })}`;
        iframe.allow = 'autoplay';
        iframe.title = 'Background music';
        iframe.tabIndex = -1;
        iframe.setAttribute('aria-hidden', 'true');
        iframe.style.cssText = 'position:fixed;width:1px;height:1px;left:-10px;bottom:0;opacity:0;pointer-events:none';
        document.body.appendChild(iframe);

        const { Widget } = window.SC!;
        const widget = Widget(iframe);
        widget.bind(Widget.Events.READY, () => resolve(widget));
        widget.bind(Widget.Events.PLAY, () => (this.isPlaying = true));
        widget.bind(Widget.Events.PAUSE, () => (this.isPlaying = false));
        // Loops, as the menu music always has
        widget.bind(Widget.Events.FINISH, () => {
          widget.seekTo(0);
          widget.play();
        });
      };
      document.head.appendChild(script);
    }));

  private resume = () => {
    if (this.wanted && !this.isPlaying) void this.play();
  };

  public play = async () => {
    // The specs stay off the network: they would wait on SoundCloud on every screen
    if (isE2E() || import.meta.env.MODE === 'test') return;
    this.wanted = true;
    try {
      const widget = await this.load();
      if (!this.wanted) return;
      this.applyVolume(widget);
      widget.play();
    } catch (error) {
      console.warn('The background music could not load', error);
    }
  };

  /** Pauses rather than rewinds: the menus come back to the track where they left it. */
  public stop = () => {
    this.wanted = false;
    void this.widget?.then((widget) => widget.pause());
  };

  public playing = () => this.isPlaying;
}

export default SoundCloudMusic;
