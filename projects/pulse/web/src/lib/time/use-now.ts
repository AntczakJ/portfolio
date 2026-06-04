'use client';

import { useEffect, useState } from 'react';

/**
 * A shared 1-second clock for the "last checked Ns ago" tickers.
 *
 * One `setInterval` for the whole board (not one per card): the hook returns
 * a `now` epoch that updates every second, and every card derives its own
 * relative string from it. This keeps the tickers in lockstep and the timer
 * count at one regardless of how many monitors are on the board.
 *
 * The interval is paused when the tab is hidden (no point ticking off-screen)
 * and re-synced to the wall clock on visibility return so a backgrounded tab
 * does not show a stale "Ns ago".
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;

    const start = () => {
      setNow(Date.now());
      timer = setInterval(() => {
        setNow(Date.now());
      }, intervalMs);
    };
    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        stop();
        start();
      } else {
        stop();
      }
    };

    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intervalMs]);

  return now;
}
