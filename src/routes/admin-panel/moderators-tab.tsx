import { useState } from 'react';
import useSWR, { mutate } from 'swr';

import { Account, flairClass } from '~/modules/account/account';

import '~/modules/account/flairs.css';
import { readJson } from '~/modules/api';
import { Button } from '~/modules/elements/akui/button';
import { Chip } from '~/modules/elements/akui/chip';
import { Menu } from '~/modules/elements/akui/menu';
import Typography from '~/modules/elements/akui/primitives/typography';
import { Input } from '~/modules/elements/input';
import { cn } from '~/utils/cn';

interface Person extends Pick<Account, 'id' | 'username' | 'role' | 'flair'> {
  lastSeenAt: string;
}

const usersUrl = (query: string) => (query ? `/api/admin/users?${new URLSearchParams({ query })}` : '/api/admin/users');

/** Admins appoint moderators here. Admins themselves come from the API's `ADMIN_DGG_USERNAMES`. */
export default function ModeratorsTab() {
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const trimmed = query.trim();
  const { data } = useSWR(
    usersUrl(trimmed),
    async (url: string) => (await readJson<{ users: Person[] }>(await fetch(url))).users,
    { keepPreviousData: true, revalidateOnFocus: false },
  );

  const setRole = async (person: Person, role: 'singer' | 'moderator') => {
    setError(null);
    try {
      await readJson(
        await fetch(`/api/admin/users/${person.id}/role`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ role }),
        }),
      );
      // Every list this page has fetched, the staff list as much as the search in view
      await mutate((key) => typeof key === 'string' && key.startsWith('/api/admin/users'));
    } catch (failure) {
      setError((failure as Error).message);
    }
  };

  return (
    <>
      <Menu.HelpText>
        Moderators look after the songs. Admins are set on the server, in <code>ADMIN_DGG_USERNAMES</code>.
      </Menu.HelpText>
      {/* A mouse page: keyboard navigation would rebuild its order with every search result */}
      <Input
        focused={false}
        label="Find somebody"
        value={query}
        onChange={setQuery}
        placeholder="A destiny.gg name"
        data-test="admin-user-search"
      />
      <Menu.SubHeader>{trimmed ? 'Matching names' : 'Moderators and admins'}</Menu.SubHeader>
      {error && <Typography className="text-danger">{error}</Typography>}
      {data?.length === 0 && (
        <Menu.HelpText>
          {trimmed ? 'Nobody by that name has signed in yet. They need to, once, first.' : 'No moderators yet.'}
        </Menu.HelpText>
      )}
      <ul className="flex flex-col gap-2" data-test="admin-user-list">
        {data?.map((person) => (
          <li
            key={person.id}
            className="flex items-center gap-3 rounded-xl bg-black/40 px-4 py-2"
            data-test={`admin-user-${person.username}`}>
            <Typography className={cn('flex-1 truncate font-bold', flairClass(person))}>{person.username}</Typography>
            {person.role !== 'singer' && (
              <Chip variant={person.role === 'admin' ? 'orange' : 'green'}>{person.role}</Chip>
            )}
            {person.role === 'singer' && (
              <Button
                size="small"
                fullWidth={false}
                onClick={() => setRole(person, 'moderator')}
                data-test="make-moderator">
                Make moderator
              </Button>
            )}
            {person.role === 'moderator' && (
              <Button
                size="small"
                fullWidth={false}
                onClick={() => setRole(person, 'singer')}
                data-test="remove-moderator">
                Remove
              </Button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
