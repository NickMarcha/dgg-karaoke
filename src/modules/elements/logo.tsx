import { ComponentProps } from 'react';

import { Chip } from '~/modules/elements/akui/chip';
import storage from '~/modules/utils/storage';
import { MobilePhoneModeSetting, useSettingValue } from '~/routes/settings/settings-state';
import { twx } from '~/utils/twx';

if (global.location?.search.includes('pride')) {
  storage.session.setItem('pride', 'true');
}

export default function Logo(props: ComponentProps<'div'>) {
  const [mobilePhoneMode] = useSettingValue(MobilePhoneModeSetting);

  if (mobilePhoneMode) {
    return null;
  }
  return (
    <div className="relative h-[1.1em] [view-transition-name:logo]" {...props}>
      <Wordmark>
        <span className="text-active">DGG</span> Karaoke
      </Wordmark>
      {/* Stored data is disposable while this is here; removing it is the promise that it no longer is (AGENTS.md) */}
      <Chip variant="orange" className="absolute top-0 left-full ml-[1em]" data-test="beta-badge">
        Beta
      </Chip>
    </div>
  );
}

// Callers size the logo by font size, for upstream's lettering. This keeps to the width and the
// 1.1em box that lettering took, so no caller has to change.
const Wordmark = twx.span`font-display text-default text-shadow-legible block text-[0.6em] leading-[1.83] font-bold tracking-tight whitespace-nowrap`;
