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
    ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'],
  },
  {
    // `react-hooks/set-state-in-effect` (new in react-hooks v6 / eslint-config-next
    // 16) flags a synchronous setState inside an effect. This is the canonical
    // next-themes post-hydration `setMounted(true)` anti-FOUC flag: it sets
    // initial client state exactly once after mount to avoid a hydration
    // mismatch, not a render loop. Scoped to the one file so the rule stays
    // active everywhere else.
    files: ['src/components/theme-toggle.tsx'],
    rules: {
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  {
    // `react-hooks/refs` (new in react-hooks v6 / eslint-config-next 16) flags
    // reading `firstCommit.current` during render. That read is deliberate: the
    // rail width is driven by a Zustand-persisted store that rehydrates AFTER
    // the first client render, so the very first commit must snap width
    // instantly (`duration: 0`) to avoid the Motion-animated correction
    // registering as layout shift (CLS); every user-driven toggle afterwards
    // animates normally. Reading the latest ref value at render time is the
    // whole point of the first-commit guard. Scoped to this one file.
    files: ['src/components/chrome/side-rail.tsx'],
    rules: {
      'react-hooks/refs': 'off',
    },
  },
];

export default config;
