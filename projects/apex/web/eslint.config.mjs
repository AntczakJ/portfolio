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
    // caller's `deps` array straight to `useEffect` and reads `setup` / `idle`
    // via refs. The `exhaustive-deps` rule cannot statically verify a forwarded
    // deps array and false-positives on the stable `scope` ref param. Scoping
    // the exception to this one file keeps the rule active everywhere else.
    // (Pattern inherited from razors-edge; apex builds its own GSAP module.)
    files: ['src/lib/gsap/use-gsap-effect.ts'],
    rules: {
      'react-hooks/exhaustive-deps': 'off',
    },
  },
];

export default config;
