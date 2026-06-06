/**
 * WS gateway live smoke (Task 4.1 verification — NOT a CI test, run by hand).
 *
 * Boots the real Fastify app + the in-process engine (DB-less: the persistence
 * sink fails non-fatally, ADR-005, so the live channel works without Postgres),
 * opens ONE WebSocket to /ws, and confirms the contract end to end:
 *
 *   1. a `snapshot` frame arrives on connect (definitions + telemetry);
 *   2. `tick` frames stream and vehicle positions CHANGE across frames;
 *   3. a `sim.control` pause stops the ticks; resume restarts them;
 *   4. a `heartbeat` frame arrives (interval shortened here so the smoke is
 *      quick — the real cadence is 20 s).
 *
 * Run (no Postgres needed):
 *   node --import tsx projects/atlas/server/scripts/ws-smoke.ts
 *
 * This file lives under server/scripts/ which the root eslint config ignores
 * (operational tooling, outside the package tsconfig include).
 */
import { WebSocket } from 'ws';

import { buildApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.schema.js';

const PORT = 3192; // a throwaway port distinct from the dev 3092

process.env.PORT = String(PORT);
process.env.NODE_ENV = 'development';
process.env.DATABASE_URL ??= 'postgres://atlas:atlas@localhost:5438/atlas';
process.env.CORS_ORIGINS = `http://localhost:3093`;

interface AnyFrame {
  t: string;
  seq: number;
  serverTick?: number;
  telemetry?: { vehicleId: string; lng: number; lat: number; distanceAlongRouteM: number }[];
  vehicles?: unknown[];
}

function log(msg: string): void {
  process.stdout.write(`[ws-smoke] ${msg}\n`);
}

async function main(): Promise<void> {
  const env = loadEnv();
  // Shorten the heartbeat so the smoke observes one quickly (prod cadence is 20 s).
  const { app, dbHandle, engineService } = await buildApp(env, { heartbeatIntervalMs: 1500 });
  await app.listen({ port: PORT, host: '127.0.0.1' });
  engineService.start();
  log(`server up on :${String(PORT)}, engine running`);

  const ws = new WebSocket(`ws://127.0.0.1:${String(PORT)}/ws`);

  const seen = {
    snapshot: false,
    ticks: 0,
    heartbeat: false,
    firstPos: new Map<string, number>(),
    moved: false,
    pausedAtTick: -1,
    pauseConfirmed: false,
    resumeConfirmed: false,
  };

  let phase: 'collect' | 'paused' | 'resumed' = 'collect';

  ws.on('open', () => {
    log('socket open');
  });

  ws.on('message', (raw) => {
    const frame = JSON.parse(raw.toString()) as AnyFrame;
    switch (frame.t) {
      case 'snapshot': {
        seen.snapshot = true;
        log(
          `snapshot: seq=${String(frame.seq)} tick=${String(frame.serverTick)} vehicles=${String(frame.vehicles?.length ?? 0)} telemetry=${String(frame.telemetry?.length ?? 0)}`,
        );
        for (const t of frame.telemetry ?? []) {
          seen.firstPos.set(t.vehicleId, t.distanceAlongRouteM);
        }
        break;
      }
      case 'tick': {
        seen.ticks += 1;
        for (const t of frame.telemetry ?? []) {
          const first = seen.firstPos.get(t.vehicleId);
          if (first !== undefined && Math.abs(t.distanceAlongRouteM - first) > 0.5) {
            seen.moved = true;
          }
        }
        if (seen.ticks === 3) log(`ticks streaming (count=${String(seen.ticks)})`);
        break;
      }
      case 'heartbeat': {
        seen.heartbeat = true;
        log(`heartbeat: tick=${String(frame.serverTick)}`);
        break;
      }
      case 'event': {
        log(`event frame seq=${String(frame.seq)}`);
        break;
      }
      default:
        break;
    }
  });

  ws.on('error', (err: Error) => {
    log(`socket error: ${err.message}`);
  });

  // Drive the phases on wall-clock so the smoke exercises pause/resume + heartbeat.
  await delay(2500); // collect snapshot + several ticks
  phase = 'paused';
  seen.pausedAtTick = engineService.currentTick;
  ws.send(JSON.stringify({ t: 'sim.control', action: 'pause' }));
  log(`sent sim.control pause at tick ${String(seen.pausedAtTick)}`);

  await delay(1500);
  // While paused, the engine tick index should NOT advance.
  seen.pauseConfirmed = engineService.currentTick === seen.pausedAtTick && !engineService.isRunning;
  log(`pause confirmed: ${String(seen.pauseConfirmed)} (tick now ${String(engineService.currentTick)})`);

  phase = 'resumed';
  ws.send(JSON.stringify({ t: 'sim.control', action: 'resume' }));
  log('sent sim.control resume');
  await delay(1500);
  seen.resumeConfirmed = engineService.isRunning && engineService.currentTick > seen.pausedAtTick;
  log(`resume confirmed: ${String(seen.resumeConfirmed)} (tick now ${String(engineService.currentTick)})`);

  // Send a malformed frame: must be dropped, socket stays open.
  ws.send('not json at all');
  ws.send(JSON.stringify({ t: 'sim.control', action: 'setSpeed', multiplier: 9999 }));
  await delay(300);
  const stillOpen = ws.readyState === WebSocket.OPEN;
  log(`socket still open after malformed frames: ${String(stillOpen)}`);

  // Report.
  log('--- RESULT ---');
  log(`snapshot-on-connect:   ${ok(seen.snapshot)}`);
  log(`tick frames streamed:  ${ok(seen.ticks > 0)} (count=${String(seen.ticks)})`);
  log(`vehicles moved:        ${ok(seen.moved)}`);
  log(`pause works:           ${ok(seen.pauseConfirmed)}`);
  log(`resume works:          ${ok(seen.resumeConfirmed)}`);
  log(`heartbeat arrived:     ${ok(seen.heartbeat)}`);
  log(`malformed dropped:     ${ok(stillOpen)}`);
  log(`(phase=${phase})`);

  ws.close();
  await engineService.stop();
  await app.close();
  await dbHandle.sql.end({ timeout: 1 }).catch(() => undefined);

  const pass =
    seen.snapshot &&
    seen.ticks > 0 &&
    seen.moved &&
    seen.pauseConfirmed &&
    seen.resumeConfirmed &&
    seen.heartbeat &&
    stillOpen;
  log(pass ? 'SMOKE PASS' : 'SMOKE FAIL');
  process.exit(pass ? 0 : 1);
}

function ok(b: boolean): string {
  return b ? 'PASS' : 'FAIL';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err: unknown) => {
  process.stderr.write(`ws-smoke failed: ${String(err)}\n`);
  process.exit(1);
});
