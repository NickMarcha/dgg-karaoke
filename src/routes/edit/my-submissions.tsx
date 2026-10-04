import useSWR from 'swr';

import { useAccount } from '~/modules/account/account';
import { Chip } from '~/modules/elements/akui/chip';
import Typography from '~/modules/elements/akui/primitives/typography';
import { CommunitySongStatus, fetchMySongs, MY_SONGS_URL } from '~/modules/songs/community';

const statusChip: Record<CommunitySongStatus, { label: string; variant: 'info' | 'success' | 'danger' | 'slate' }> = {
  submitted: { label: 'Waiting for review', variant: 'info' },
  published: { label: 'Published', variant: 'success' },
  rejected: { label: 'Rejected', variant: 'danger' },
  archived: { label: 'Replaced', variant: 'slate' },
};

/** The songs this account sent to DGG Karaoke, and what the moderators made of them. */
export default function MySubmissions() {
  const { account } = useAccount();
  const { data } = useSWR(account ? MY_SONGS_URL : null, fetchMySongs, { revalidateOnFocus: false });

  if (!data?.length) return null;

  return (
    <section className="flex flex-col gap-2 rounded-xl bg-black/75 p-4" data-test="my-submissions">
      <Typography className="text-lg font-bold">Songs you submitted</Typography>
      <ul className="flex flex-col gap-2">
        {data.map((song) => (
          <li key={song.id} className="flex flex-col gap-1" data-test="my-submission">
            <div className="flex items-center gap-2">
              <Typography className="flex-1 truncate">
                {song.artist} — {song.title}
              </Typography>
              <Chip variant={statusChip[song.status].variant}>{statusChip[song.status].label}</Chip>
            </div>
            {song.rejectionReason && <Typography className="text-sm">{song.rejectionReason}</Typography>}
          </li>
        ))}
      </ul>
    </section>
  );
}
