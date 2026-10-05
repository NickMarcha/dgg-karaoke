import { useState } from 'react';
import useSWR from 'swr';

import { readJson } from '~/modules/api';
import { Menu } from '~/modules/elements/akui/menu';
import { Input } from '~/modules/elements/input';

const STREAM_KEY_URL = '/api/moderation/stream-key';

const streamLink = (key: string) => new URL(`/stream/?key=${key}`, window.location.origin).toString();

/**
 * This moderator's OBS link (docs/plans/stream-view.md): a browser source that follows the online
 * room they sing in. The key is theirs alone; making a new link stops the old one working.
 */
export default function StreamTab() {
  const { data: key, mutate } = useSWR(
    STREAM_KEY_URL,
    async (url: string) => (await readJson<{ key: string | null }>(await fetch(url))).key,
    { revalidateOnFocus: false },
  );
  const [copied, setCopied] = useState(false);

  const renew = async () => {
    const { key: renewed } = await readJson<{ key: string }>(await fetch(STREAM_KEY_URL, { method: 'POST' }));
    await mutate(renewed, { revalidate: false });
    setCopied(false);
  };
  const copy = async () => {
    if (!key) return;
    await navigator.clipboard.writeText(streamLink(key));
    setCopied(true);
  };

  return (
    <div className="flex flex-col gap-3" data-test="admin-stream">
      <Menu.HelpText>
        Add this link to OBS as a browser source (1920×1080, with &quot;Control audio via OBS&quot; on). It follows the
        online room you sing in and shows the song with everyone on your stream, each in time with the song, half a
        second behind the singing. Capture that source and its audio, not your own game.
      </Menu.HelpText>
      <Menu.HelpText>
        Nobody else&apos;s singing is on it until they ask in the room and you accept them. Keep the link to yourself:
        anyone with it sees what your stream sees. Add <code>&amp;delay=1000</code> to play further behind if a
        singer&apos;s connection is slow.
      </Menu.HelpText>
      {key ? (
        <>
          <Input
            focused={false}
            readOnly
            label="Your OBS link"
            value={streamLink(key)}
            onChange={() => undefined}
            data-test="admin-stream-link"
          />
          <Menu.Button size="small" onClick={copy} data-test="admin-stream-copy">
            {copied ? 'Copied' : 'Copy the link'}
          </Menu.Button>
          <Menu.Button size="small" onClick={renew} data-test="admin-stream-renew">
            Make a new link (the old one stops working)
          </Menu.Button>
        </>
      ) : (
        key === null && (
          <Menu.Button size="small" onClick={renew} data-test="admin-stream-renew">
            Make my OBS link
          </Menu.Button>
        )
      )}
    </div>
  );
}
