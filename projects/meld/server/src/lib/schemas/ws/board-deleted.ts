import { z } from 'zod';

/**
 * `control.board-deleted` control frame schema (ADR-004 — Task
 * 1.X-control schema; Task 1.5 emits).
 *
 * Server emits IMMEDIATELY BEFORE the framework-level close with code
 * `4404` when the ADR-003 nightly retention sweep deletes a board that
 * still has live WebSocket connections (race window: the sweep
 * timestamps in the same second a connected client touched
 * `last_active_at`). The frame lets the client UI show a "this board
 * has been retired" affordance instead of silently failing the
 * reconnect retry curve.
 *
 * v1 emit path (Task 1.5):
 *
 *   1. Sweep selects boards where `last_active_at < NOW() - INTERVAL
 *      '30 days'`.
 *   2. For each, iterate `Hocuspocus.documents.get(boardId)?.connections`
 *      and `connection.webSocket.send(JSON.stringify(payload))` the
 *      board-deleted frame.
 *   3. Close each connection with code `4404` ("board deleted").
 *   4. Delete the board row (CASCADE removes board_ops).
 *
 * Task 1.X-control reserves the schema; Task 1.5 wires the emit.
 *
 * Reason discrimination — single v1 value:
 *
 *   - `retention-expired` — the 30-day inactivity sweep collided with
 *                           a live session.
 *
 * Reserved-namespace-style enum (rather than a bare literal) so a v2
 * "board.deleted-by-owner" path can extend without bumping the wire.
 */

export const wsBoardDeletedReasonSchema = z.enum(['retention-expired']);

export type WSBoardDeletedReason = z.infer<typeof wsBoardDeletedReasonSchema>;

export const wsBoardDeletedFrameSchema = z.object({
  kind: z.literal('control.board-deleted'),
  boardId: z.string().uuid(),
  reason: wsBoardDeletedReasonSchema,
});

export type WSControlBoardDeletedFramePayload = z.infer<
  typeof wsBoardDeletedFrameSchema
>;
