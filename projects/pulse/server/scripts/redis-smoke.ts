/**
 * Redis / BullMQ round-trip smoke (Task 1.3 verification).
 *
 * Enqueues a single trivial job on the probe queue and exits. With the server
 * running (`pnpm -F pulse-server dev`), the stub ProbeProcessor picks the job
 * up and logs it — that log line is the proof the Redis + BullMQ wiring works
 * end to end (producer here -> Redis -> worker in the server process).
 *
 * Run:  pnpm -F pulse-server redis:smoke
 * Needs: REDIS_URL set (server/.env), Redis up (docker compose).
 */
import { Queue } from 'bullmq';

import { PROBE_QUEUE } from '../src/redis/queue-names';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6381';

async function main(): Promise<void> {
  const queue = new Queue(PROBE_QUEUE, {
    connection: { url: redisUrl, maxRetriesPerRequest: null },
  });

  const job = await queue.add('roundtrip', { probe: 'roundtrip', at: Date.now() });
  // eslint-disable-next-line no-console
  console.log(
    `[redis-smoke] enqueued job id=${job.id ?? '?'} on queue "${PROBE_QUEUE}" via ${redisUrl}. ` +
      'Watch the running server log for the ProbeProcessor "round-trip OK" line.',
  );

  await queue.close();
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('[redis-smoke] failed:', err);
  process.exit(1);
});
