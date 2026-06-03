import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FlatCompat } from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const config = [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts', 'scripts/**'],
  },
  {
    // `useGsapEffect` is a pass-through-deps primitive: it forwards the
    // caller's `deps` array straight to `useEffect` (React diffs the
    // caller-supplied elements) and reads `setup` / `idle` via refs. The
    // `exhaustive-deps` rule cannot statically verify a forwarded deps array
    // and false-positives on the stable `scope` ref param. The previous
    // INLINE disable broke the repo-root strict config (which does not load
    // eslint-plugin-react-hooks, so an inline `react-hooks/*` directive errors
    // as an unknown rule). Scoping the exception to this one file here keeps
    // the root config clean while leaving the rule active everywhere else.
    files: ['src/lib/gsap/use-gsap-effect.ts'],
    rules: {
      'react-hooks/exhaustive-deps': 'off',
    },
  },
];

export default config;
