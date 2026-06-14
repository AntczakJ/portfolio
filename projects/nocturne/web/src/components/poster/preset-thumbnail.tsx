import type { ReactNode } from 'react';

import { posterBackground } from '@/lib/poster/poster-gradient';

/**
 * A per-preset directory thumbnail (ADR-004 §3) — the same DESIGNED luminous-
 * field approach as the poster, at card scale. Used in the `/about` preset
 * directory and the Tier-4 no-JS directory DOM. Server-renderable, decorative
 * (the preset name + vibe carry the meaning beside it).
 */
export function PresetThumbnail({
  presetId,
  className,
}: {
  presetId: string;
  className?: string;
}): ReactNode {
  return (
    <div
      aria-hidden
      className={`relative overflow-hidden ${className ?? ''}`}
      style={{ background: posterBackground(presetId) }}
    >
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 110% at 50% 40%, transparent 52%, rgba(2,3,8,0.6) 100%)',
        }}
      />
    </div>
  );
}
