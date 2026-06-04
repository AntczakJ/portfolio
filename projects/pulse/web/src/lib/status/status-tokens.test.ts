import { describe, expect, it } from 'vitest';

import {
  MONITOR_STATUSES,
  STATUS_TOKENS,
  statusToken,
  type MonitorStatus,
} from './status-tokens';

/**
 * Guards the load-bearing status vocabulary: every status has a complete
 * token (label + dot + text + surface + border), the semantic labels are
 * the fixed product vocabulary, and the safe accessor never returns
 * undefined (it degrades to `unknown`).
 */
describe('status tokens', () => {
  it('defines a complete token for every monitor status', () => {
    for (const status of MONITOR_STATUSES) {
      const token = STATUS_TOKENS[status];
      expect(token.label).toBeTruthy();
      expect(token.dot).toContain('bg-status-');
      expect(token.text).toContain('text-status-');
      expect(token.surface).toContain('bg-status-');
      expect(token.border).toContain('border-status-');
    }
  });

  it('maps statuses to the fixed product labels', () => {
    expect(STATUS_TOKENS.up.label).toBe('Up');
    expect(STATUS_TOKENS.degraded.label).toBe('Degraded');
    expect(STATUS_TOKENS.down.label).toBe('Down');
    expect(STATUS_TOKENS.unknown.label).toBe('Unknown');
  });

  it('degrades an unrecognised status to the neutral unknown token', () => {
    const token = statusToken('not-a-status' as MonitorStatus);
    expect(token).toBe(STATUS_TOKENS.unknown);
  });
});
