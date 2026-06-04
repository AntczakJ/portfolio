/// <reference types="node" />

/**
 * Types-only cross-package contract for `pulse-web` (mirrors meld's
 * `src/app.ts` pattern).
 *
 * The web side consumes the shared schema TYPES via
 *   import type { SseEvent, MonitorResponse } from 'pulse-server';
 * or, for the load-bearing SSE contract specifically, via the dedicated
 *   import type { SseEvent } from 'pulse-server/events';
 * export (package.json `exports['./events']`).
 *
 * Because every export below is a `type` re-export, the Zod runtime (and any
 * Nest / Node runtime code) is ERASED at compile time on the web side
 * (verbatimModuleSyntax). Nothing from the server bundle reaches the browser
 * — only the wire-shape types travel. This is the conventions § 13 Trigger-B
 * avoidance path: a project pair sharing types via the workspace, no
 * `packages/*` extraction.
 *
 * The triple-slash Node reference pulls Node's ambient globals into any
 * project that walks into this file via the package `types` entry, so the web
 * tsc does not choke on `process` / `node:*` references reachable from the
 * schema graph. It is types-only and erased at runtime.
 *
 * PROGRESS gate: frontend Phase 3.3 (the EventSource client) depends on the
 * SSE envelope re-exported here. Keep this surface in lockstep with
 * src/lib/schemas/events.ts.
 */

// --- The SSE real-time contract (ADR-003) — the cross-package gate ---
export type {
  AlertFiredEvent,
  AlertTransition,
  CheckResultEvent,
  HeartbeatEvent,
  IncidentCloseEvent,
  IncidentOpenEvent,
  IncidentSeverity,
  MonitorStatus,
  SseEvent,
  SseEventPayloadMap,
  SseEventType,
  SseScope,
  StatusChangeEvent,
} from './lib/schemas/events';

// --- Monitor contract ---
export type {
  CreateMonitor,
  CreateMonitorInput,
  MonitorMethod,
  MonitorResponse,
  UpdateMonitor,
} from './lib/schemas/monitor';

// --- Check-result contract ---
export type {
  CheckErrorClass,
  CheckResult,
  ProbeOutcome,
} from './lib/schemas/check-result';

// --- Monitor-detail read contract (Phase 4.2) ---
export type {
  HistoryBucket,
  HistoryResponse,
  MonitorWindow,
  MonitorWindowQuery,
  RecentCheck,
  RecentChecksQuery,
  RecentChecksResponse,
  SeriesResponse,
  UptimeBreakdown,
  UptimeResponse,
} from './lib/schemas/monitor-detail';

// --- Incident contract ---
export type { IncidentResponse, IncidentStatus } from './lib/schemas/incident';

// --- Incident history read contract (Phase 5 read surface) ---
export type {
  IncidentListItem,
  IncidentsListQuery,
  IncidentsListResponse,
} from './lib/schemas/incidents-list';

// --- Public status-page read contract (Phase 6.3, the redacted surface) ---
export type {
  PublicIncident,
  PublicMonitor,
  PublicOverallStatus,
  PublicStatusPage,
} from './lib/schemas/public-status';

// --- Alert-channel contract ---
export type {
  AlertChannelResponse,
  AlertChannelType,
  CreateAlertChannel,
} from './lib/schemas/alert-channel';

// --- Health contract ---
export type { DependencyHealth, HealthResponse } from './lib/schemas/health';
