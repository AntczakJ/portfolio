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
    // (new in the react-hooks v7 plugin that eslint-config-next 16 ships)
    // flags the deliberate `setupRef.current = setup` / `idleRef.current =
    // idle` latest-value sync during render — which is the whole point of the
    // primitive (it forwards a fresh inline callback every render without
    // making it the effect's dependency). Scoping both exceptions to this one
    // file keeps the rules active everywhere else.
    files: ['src/lib/gsap/use-gsap-effect.ts'],
    rules: {
      'react-hooks/exhaustive-deps': 'off',
      'react-hooks/refs': 'off',
    },
  },
  {
    // The booking wizard computes the AnimatePresence slide `direction` by
    // comparing the current step index against the previous one held in a ref
    // (`currentIndex >= prevIndexRef.current ? 1 : -1`), then syncs the ref in
    // a `[currentIndex]` effect — the canonical Motion "remember previous
    // value across renders to derive a transition direction" pattern. The
    // read-during-render is deliberate: `direction` only feeds the slide
    // variant (a visual-only enter/exit offset), never the rendered content,
    // so it cannot cause a missed update. `react-hooks/refs` (react-hooks v7,
    // shipped by eslint-config-next 16) cannot distinguish this safe,
    // animation-only ref read from an unsafe one. Scoped to this one file so
    // the rule stays active across the rest of the wizard and the app.
    files: ['src/components/booking/booking-wizard.tsx'],
    rules: {
      'react-hooks/refs': 'off',
    },
  },
  {
    // `react-hooks/set-state-in-effect` (react-hooks v7 / eslint-config-next
    // 16) flags a synchronous setState inside an effect. This is the canonical
    // next-themes post-hydration `setMounted(true)` anti-FOUC flag: it sets
    // initial client state exactly once after mount so the toggle can render
    // the resolved theme without a server/client mismatch — not a render loop.
    files: ['src/components/chrome/theme-toggle.tsx'],
    rules: {
      'react-hooks/set-state-in-effect': 'off',
    },
  },
];

export default config;
