import type { ReactNode } from 'react';

import { CanvasPlaceholder } from '@/components/chrome/canvas-placeholder';

/**
 * Landing page.
 *
 * Task 2.3 replaced the Task 2.1 marketing layout with a stable
 * chrome shell (TopBar in `app/layout.tsx`, StatusRow ditto) and a
 * centered `CanvasPlaceholder` here. Phase 2.5 swaps this page out
 * for the board route (`/board/[boardId]`) which renders the live
 * Canvas2D drawing surface inside the same chrome — top bar +
 * status row do not change shape across the swap.
 *
 * Server component. Interactivity is delegated to the New board
 * button inside the placeholder (and to the chrome theme toggle in
 * the top bar).
 */
export default function HomePage(): ReactNode {
  return <CanvasPlaceholder />;
}
