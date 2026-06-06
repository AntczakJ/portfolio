// @ts-nocheck
/**
 * E2E stack orchestrator (Phase 8.2) — the single `webServer` command Playwright
 * boots. It brings up the THREE processes the faithful prod-CSP run needs and
 * keeps them alive until killed:
 *
 *   1. the Fastify gateway (atlas-server) on :3092, DB-LESS (the engine boots
 *      from the frozen Porto baseline; the fleet MOVES with no Postgres);
 *   2. the Next web (prod `next start`) on :3097 (an off-port so an E2E run never
 *      collides with the :3093 dev server) — with `NEXT_PUBLIC_WS_URL` UNSET so
 *      the client derives the WS same-origin (the proxy origin), exercising the
 *      production same-origin posture under `connect-src 'self'`;
 *   3. the same-origin proxy on :3096 (the single origin the suite targets),
 *      forwarding `/ws` to the gateway and everything else to Next.
 *
 * Playwright's `webServer.url` polls the proxy origin; once it answers, the stack
 * is ready. The Next build is assumed already done (the webServer command runs
 * `build` first — see playwright.config.ts) so this only STARTS the servers.
 *
 * Dependency-free; spawns via the workspace pnpm filters. Excluded from the root
 * ESLint gate by the e2e-mjs ignore glob in eslint.config.mjs.
 */

import { spawn } from 'node:child_process';
import process from 'node:process';

const WEB_PORT = process.env.ATLAS_WEB_PORT ?? '3097';
const WS_PORT = process.env.ATLAS_WS_PORT ?? '3092';
const PROXY_PORT = process.env.ATLAS_PROXY_PORT ?? '3096';

const REPO_ROOT = new URL('../../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const children = [];

function run(label, command, args, env) {
  const child = spawn(command, args, {
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'inherit', 'inherit'],
    shell: process.platform === 'win32',
  });
  child.on('exit', (code) => {
    // eslint-disable-next-line no-console
    console.error(`[atlas-stack] ${label} exited with code ${String(code)}`);
    shutdown(code ?? 1);
  });
  children.push(child);
  return child;
}

function shutdown(code) {
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

// 1. Fastify gateway, DB-less. `node --import tsx src/main.ts` (the package
//    `start` script) reads server/.env if present; we pass PORT explicitly.
//    DATABASE_URL is REQUIRED by the env schema but the gateway runs DB-LESS:
//    the engine boots from the frozen Porto baseline and the persistence sink
//    swallows DB failures off the tick hot path (AGENT_NOTES "DB-LESS
//    RESILIENCE"), so a connection string pointed at the (unreachable) 5438 is
//    enough to pass validation; the fleet still MOVES with no Postgres.
run('gateway', 'pnpm', ['--filter', 'atlas-server', 'start'], {
  PORT: WS_PORT,
  NODE_ENV: 'production',
  DATABASE_URL:
    process.env.DATABASE_URL ?? 'postgres://atlas:atlas@localhost:5438/atlas',
  // CORS not needed (same-origin via the proxy), but keep the dev default safe.
  CORS_ORIGINS: `http://localhost:${PROXY_PORT}`,
});

// 2. Next prod start on the off-port. WS URL left unset -> same-origin derive.
run('web', 'pnpm', ['--filter', 'atlas-web', 'exec', 'next', 'start', '-p', WEB_PORT], {
  NODE_ENV: 'production',
});

// 3. The same-origin proxy (the single origin the suite + LHCI hit). Spawn via
//    `node` resolved on PATH (shell:true on win32) rather than process.execPath
//    so a Node install path containing spaces ("C:\Program Files\...") does not
//    break the shell-quoted command.
run('proxy', 'node', [proxyScriptPath()], {
  ATLAS_PROXY_PORT: PROXY_PORT,
  ATLAS_WEB_PORT: WEB_PORT,
  ATLAS_WS_PORT: WS_PORT,
});

function proxyScriptPath() {
  return new URL('./atlas-proxy.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
}
