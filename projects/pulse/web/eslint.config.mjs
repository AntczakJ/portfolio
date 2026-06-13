// Next 16 ships eslint-config-next as native ESLint flat configs
// (`Linter.Config[]` arrays under the `/core-web-vitals` and `/typescript`
// subpaths). The old `FlatCompat.extends('next/...')` bridge now produces a
// "Converting circular structure to JSON" crash under ESLint 9 because it
// double-wraps an already-flat config — so we import and spread the flat
// arrays directly. `next lint` was also removed in Next 16; the `lint` script
// now calls `eslint .` against this config.
import coreWebVitals from 'eslint-config-next/core-web-vitals';
import typescript from 'eslint-config-next/typescript';

const config = [
  ...coreWebVitals,
  ...typescript,
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'next-env.d.ts',
      'scripts/**',
      // Gitignored scratch capture scripts + screenshots (see root .gitignore
      // `**/.review/`). These are throwaway Playwright capture mjs files, not
      // shipped source — lint them no more than `scripts/**`.
      '.review/**',
    ],
  },
  {
    // `react-hooks/refs` (new in the react-hooks v6 plugin that
    // eslint-config-next 16 ships) flags the deliberate "latest-value ref
    // sync" idiom — assigning `someRef.current = latestValue` during render so
    // a STABLE effect/callback can read the freshest prop or query value
    // without re-subscribing (re-opening the EventSource, recreating the uPlot
    // instance, or re-binding the alert-toast callback). This is the textbook
    // pattern the rule cannot distinguish from an accidental render-phase ref
    // write. Scoping the exception to exactly these files keeps the rule active
    // everywhere else.
    files: [
      'src/components/dashboard/status-board.tsx',
      'src/components/detail/monitor-detail-view.tsx',
      'src/components/detail/response-time-chart.tsx',
      'src/lib/sse/use-live-board.ts',
      'src/lib/sse/use-public-status-live.ts',
    ],
    rules: {
      'react-hooks/refs': 'off',
    },
  },
  {
    // `react-hooks/set-state-in-effect` (new in react-hooks v6 /
    // eslint-config-next 16) flags a synchronous setState inside an effect.
    // These call sites are the canonical, correct patterns it false-positives
    // on: the next-themes post-hydration `setMounted(true)` anti-FOUC flag
    // (theme-toggle), a one-shot fresh-result ring pulse driven by an
    // incrementing pulse token (monitor-card), and the live-checks baseline
    // reset + synthetic live-row prepend driven by SSE pulse tokens
    // (monitor-detail-view). Each sets state once in response to an external
    // signal (hydration / an SSE event), not a render loop.
    files: [
      'src/components/chrome/theme-toggle.tsx',
      'src/components/dashboard/monitor-card.tsx',
      'src/components/detail/monitor-detail-view.tsx',
    ],
    rules: {
      'react-hooks/set-state-in-effect': 'off',
    },
  },
];

export default config;
