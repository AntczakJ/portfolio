import { describe, expect, it } from 'vitest';

import type { SimEvent } from 'atlas-shared/schemas';

import { eventCopy } from '@/lib/fleet/event-copy';

const at = new Date().toISOString();

describe('eventCopy', () => {
  it('renders the geofence enter beat line', () => {
    const event: SimEvent = {
      id: 'e1',
      type: 'geofence.enter',
      vehicleId: 'veh-7',
      zoneId: 'zone-downtown',
      at,
      payload: { zoneId: 'zone-downtown', zoneName: 'Downtown Zone' },
    };
    expect(eventCopy(event, 'Truck 7').text).toBe('Truck 7 entered Downtown Zone');
  });

  it('renders the geofence exit line', () => {
    const event: SimEvent = {
      id: 'e2',
      type: 'geofence.exit',
      vehicleId: 'veh-7',
      zoneId: 'zone-downtown',
      at,
      payload: { zoneId: 'zone-downtown', zoneName: 'Downtown Zone' },
    };
    expect(eventCopy(event, 'Truck 7').text).toBe('Truck 7 left Downtown Zone');
  });

  it('renders a status change line', () => {
    const event: SimEvent = {
      id: 'e3',
      type: 'status.change',
      vehicleId: 'veh-3',
      zoneId: null,
      at,
      payload: { from: 'en_route', to: 'at_stop' },
    };
    expect(eventCopy(event, 'Unit 3').text).toBe('Unit 3 is now at stop');
  });

  it('renders arrived / departed lines', () => {
    const arrived: SimEvent = {
      id: 'e4',
      type: 'arrived',
      vehicleId: 'veh-3',
      zoneId: null,
      at,
      payload: { stopId: 's1', stopName: 'Pickup' },
    };
    const departed: SimEvent = { ...arrived, id: 'e5', type: 'departed' };
    expect(eventCopy(arrived, 'Unit 3').text).toBe('Unit 3 arrived at Pickup');
    expect(eventCopy(departed, 'Unit 3').text).toBe('Unit 3 departed Pickup');
  });
});
