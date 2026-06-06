import type { Page, Request, WebSocket } from '@playwright/test';

/**
 * Tracks the live-channel network so a spec can assert the lead success
 * criterion (PLAN.md / AGENT_NOTES): the fleet is genuinely PUSHED over exactly
 * ONE long-lived WebSocket on `/ws`, NOT a polling XHR loop. This is the proof
 * viewer 1 opens DevTools to confirm — the senior signal made testable.
 *
 * It counts:
 *   - `sockets`        — every WebSocket the page opens. There must be exactly
 *                        ONE for a single mounted surface (the client opens one
 *                        connection; a reconnect would be a NEW socket, so a
 *                        spec asserts within a settled window, or asserts the
 *                        count stays 1 while the page is steady).
 *   - `snapshotPolls`  — repeated `GET /api/fleet/snapshot` XHRs. A no-WebGL
 *                        client MAY poll this, but the live map must NOT — a
 *                        steady stream of these on the map surface would betray
 *                        polling-instead-of-push. A spec asserts the count stays
 *                        at zero (or small) over an observation window.
 *
 * Path-based matching, so it works against the same-origin proxy (`/ws` and
 * `/api/...` both on the proxy origin).
 */
export interface WsTracker {
  /** Every `/ws` WebSocket the page has opened (cumulative, includes closed). */
  readonly sockets: WebSocket[];
  readonly snapshotPolls: Request[];
  /**
   * The number of `/ws` sockets currently OPEN (not yet closed). The senior
   * signal is exactly ONE CONCURRENT socket — across a surface swap the old
   * socket closes before/while the new one opens, so the cumulative count may be
   * 2 but the concurrent count must never exceed 1.
   */
  openCount(): number;
  snapshot(): { sockets: number; open: number; snapshotPolls: number };
}

const WS_PATH_RE = /\/ws(\?|$)/;
const SNAPSHOT_RE = /\/api\/fleet\/snapshot(\?|$)/;

export function trackWs(page: Page): WsTracker {
  const sockets: WebSocket[] = [];
  const closed = new Set<WebSocket>();
  const snapshotPolls: Request[] = [];

  page.on('websocket', (ws: WebSocket) => {
    if (!WS_PATH_RE.test(ws.url())) return;
    sockets.push(ws);
    ws.on('close', () => closed.add(ws));
  });

  page.on('request', (req: Request) => {
    if (SNAPSHOT_RE.test(req.url())) {
      snapshotPolls.push(req);
    }
  });

  const openCount = (): number => sockets.filter((ws) => !closed.has(ws)).length;

  return {
    sockets,
    snapshotPolls,
    openCount,
    snapshot() {
      return { sockets: sockets.length, open: openCount(), snapshotPolls: snapshotPolls.length };
    },
  };
}
