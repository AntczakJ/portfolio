import { describe, expect, it } from 'vitest';

import {
  formatUptime,
  incidentLabel,
  monitorDisplayStatus,
  openIncidentCount,
  overallBanner,
} from './public-status-view';
import type { PublicIncident, PublicStatusPage } from 'pulse-server';

/**
 * The public-page presentation mapping (Task 6.6) — the unit-tested seam. The
 * server owns the redaction + the overall-status derivation; these helpers map
 * that redacted payload to the calm banner / row display, so the page component
 * stays a thin IO/DOM shell.
 */

describe('overallBanner', () => {
  it('maps operational -> all systems operational, up tone', () => {
    const b = overallBanner('operational', 0);
    expect(b.headline).toBe('All systems operational');
    expect(b.tone).toBe('up');
    expect(b.dotStatus).toBe('up');
  });

  it('maps degraded with incidents -> degraded headline + count', () => {
    const b = overallBanner('degraded', 2);
    expect(b.tone).toBe('degraded');
    expect(b.headline).toContain('Degraded performance');
    expect(b.headline).toContain('2 active incidents');
  });

  it('maps outage -> active outage, down tone, dot down', () => {
    const b = overallBanner('outage', 1);
    expect(b.tone).toBe('down');
    expect(b.dotStatus).toBe('down');
    expect(b.headline).toContain('Active outage');
    expect(b.headline).toContain('1 active incident');
  });

  it('omits the incident clause when there are none', () => {
    expect(overallBanner('outage', 0).headline).toBe('Active outage');
    expect(overallBanner('degraded', 0).headline).toBe('Degraded performance');
  });

  it('never reads operational while an incident is open (C-3)', () => {
    // The banner must not contradict reality: an open incident floors the
    // banner to at least degraded even if the server `overall` lags to
    // `operational`.
    const b = overallBanner('operational', 1);
    expect(b.headline).not.toContain('operational');
    expect(b.tone).toBe('degraded');
    expect(b.headline).toContain('1 active incident');
  });

  it('still reads operational when there are no open incidents', () => {
    expect(overallBanner('operational', 0).headline).toBe(
      'All systems operational',
    );
  });
});

describe('incidentLabel', () => {
  it('singularises 1 and pluralises otherwise', () => {
    expect(incidentLabel(1)).toBe('1 active incident');
    expect(incidentLabel(3)).toBe('3 active incidents');
    expect(incidentLabel(0)).toBe('0 active incidents');
  });
});

describe('formatUptime', () => {
  it('renders null as a dash, not 0%', () => {
    expect(formatUptime(null)).toBe('—');
  });

  it('renders 100 as a whole percent', () => {
    expect(formatUptime(100)).toBe('100%');
    expect(formatUptime(100.0001)).toBe('100%');
  });

  it('renders two decimals below 100', () => {
    expect(formatUptime(99.9)).toBe('99.90%');
    expect(formatUptime(97.98)).toBe('97.98%');
  });

  it('clamps out-of-range input', () => {
    expect(formatUptime(-5)).toBe('0.00%');
    expect(formatUptime(120)).toBe('100%');
  });
});

describe('monitorDisplayStatus', () => {
  it('passes through up/degraded/down', () => {
    expect(monitorDisplayStatus({ id: 'm', name: 'A', status: 'down', uptimePercent: 1 })).toBe('down');
    expect(monitorDisplayStatus({ id: 'm', name: 'A', status: 'degraded', uptimePercent: 1 })).toBe('degraded');
  });

  it('maps a null (never checked) status to the UI-only unknown', () => {
    expect(
      monitorDisplayStatus({ id: 'm', name: 'A', status: null, uptimePercent: null }),
    ).toBe('unknown');
  });
});

describe('openIncidentCount', () => {
  function incident(status: 'open' | 'resolved'): PublicIncident {
    return {
      id: '00000000-0000-0000-0000-000000000000',
      monitorId: '00000000-0000-0000-0000-000000000001',
      monitorName: 'API',
      status,
      severity: 'down',
      startedAt: '2026-06-04T00:00:00.000Z',
      resolvedAt: status === 'resolved' ? '2026-06-04T00:01:00.000Z' : null,
      durationMs: 60_000,
      cause: 'down after 3 consecutive down checks',
    };
  }

  it('counts only the unresolved incidents', () => {
    const page: PublicStatusPage = {
      slug: 'demo',
      title: 'Demo',
      description: null,
      overall: 'outage',
      generatedAt: '2026-06-04T00:02:00.000Z',
      monitors: [],
      incidents: [incident('open'), incident('resolved'), incident('open')],
    };
    expect(openIncidentCount(page)).toBe(2);
  });
});
