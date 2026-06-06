import { beforeEach, describe, expect, it } from 'vitest';

import type { SimEvent } from 'atlas-shared/schemas';

import { selectVehicleEvents, useEventsStore } from '@/lib/store/events-store';

function geofenceEnter(id: string, vehicleId: string, zoneName = 'Aliados Delivery'): SimEvent {
  return {
    id,
    type: 'geofence.enter',
    vehicleId,
    zoneId: 'zone-1',
    at: new Date().toISOString(),
    payload: { zoneId: 'zone-1', zoneName },
  };
}

describe('events store', () => {
  beforeEach(() => {
    useEventsStore.setState({ events: [], lastAnnounced: null, announceSeq: 0 });
  });

  it('prepends newest-first and bumps the announce counter', () => {
    const { pushEvent } = useEventsStore.getState();
    pushEvent(geofenceEnter('e1', 'veh-1'));
    pushEvent(geofenceEnter('e2', 'veh-2'));
    const state = useEventsStore.getState();
    expect(state.events.map((e) => e.id)).toEqual(['e2', 'e1']);
    expect(state.lastAnnounced?.id).toBe('e2');
    expect(state.announceSeq).toBe(2);
  });

  it('drops a duplicate event id (reconnect-replay safety)', () => {
    const { pushEvent } = useEventsStore.getState();
    pushEvent(geofenceEnter('dup', 'veh-1'));
    pushEvent(geofenceEnter('dup', 'veh-1'));
    expect(useEventsStore.getState().events).toHaveLength(1);
    // The duplicate must not re-announce.
    expect(useEventsStore.getState().announceSeq).toBe(1);
  });

  it('bounds the list to the cap', () => {
    const { pushEvent } = useEventsStore.getState();
    for (let i = 0; i < 80; i += 1) pushEvent(geofenceEnter(`e${String(i)}`, 'veh-1'));
    expect(useEventsStore.getState().events.length).toBeLessThanOrEqual(60);
    // Newest retained at the head.
    expect(useEventsStore.getState().events[0]?.id).toBe('e79');
  });
});

describe('selectVehicleEvents', () => {
  it('filters to one vehicle, newest-first, up to the limit', () => {
    const events: SimEvent[] = [
      geofenceEnter('a', 'veh-1'),
      geofenceEnter('b', 'veh-2'),
      geofenceEnter('c', 'veh-1'),
      geofenceEnter('d', 'veh-1'),
    ];
    const out = selectVehicleEvents(events, 'veh-1', 2);
    expect(out.map((e) => e.id)).toEqual(['a', 'c']);
  });
});
