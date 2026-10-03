import { Helmet } from 'react-helmet';

import NoPrerender from '~/modules/elements/no-prerender';
import useSmoothNavigate from '~/modules/hooks/use-smooth-navigate';

import ExcludeLanguagesView from './exclude-languages-view';

function ExcludeLanguages() {
  const navigate = useSmoothNavigate();
  const goBack = () => navigate('menu/');

  return (
    <>
      <Helmet>
        <title>Select Languages | DGG Karaoke</title>
      </Helmet>
      <NoPrerender>
        <ExcludeLanguagesView onClose={goBack} closeText="Return to Main Menu" />
      </NoPrerender>
    </>
  );
}

export default ExcludeLanguages;
