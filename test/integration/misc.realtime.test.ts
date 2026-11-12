import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { $fetch } from './client';
import { integrationRealtimeConfigured } from './realtimeKey';

describe('the realtime token route', () => {
	let eventId: number;

	beforeAll(async () => {
		const event = await $fetch('/api/events', {
			method: 'POST',
			body: { name: 'Integration Realtime Token Event', game: 'mtg', featureMatchOrientation: 'horizontal' },
		});
		eventId = event.id;
	});

	afterAll(async () => {
		try {
			await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
		}
		catch {}
	});

	// `test/unit/server/api/realtime/token.get.test.ts` pins the query refusals and
	// the capability the handler asks for; what a key buys here is the proof that
	// the SDK grants that capability back in the shape the client parses.
	it.skipIf(!integrationRealtimeConfigured)('gET realtime token with a valid eventId returns a capability scoped to only that event', async () => {
		const data = await $fetch(`/api/realtime/token?eventId=${eventId}`);

		expect(data).toHaveProperty('capability');
		const capability = JSON.parse(data.capability) as Record<string, string[]>;

		expect(Object.keys(capability).sort()).toEqual([`event:${eventId}`, `screen:${eventId}:*`].sort());
		expect(capability[`event:${eventId}`]!.sort()).toEqual(['history', 'subscribe']);
		expect(capability[`screen:${eventId}:*`]!.sort()).toEqual(['history', 'presence', 'subscribe']);

		const channelPatterns = Object.keys(capability);
		expect(channelPatterns).not.toContain('event:*');
		expect(channelPatterns).not.toContain('screen:*');
	});
});
