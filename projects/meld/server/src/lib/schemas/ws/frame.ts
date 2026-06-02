import { z } from 'zod';

import { wsBoardDeletedFrameSchema } from './board-deleted';
import { wsHeartbeatFrameSchema } from './heartbeat';
import { wsKickedFrameSchema } from './kicked';
import { wsOverrunFrameSchema } from './overrun';
import { wsSettingsUpdateFrameSchema } from './settings';
import { wsWelcomeFrameSchema } from './welcome';

/**
 * Discriminated-union schema for every meld WS control frame (ADR-004).
 *
 * Wire form (ADR-011, superseding ADR-004's raw TEXT-frame transport):
 * each frame is a JSON string with a top-level `kind` discriminator,
 * carried over Hocuspocus's Stateless channel. The browser receive path
 * is the provider's `onStateless({ payload })` callback, which JSON-parses
 * and dispatches by `kind` — no TEXT/BINARY discrimination, no
 * binary-decode of a TEXT frame (which is what threw `Unexpected end of
 * array` before ADR-011).
 *
 * Six v1 `kind` literals — `welcome` is emitted by the server on every
 * connection; `control.overrun` is emitted before the framework-level
 * 4290 close; `control.board-deleted` is emitted by the ADR-003
 * retention sweep before deleting a live board (Task 1.5 wires the
 * emit); `control.kicked-for-name-collision`, `heartbeat`, and
 * `settings.update` are RESERVED for v1.1 / v2 and ship the schema
 * stub so the discriminator vocabulary does not break when the path
 * lights up.
 *
 * v2 extension reservation pattern (ADR-004):
 *
 *   - `control.*` namespace — server-initiated events the client must
 *     observe BEFORE the server acts. Adding kinds here stays on
 *     `protocolVersion: 1`.
 *   - bare-verb namespace — steady-state channel for client-driven or
 *     routine server-driven state. Adding kinds here also stays on
 *     `protocolVersion: 1`.
 *   - Renaming or removing an existing kind bumps `protocolVersion`
 *     and the v1 welcome-frame literal check fails fast on v2 servers.
 */

export const wsControlFrameKindSchema = z.enum([
  'welcome',
  'control.overrun',
  'control.board-deleted',
  'control.kicked-for-name-collision',
  'heartbeat',
  'settings.update',
]);

export type WSControlFrameKind = z.infer<typeof wsControlFrameKindSchema>;

/**
 * The canonical browser-facing discriminated union — every control frame
 * the server may send (over Stateless per ADR-011) to a meld client maps
 * to one branch of this union.
 *
 * Per ADR-004 cross-package contract:
 *
 *   - `meld-server/src/app.ts` re-exports `WSControlFrame` as a
 *     types-only export. `meld-web` does
 *     `import type { WSControlFrame } from 'meld-server'`. The runtime
 *     Zod parser used by `meld-web` is a separate, minimal hydration
 *     (Task 2.5a) that mirrors the schema set without importing the
 *     fixtures or test schemas.
 */
export const wsControlFrameSchema = z.discriminatedUnion('kind', [
  wsWelcomeFrameSchema,
  wsOverrunFrameSchema,
  wsBoardDeletedFrameSchema,
  wsKickedFrameSchema,
  wsHeartbeatFrameSchema,
  wsSettingsUpdateFrameSchema,
]);

export type WSControlFrame = z.infer<typeof wsControlFrameSchema>;
