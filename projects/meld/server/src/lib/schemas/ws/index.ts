/**
 * Barrel re-export for the meld WS control-frame Zod schemas
 * (ADR-004 — Task 1.X-control).
 *
 * Six v1 `kind` literals split across six per-kind files plus the
 * discriminated-union entry point in `frame.ts`:
 *
 *   - `welcome`                           → `welcome.ts`
 *   - `control.overrun`                   → `overrun.ts`
 *   - `control.board-deleted`             → `board-deleted.ts`
 *   - `control.kicked-for-name-collision` → `kicked.ts` (v2 stub)
 *   - `heartbeat`                         → `heartbeat.ts` (v1.1 stub)
 *   - `settings.update`                   → `settings.ts` (v1.1 stub)
 *
 * Consumers:
 *
 *   - Server emit sites (`src/lib/ws/welcome.ts`, `overrun.ts`,
 *     the future Task 1.5 retention sweep) import the per-kind schema
 *     and `parse` outbound payloads before sending.
 *   - `src/app.ts` re-exports the union type via `import type` so
 *     `meld-web` consumes the discriminated shape without bundling
 *     the Zod runtime.
 *
 * No fixtures or test schemas are re-exported from this barrel — the
 * fixtures live alongside as raw JSON for round-trip parse tests
 * (Task 1.X-control smoke), the browser bundle does NOT import them.
 */

export { wsBoardDeletedFrameSchema, wsBoardDeletedReasonSchema } from './board-deleted';
export type {
  WSBoardDeletedReason,
  WSControlBoardDeletedFramePayload,
} from './board-deleted';

export { wsControlFrameKindSchema, wsControlFrameSchema } from './frame';
export type { WSControlFrame, WSControlFrameKind } from './frame';

export { wsHeartbeatFrameSchema } from './heartbeat';
export type { WSHeartbeatFramePayload } from './heartbeat';

export { wsKickedFrameSchema } from './kicked';
export type { WSControlKickedFramePayload } from './kicked';

export { wsOverrunFrameSchema, wsOverrunReasonSchema } from './overrun';
export type {
  WSControlOverrunFramePayload,
  WSOverrunReason,
} from './overrun';

export { wsSettingsUpdateFrameSchema } from './settings';
export type { WSSettingsUpdateFramePayload } from './settings';

export {
  wsBoardMetadataSchema,
  wsOklchColorSchema,
  wsSessionIdentitySchema,
  wsWelcomeFrameSchema,
} from './welcome';
export type {
  WSBoardMetadata,
  WSOklchColor,
  WSSessionIdentity,
  WSWelcomeFramePayload,
} from './welcome';
