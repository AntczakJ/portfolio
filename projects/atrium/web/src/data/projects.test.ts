import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { GITHUB_BASE, GITHUB_PLACEHOLDER, REPO_LINKS_LIVE } from '@/lib/site-config';

import { PROJECTS } from './projects';

/**
 * Unit suite — the `PROJECTS` config + the single `GITHUB_BASE` seam
 * (Phase 6, Task 6.1).
 *
 * Asserts the portfolio truth that `src/data/projects.ts` encodes:
 *   - all six projects present, in canonical order (tape … atlas);
 *   - every `demoUrl` is a valid URL matching the real public Fly URL;
 *   - every `repoUrl` derives from `GITHUB_BASE` (the R1 monorepo deep-link);
 *   - the category/backend split is 4 api-heavy (Elysia/Bun, Hono, NestJS,
 *     Fastify) + 2 web-only;
 *   - and the load-bearing GUARD: NO inline hardcoded `github.com` string exists
 *     anywhere in `src/` outside the single `site-config.ts` constant — the one
 *     flippable seam (ADR-001 / ADR-003).
 *
 * `PROJECTS` is already `projectsSchema.parse`-validated at module load, so an
 * import here also exercises the build-time validation; these tests pin the
 * SPECIFIC truth on top of the shape.
 */

const CANONICAL_ORDER = [
  'tape',
  'meld',
  'razors-edge',
  'pulse',
  'apex',
  'atlas',
] as const;

/** The real public Fly URLs — the portfolio truth (ADR-003). */
const EXPECTED_DEMO_URLS: Record<string, string> = {
  tape: 'https://tape-demo.fly.dev',
  meld: 'https://meld-demo.fly.dev',
  'razors-edge': 'https://razors-edge-demo.fly.dev',
  pulse: 'https://pulse-demo-web.fly.dev',
  apex: 'https://apex-rentals.fly.dev',
  atlas: 'https://atlas-ops.fly.dev',
};

/** The api-heavy projects and their distinct backends. */
const EXPECTED_BACKENDS: Record<string, string | null> = {
  tape: 'Elysia (Bun)',
  meld: 'Hono (Node)',
  'razors-edge': null,
  pulse: 'NestJS',
  apex: null,
  atlas: 'Fastify',
};

describe('PROJECTS — presence + canonical order', () => {
  it('has exactly six projects', () => {
    expect(PROJECTS).toHaveLength(6);
  });

  it('lists them in the canonical portfolio order', () => {
    expect(PROJECTS.map((p) => p.slug)).toEqual([...CANONICAL_ORDER]);
  });
});

describe('PROJECTS — demo URLs', () => {
  it.each(CANONICAL_ORDER)('%s demoUrl is the real public Fly URL', (slug) => {
    const project = PROJECTS.find((p) => p.slug === slug);
    expect(project?.demoUrl).toBe(EXPECTED_DEMO_URLS[slug]);
  });

  it('every demoUrl is a parseable absolute URL', () => {
    for (const project of PROJECTS) {
      expect(() => new URL(project.demoUrl)).not.toThrow();
      expect(new URL(project.demoUrl).protocol).toBe('https:');
    }
  });
});

describe('PROJECTS — repoUrl derives from GITHUB_BASE (the single seam)', () => {
  it.each(CANONICAL_ORDER)('%s repoUrl is the R1 monorepo deep-link', (slug) => {
    const project = PROJECTS.find((p) => p.slug === slug);
    expect(project?.repoUrl).toBe(
      `${GITHUB_BASE}/tree/main/projects/${slug}`,
    );
  });

  it('every repoUrl starts with GITHUB_BASE', () => {
    for (const project of PROJECTS) {
      expect(project.repoUrl.startsWith(GITHUB_BASE)).toBe(true);
    }
  });

  it('REPO_LINKS_LIVE is false while the placeholder base is in force', () => {
    // No remote exists yet (CLAUDE.md § 10) — the U2 disabled affordance ships.
    // If a real NEXT_PUBLIC_GITHUB_BASE is ever set in the test env this flips;
    // the assertion documents the default ship state.
    expect(REPO_LINKS_LIVE).toBe(GITHUB_BASE !== GITHUB_PLACEHOLDER);
  });
});

describe('PROJECTS — category / backend badges (4 api-heavy + 2 web-only)', () => {
  it('has exactly four api-heavy and two web-only projects', () => {
    const apiHeavy = PROJECTS.filter((p) => p.category === 'api-heavy');
    const webOnly = PROJECTS.filter((p) => p.category === 'web-only');
    expect(apiHeavy).toHaveLength(4);
    expect(webOnly).toHaveLength(2);
  });

  it('the four api-heavy backends are the four distinct backends', () => {
    const backends = PROJECTS.filter((p) => p.category === 'api-heavy')
      .map((p) => p.backend)
      .sort();
    expect(backends).toEqual(
      ['Elysia (Bun)', 'Fastify', 'Hono (Node)', 'NestJS'].sort(),
    );
  });

  it.each(CANONICAL_ORDER)('%s carries the correct backend badge', (slug) => {
    const project = PROJECTS.find((p) => p.slug === slug);
    expect(project?.backend).toBe(EXPECTED_BACKENDS[slug]);
  });

  it('every web-only project has a null backend', () => {
    for (const project of PROJECTS.filter((p) => p.category === 'web-only')) {
      expect(project.backend).toBeNull();
    }
  });
});

describe('PROJECTS — accent token matches slug', () => {
  it.each(CANONICAL_ORDER)('%s uses the atrium-local --bay-<slug> token', (slug) => {
    const project = PROJECTS.find((p) => p.slug === slug);
    expect(project?.accentToken).toBe(`--bay-${slug}`);
  });
});

describe('PROJECTS — preview still (atrium v2 / Task 4.5)', () => {
  // Every bay now carries a per-bay PREVIEW STILL key. The key is the slug; the
  // bay's `PreviewStill` resolves it to a theme-matched dark+light AVIF pair
  // static-imported from `src/assets/preview-stills/`.
  it.each(CANONICAL_ORDER)('%s carries a previewImage key equal to its slug', (slug) => {
    const project = PROJECTS.find((p) => p.slug === slug);
    expect(project?.previewImage).toBe(slug);
  });

  it('every project has a previewImage set (the v2 enrichment is complete)', () => {
    for (const project of PROJECTS) {
      expect(typeof project.previewImage).toBe('string');
      expect(project.previewImage?.length).toBeGreaterThan(0);
    }
  });
});

/**
 * THE GUARD (ADR-001 / ADR-003 / AGENT_NOTES): there must be exactly ONE
 * hardcoded `github.com` literal in actual CODE across the whole `src/` tree —
 * the `GITHUB_PLACEHOLDER` in `site-config.ts`. Any other inline `github.com`
 * string means a component hardcoded a repo/profile link and broke the single
 * flippable seam.
 *
 * Comments are STRIPPED before scanning — the rule is about hardcoded link
 * literals in code, not prose. Several files legitimately mention the rule in a
 * doc comment ("never a hardcoded inline `github.com/...` string"); those are
 * documentation, not a broken seam, and must not trip the guard.
 */
function stripComments(source: string): string {
  return source
    // Block comments /* ... */ (including JSDoc).
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // Line comments // ... to end of line.
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

describe('GUARD — no inline hardcoded github.com outside site-config.ts', () => {
  // This file lives at <src>/data/projects.test.ts. `import.meta.dirname` is
  // <src>/data (Node 22 / Vite); its parent is the <src> root we scan.
  const srcDir = resolve(dirname(import.meta.dirname));

  function collectSourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push(...collectSourceFiles(full));
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      if (/\.test\.(ts|tsx)$/.test(entry.name)) continue; // skip the tests themselves
      out.push(full);
    }
    return out;
  }

  const sourceFiles = collectSourceFiles(srcDir);

  it('finds source files to scan', () => {
    expect(sourceFiles.length).toBeGreaterThan(0);
  });

  it('contains "github.com" in exactly one file (site-config.ts)', () => {
    const offenders = sourceFiles.filter((file) => {
      const contents = stripComments(readFileSync(file, 'utf8'));
      return /github\.com/i.test(contents);
    });
    const relative = offenders.map((f) => f.replace(srcDir, '').replace(/\\/g, '/'));
    expect(
      relative,
      `github.com must only appear in site-config.ts (the single seam); found in:\n${relative.join('\n')}`,
    ).toEqual(['/lib/site-config.ts']);
  });
});
