import type { ReactNode } from 'react';

import { Threshold } from '@/components/atmosphere/threshold';
import { PROJECTS } from '@/data/projects';

import { BaysSequence } from './bays-sequence';
import { ProjectBay } from './project-bay';

/**
 * The six gallery bays (Phase 4 — replaces `bays-placeholder.tsx`).
 *
 * The hero descent hands off into bay 1; the scroll then glides through six
 * pinned, kinetically-titled bays, each carrying its project's signature hue, with
 * the threshold/shaft-of-light motif as the bay-to-bay connective tissue
 * (ADR-003).
 *
 * STRUCTURE. This is a SERVER component: it renders the six `ProjectBay` sections
 * (real DOM — the no-JS / reduced-motion floor) interleaved with the `Threshold`
 * seams, and hands the whole tree to `BaysSequence` (the single client wrapper)
 * as `children`. `BaysSequence` ENHANCES the markup with the GSAP pin/resolve
 * choreography; it creates no content. So with JS off, or under reduced motion,
 * the bays read complete and legible top-to-bottom — every title, pitch, badge,
 * wow line, and both links present (ADR-002/003).
 *
 * The first bay carries the bay-1 threshold the hero descent resolves into; each
 * subsequent bay is preceded by a `minor` threshold tinted with that bay's
 * signature hue (the "tour of differently-lit rooms" foreshadow).
 */
export function Bays(): ReactNode {
  return (
    <BaysSequence>
      {PROJECTS.map((project, index) => (
        <div key={project.slug} data-bay-block>
          {/* The threshold INTO this bay — tinted with the bay's hue so the seam
              foreshadows the room. The first one is the hero → gallery hand-off
              (a major seam); the rest are the quieter bay-to-bay seams. */}
          <Threshold
            accentToken={project.accentToken}
            weight={index === 0 ? 'major' : 'minor'}
          />
          <ProjectBay project={project} index={index + 1} />
        </div>
      ))}
    </BaysSequence>
  );
}
