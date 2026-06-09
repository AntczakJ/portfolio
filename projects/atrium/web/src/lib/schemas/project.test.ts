import { describe, expect, it } from 'vitest';

import {
  PROJECT_SLUGS,
  accentTokenSchema,
  projectBackendSchema,
  projectSchema,
  projectsSchema,
} from './project';

/**
 * Unit suite — the `Project` Zod schema (Phase 6, Task 6.1).
 *
 * The schema is the contract `src/data/projects.ts` is validated against at
 * module load. These tests assert the contract REJECTS malformed input — the
 * invariants that catch a mis-typed entry at build time rather than rendering a
 * broken bay. The "real data is correct" assertions live in `data/projects.test.ts`;
 * here we prove the guard rails themselves bite.
 *
 * A minimal valid entry the negative cases mutate. It is deliberately a
 * web-only project (null backend) so each negative case changes exactly one
 * thing.
 */
const VALID_WEB_ONLY = {
  slug: 'razors-edge',
  name: "razor's edge",
  tagline: 'Cinematic dark-luxe barbershop',
  pitch: 'A cinematic barbershop marketing site with a scroll-driven hero.',
  category: 'web-only',
  backend: null,
  stack: ['Next 15', 'GSAP (scroll)'],
  accentToken: '--bay-razors-edge',
  wowMoment: 'A blade sweeps across the wordmark and slices it open.',
  demoUrl: 'https://razors-edge-demo.fly.dev',
  repoUrl: 'https://github.com/janantczak/portfolio/tree/main/projects/razors-edge',
  year: 2026,
} as const;

const VALID_API_HEAVY = {
  slug: 'tape',
  name: 'tape',
  tagline: 'Real-time orderflow terminal',
  pitch: 'A real-time orderflow visualizer for crypto perpetual futures.',
  category: 'api-heavy',
  backend: 'Elysia (Bun)',
  stack: ['Next 15', 'Elysia (Bun)', 'Rust worker'],
  accentToken: '--bay-tape',
  wowMoment: 'A live Canvas2D footprint chart redrawing the order book.',
  demoUrl: 'https://tape-demo.fly.dev',
  repoUrl: 'https://github.com/janantczak/portfolio/tree/main/projects/tape',
  year: 2026,
} as const;

describe('projectSchema — accepts well-formed entries', () => {
  it('parses a valid web-only project', () => {
    expect(() => projectSchema.parse(VALID_WEB_ONLY)).not.toThrow();
  });

  it('parses a valid api-heavy project', () => {
    expect(() => projectSchema.parse(VALID_API_HEAVY)).not.toThrow();
  });
});

describe('projectSchema — rejects malformed input (strict)', () => {
  it('rejects an unknown slug', () => {
    expect(() =>
      projectSchema.parse({ ...VALID_WEB_ONLY, slug: 'not-a-project' }),
    ).toThrow();
  });

  it('rejects an unknown extra key (.strict())', () => {
    expect(() =>
      projectSchema.parse({ ...VALID_WEB_ONLY, surpriseField: 'nope' }),
    ).toThrow();
  });

  it('rejects a non-URL demoUrl', () => {
    expect(() =>
      projectSchema.parse({ ...VALID_WEB_ONLY, demoUrl: 'not a url' }),
    ).toThrow();
  });

  it('rejects a non-URL repoUrl', () => {
    expect(() =>
      projectSchema.parse({ ...VALID_WEB_ONLY, repoUrl: 'github.com/foo' }),
    ).toThrow();
  });

  it('rejects an empty name', () => {
    expect(() => projectSchema.parse({ ...VALID_WEB_ONLY, name: '' })).toThrow();
  });

  it('rejects an empty stack array', () => {
    expect(() =>
      projectSchema.parse({ ...VALID_WEB_ONLY, stack: [] }),
    ).toThrow();
  });

  it('rejects a non-integer year', () => {
    expect(() =>
      projectSchema.parse({ ...VALID_WEB_ONLY, year: 2026.5 }),
    ).toThrow();
  });

  it('rejects an unknown backend value', () => {
    expect(() =>
      projectSchema.parse({
        ...VALID_API_HEAVY,
        backend: 'Express',
      }),
    ).toThrow();
  });
});

describe('projectSchema — category/backend invariant (superRefine)', () => {
  it('rejects an api-heavy project with a null backend', () => {
    const result = projectSchema.safeParse({ ...VALID_API_HEAVY, backend: null });
    expect(result.success).toBe(false);
    if (!result.success) {
      const backendIssue = result.error.issues.find((i) => i.path[0] === 'backend');
      expect(backendIssue?.message).toContain('must name a backend');
    }
  });

  it('rejects a web-only project with a non-null backend', () => {
    const result = projectSchema.safeParse({ ...VALID_WEB_ONLY, backend: 'Fastify' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const backendIssue = result.error.issues.find((i) => i.path[0] === 'backend');
      expect(backendIssue?.message).toContain('must have a null backend');
    }
  });
});

describe('projectSchema — accentToken must match the slug', () => {
  it('rejects an accentToken that does not match the slug', () => {
    const result = projectSchema.safeParse({
      ...VALID_API_HEAVY,
      accentToken: '--bay-atlas',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const tokenIssue = result.error.issues.find((i) => i.path[0] === 'accentToken');
      expect(tokenIssue?.message).toContain('--bay-tape');
    }
  });
});

describe('projectsSchema — collection contract', () => {
  const sixValid = PROJECT_SLUGS.map((slug, index) => ({
    ...VALID_WEB_ONLY,
    slug,
    name: slug,
    accentToken: `--bay-${slug}`,
    // alternate categories so the array exercises both branches, but keep the
    // backend invariant satisfied either way.
    ...(index % 2 === 0
      ? { category: 'web-only', backend: null }
      : { category: 'api-heavy', backend: 'Fastify' }),
  }));

  it('accepts exactly six entries in canonical order', () => {
    expect(() => projectsSchema.parse(sixValid)).not.toThrow();
  });

  it('rejects fewer than six entries', () => {
    expect(() => projectsSchema.parse(sixValid.slice(0, 5))).toThrow();
  });

  it('rejects more than six entries', () => {
    expect(() =>
      projectsSchema.parse([...sixValid, { ...sixValid[0] }]),
    ).toThrow();
  });

  it('rejects six entries in the wrong order', () => {
    const swapped = [sixValid[1], sixValid[0], ...sixValid.slice(2)];
    const result = projectsSchema.safeParse(swapped);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain('canonical order');
    }
  });
});

describe('enum exports stay aligned with the portfolio truth', () => {
  it('the six slugs are exactly the canonical set in order', () => {
    expect([...PROJECT_SLUGS]).toEqual([
      'tape',
      'meld',
      'razors-edge',
      'pulse',
      'apex',
      'atlas',
    ]);
  });

  it('the backend enum is exactly the four distinct backends', () => {
    expect(projectBackendSchema.options).toEqual([
      'Elysia (Bun)',
      'Hono (Node)',
      'NestJS',
      'Fastify',
    ]);
  });

  it('the accent tokens are the six atrium-local --bay-<slug> names', () => {
    expect(accentTokenSchema.options).toEqual([
      '--bay-tape',
      '--bay-meld',
      '--bay-razors-edge',
      '--bay-pulse',
      '--bay-apex',
      '--bay-atlas',
    ]);
  });
});
