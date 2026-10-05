import { useState } from 'react';
import { Helmet } from 'react-helmet';

import { signIn, useAccount } from '~/modules/account/account';
import { Menu } from '~/modules/elements/akui/menu';
import { Selector } from '~/modules/elements/akui/selector';
import MenuWithLogo from '~/modules/elements/menu-with-logo';
import NoPrerender from '~/modules/elements/no-prerender';
import useSmoothNavigate from '~/modules/hooks/use-smooth-navigate';
import DailyTab from '~/routes/admin-panel/daily-tab';
import LeaderboardTab from '~/routes/admin-panel/leaderboard-tab';
import ModeratorsTab from '~/routes/admin-panel/moderators-tab';
import SongsTab from '~/routes/admin-panel/songs-tab';
import StreamTab from '~/routes/admin-panel/stream-tab';

type Tab = 'songs' | 'daily' | 'leaderboard' | 'stream' | 'moderators';

/**
 * Where moderators look after what the community puts up, and admins appoint moderators. Admins
 * themselves come from the API's `ADMIN_DGG_USERNAMES`.
 */
function AdminPanel() {
  const { account } = useAccount();
  const navigate = useSmoothNavigate();
  const [tab, setTab] = useState<Tab>('songs');

  const isStaff = account?.role === 'moderator' || account?.role === 'admin';
  const tabs: { id: Tab; label: string }[] = [
    { id: 'songs', label: 'Songs' },
    { id: 'daily', label: 'Song of the day' },
    { id: 'leaderboard', label: 'Leaderboard' },
    { id: 'stream', label: 'Stream' },
    ...(account?.role === 'admin' ? [{ id: 'moderators' as const, label: 'Moderators' }] : []),
  ];

  return (
    <MenuWithLogo>
      <Helmet>
        <title>Admin | DGG Karaoke</title>
      </Helmet>
      <Menu.Header>Admin</Menu.Header>
      <NoPrerender>
        {account === null && (
          <>
            <Menu.HelpText>This page is for moderators. Sign in with destiny.gg first.</Menu.HelpText>
            <Menu.Button onClick={signIn}>Sign in with destiny.gg</Menu.Button>
          </>
        )}
        {account && !isStaff && <Menu.HelpText>This page is for moderators.</Menu.HelpText>}
        {isStaff && (
          <>
            <Selector value={tab} onChange={(id) => setTab(id as Tab)}>
              {tabs.map(({ id, label }) => (
                <Selector.Item key={id} value={id} size="small" aria-pressed={tab === id} data-test={`admin-tab-${id}`}>
                  {label}
                </Selector.Item>
              ))}
            </Selector>
            {tab === 'songs' && <SongsTab />}
            {tab === 'daily' && <DailyTab />}
            {tab === 'leaderboard' && <LeaderboardTab />}
            {tab === 'stream' && <StreamTab />}
            {tab === 'moderators' && <ModeratorsTab />}
          </>
        )}
      </NoPrerender>
      <Menu.Divider />
      <Menu.Button size="small" onClick={() => navigate('menu/')} data-test="back-button">
        Back to main menu
      </Menu.Button>
    </MenuWithLogo>
  );
}

export default AdminPanel;
