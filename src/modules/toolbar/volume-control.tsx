import { ComponentProps, useRef } from 'react';

import { Button } from '~/modules/elements/akui/button';
import { Icon } from '~/modules/elements/akui/icon';
import { Tooltip } from '~/modules/elements/tooltip';
import { formatVolume, MasterVolumeSetting, useSettingValue } from '~/routes/settings/settings-state';

interface Props {
  size?: ComponentProps<typeof Button>['size'];
}

/** The master volume, on every screen that has a toolbar. The button mutes and restores. */
function VolumeControl({ size }: Props) {
  const [volume, setVolume] = useSettingValue(MasterVolumeSetting);
  const beforeMute = useRef(volume || 1);

  const toggleMute = () => {
    if (volume > 0) {
      beforeMute.current = volume;
      setVolume(0);
    } else {
      setVolume(beforeMute.current);
    }
  };

  return (
    <div className="flex items-center gap-1">
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={volume}
        onChange={(e) => setVolume(Number(e.currentTarget.value))}
        // Arrow keys belong to the game's menus, which ignore keys while an input has focus, so the
        // slider is for the pointer only and lets go of focus as soon as it is released.
        onPointerUp={(e) => e.currentTarget.blur()}
        onKeyDown={(e) => e.preventDefault()}
        tabIndex={-1}
        aria-label="Volume"
        aria-valuetext={formatVolume(volume)}
        data-test="master-volume-slider"
        className="accent-active hidden w-24 cursor-pointer md:block"
      />
      <Tooltip title={`Volume ${formatVolume(volume)}`} place="bottom-end">
        <Button
          size={size}
          type="button"
          aria-label={volume > 0 ? 'Mute' : 'Unmute'}
          onClick={toggleMute}
          data-test="toggle-mute"
          leftIcon={
            <Icon
              icon={
                volume === 0
                  ? 'ic:baseline-volume-off'
                  : volume < 0.5
                    ? 'ic:baseline-volume-down'
                    : 'ic:baseline-volume-up'
              }
            />
          }
        />
      </Tooltip>
    </div>
  );
}

export default VolumeControl;
