// @ts-nocheck
/**
 * Same-origin reverse proxy for the atlas E2E + Lighthouse runs (Phase 8).
 *
 * WHY THIS EXISTS (the load-bearing recipe — the meld/razors-edge/pulse prod-CSP
 * lesson, recorded in atlas AGENT_NOTES "THE DEV-vs-PROD VERIFICATION GOTCHA"):
 *
 *   - The atlas web client MUST be tested against a PROD build (`next build &&
 *     next start`), NOT `next dev` — the strict CSP forbids `unsafe-eval`, and
 *     `next dev`'s React Refresh uses runtime eval that the policy blocks (which
 *     aborts the ssr:false map chunk so the map never mounts and the WS never
 *     opens). The zero-CSP-violation + one-WebSocket assertions are only
 *     meaningful against the prod build.
 *   - The prod CSP is `connect-src 'self'` — same-origin only. In the split local
 *     topology the Next web is on one port and the Fastify gateway (the `/ws`
 *     endpoint) is on another, so a browser on the web origin cannot open the
 *     cross-origin WS without loosening the CSP. The DEPLOY posture (ADR-007) is
 *     same-origin (the WS is proxied under the web origin), so the faithful local
 *     run mirrors that: this proxy presents ONE origin and forwards `/ws`
 *     upgrades to the gateway. `connect-src 'self'` then covers the WS exactly as
 *     it does in production.
 *
 * TOPOLOGY (defaults; override via env):
 *   browser ─▶ proxy  :3096  (the single origin the suite + LHCI target)
 *                ├─ /ws            ─▶ Fastify gateway  :3092   (WS upgrade)
 *                └─ everything else ─▶ Next (next start) :3097
 *
 * The Fastify server runs DB-LESS (the engine boots from the frozen Porto
 * baseline; the persistence sink swallows DB failures off the tick hot path —
 * AGENT_NOTES "DB-LESS RESILIENCE"), so no Postgres is required for the E2E run.
 *
 * Dependency-free: Node's built-in `http` + raw socket piping for the WS upgrade.
 * Excluded from the root ESLint gate by the e2e-mjs ignore glob (operational
 * tooling, not authored app source).
 */

import http from 'node:http';
import net from 'node:net';

const PROXY_PORT = Number(process.env.ATLAS_PROXY_PORT ?? 3096);
const WEB_PORT = Number(process.env.ATLAS_WEB_PORT ?? 3097);
const WS_PORT = Number(process.env.ATLAS_WS_PORT ?? 3092);
const HOST = '127.0.0.1';

/**
 * Forward a normal HTTP request. The public read REST surface (`/api/*`) and
 * `/health` belong to the Fastify gateway (the deploy posture, ADR-007 — the
 * gateway owns the API same-origin); everything else is the Next prod app. The
 * SSR floor does NOT depend on the API (it renders from the static fixture), but
 * a no-WebGL client MAY read `/api/fleet/snapshot`, so route it faithfully.
 */
function proxyHttp(clientReq, clientRes) {
  const url = clientReq.url ?? '/';
  const toGateway = url.startsWith('/api/') || url === '/health';
  const port = toGateway ? WS_PORT : WEB_PORT;
  const options = {
    host: HOST,
    port,
    method: clientReq.method,
    path: clientReq.url,
    headers: { ...clientReq.headers, host: `${HOST}:${String(port)}` },
  };
  const upstream = http.request(options, (upstreamRes) => {
    clientRes.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
    upstreamRes.pipe(clientRes, { end: true });
  });
  upstream.on('error', (err) => {
    if (!clientRes.headersSent) clientRes.writeHead(502, { 'content-type': 'text/plain' });
    clientRes.end(`proxy upstream error: ${err.message}`);
  });
  clientReq.pipe(upstream, { end: true });
}

const server = http.createServer(proxyHttp);

/**
 * Forward a WebSocket (or any) upgrade. `/ws` goes to the Fastify gateway; any
 * other upgrade path goes to Next (HMR is off in prod, but be faithful).
 */
server.on('upgrade', (req, clientSocket, head) => {
  const target = req.url && req.url.startsWith('/ws') ? WS_PORT : WEB_PORT;
  const upstream = net.connect(target, HOST, () => {
    const headerLines = [`${req.method} ${req.url} HTTP/1.1`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const key = req.rawHeaders[i];
      const value = req.rawHeaders[i + 1];
      headerLines.push(key.toLowerCase() === 'host' ? `Host: ${HOST}:${String(target)}` : `${key}: ${value}`);
    }
    upstream.write(headerLines.join('\r\n') + '\r\n\r\n');
    if (head && head.length) upstream.write(head);
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
  });
  upstream.on('error', () => clientSocket.destroy());
  clientSocket.on('error', () => upstream.destroy());
});

server.listen(PROXY_PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(
    `[atlas-proxy] :${String(PROXY_PORT)} -> next :${String(WEB_PORT)} | /ws -> gateway :${String(WS_PORT)}`,
  );
});
