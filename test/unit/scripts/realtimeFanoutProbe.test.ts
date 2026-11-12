import { describe, expect, it, vi } from 'vitest';
import { deliveredByChannel, main, probeOrigin, RealtimeFanoutProbeRefusal } from '../../../scripts/measure-realtime-fanout.mjs';

// A Screen is told on its own channel what the Event channel announced, so a
// total alone cannot say which channel a change in the count came from.
describe('the fan-out probe counts each channel apart', () => {
	it.each([
		{
			name: 'nothing delivered',
			received: [],
			byChannel: {
				event: { delivered: 0, byType: {} },
				screen: { delivered: 0, byType: {} },
			},
		},
		{
			name: 'one type on both channels',
			received: [
				{ channel: 'event', name: 'match:updated', bytes: 10 },
				{ channel: 'event', name: 'match:updated', bytes: 10 },
				{ channel: 'screen', name: 'output:modeDataChanged', bytes: 4 },
				{ channel: 'screen', name: 'match:updated', bytes: 10 },
			],
			byChannel: {
				event: {
					delivered: 2,
					byType: { 'match:updated': 2 },
				},
				screen: {
					delivered: 2,
					byType: { 'output:modeDataChanged': 1, 'match:updated': 1 },
				},
			},
		},
	])('$name', ({ received, byChannel }) => {
		expect(deliveredByChannel(received)).toEqual(byChannel);
	});
});

describe('the fan-out probe refuses to default its origin', () => {
	it.each([
		{},
		{ PROBE_ORIGIN: '' },
		{ PROBE_ORIGIN: '   ' },
	])('refuses %j with its own named error', (env) => {
		expect(() => probeOrigin(env)).toThrow(RealtimeFanoutProbeRefusal);
	});

	it.each(['http://127.0.0.1:8799', 'http://127.0.0.1:8799/', '  http://127.0.0.1:8799  '])('accepts the named origin %j', (origin) => {
		expect(probeOrigin({ PROBE_ORIGIN: origin })).toBe('http://127.0.0.1:8799');
	});

	// The probe writes an Event and a live session to whatever answers, and the old
	// default, :8787, is the port every worktree shares (#289). So its first
	// provisioning step is stood in for: a run that got past the refusal ends here.
	it('fails a run with no origin on the refusal, before provisioning anything', async () => {
		const openOperatorSession = vi.fn(async () => {
			throw new Error('the probe went on to provision');
		});

		await expect(main({ env: {}, openOperatorSession })).rejects.toBeInstanceOf(RealtimeFanoutProbeRefusal);
		expect(openOperatorSession).not.toHaveBeenCalled();
	});
});
