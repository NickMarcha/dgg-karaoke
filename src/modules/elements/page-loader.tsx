import clsx from 'clsx';
import { useEffect, useState } from 'react';

import Amazin from '~/modules/elements/amazin';

export default function PageLoader() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timeout = setTimeout(() => {
      setVisible(true);
    }, 500);
    return () => {
      clearTimeout(timeout);
    };
  }, []);

  return (
    <div
      className={clsx(
        'fixed inset-0 flex items-center justify-center transition-opacity duration-500',
        visible ? 'opacity-100' : 'opacity-0',
      )}>
      <Amazin className="text-6xl" />
    </div>
  );
}
