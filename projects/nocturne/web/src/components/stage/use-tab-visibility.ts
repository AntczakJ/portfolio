'use client';

import { useEffect, useState } from 'react';

/**
 * Tracks `document.visibilityState === 'hidden'` so the render loop can pause on
 * a hidden tab (ADR-002 §5 battery discipline — "always while armed and visible,"
 * never burning a hidden tab).
 */
export function useTabVisibility(): boolean {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const onChange = (): void => {
      setHidden(document.visibilityState === 'hidden');
    };
    onChange();
    document.addEventListener('visibilitychange', onChange);
    return () => {
      document.removeEventListener('visibilitychange', onChange);
    };
  }, []);

  return hidden;
}
