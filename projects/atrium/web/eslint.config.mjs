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
    ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts', 'scripts/**'],
  },
  {
    // `useGsapEffect` is a pass-through-deps primitive: it forwards the
    // caller's `deps` array straight to `useEffect` (React diffs the
    // caller-supplied elements) and reads `setup` / `idle` via refs. The
    // `exhaustive-deps` rule cannot statically verify a forwarded deps array
    // and false-positives on the stable `scope` ref param. `react-hooks/refs`
    // (new in the react-hooks v6 plugin that eslint-config-next 16 ships)
    // flags the deliberate `idleRef.current = idle` latest-value sync, which
    // is the whole point of the primitive. Scoping both exceptions to this one
    // file keeps the rules active everywhere else (the razors-edge precedent).
    files: ['src/lib/gsap/use-gsap-effect.ts'],
    rules: {
      'react-hooks/exhaustive-deps': 'off',
      'react-hooks/refs': 'off',
    },
  },
  {
    // `react-hooks/set-state-in-effect` (new in react-hooks v6 / eslint-config-next
    // 16) flags a synchronous setState inside an effect. These two call sites are
    // the canonical, correct patterns it false-positives on: the next-themes
    // post-hydration `setMounted(true)` anti-FOUC flag, and the
    // IntersectionObserver-unavailable fallback that reveals the header when no
    // observer exists. Both set initial client state once, not a render loop.
    files: [
      'src/components/chrome/theme-toggle.tsx',
      'src/components/chrome/site-header.tsx',
    ],
    rules: {
      'react-hooks/set-state-in-effect': 'off',
    },
  },
];

export default config;
