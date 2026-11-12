import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { $fetch } from './client';
import { $fetchRaw } from './helpers';
import { integrationRealtimeConfigured } from './realtimeKey';

describe('misc API endpoints', () => {
	let eventId: number;

	beforeAll(async () => {
		const event = await $fetch('/api/events', {
			method: 'POST',
			body: { name: 'Integration Misc Event', game: 'mtg', featureMatchOrientation: 'horizontal' },
		});
		eventId = event.id;
	});

	afterAll(async () => {
		try {
			await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
		}
		catch {}
	});

	// ── /api/time ──

	it('gET /api/time returns serverTime as a number', async () => {
		const data = await $fetch('/api/time');

		expect(data).toHaveProperty('serverTime');
		expect(data.serverTime).toBeTypeOf('number');
		// Should be a reasonable timestamp (after 2024-01-01)
		expect(data.serverTime).toBeGreaterThan(1_704_067_200_000);
	});

	// ── /api/events/[id]/standings ──

	it('gET standings returns empty standings for a fresh event', async () => {
		const data = await $fetch(`/api/events/${eventId}/standings`);

		expect(data).toHaveProperty('standings');
		expect(data.standings).toBeInstanceOf(Array);
		expect(data.roundId).toBeNull();
	});

	it('gET standings includes players that have scores', async () => {
		// Create a player with wins/losses set
		const player = await $fetch(`/api/events/${eventId}/players`, {
			method: 'POST',
			body: {
				name: 'Standings Player',
				wins: 2,
				losses: 1,
				position: 1,
			},
		});

		const data = await $fetch(`/api/events/${eventId}/standings`);

		const found = data.standings.find((s: { playerId: number }) => s.playerId === player.id);
		expect(found).toBeDefined();
		expect(found!.name).toBe('Standings Player');
		expect(found!.wins).toBe(2);
		expect(found!.losses).toBe(1);
		expect(found!.position).toBe(1);

		// Cleanup
		await $fetch(`/api/events/${eventId}/players/${player.id}`, { method: 'DELETE' });
	});

	it('gET standings with invalid roundId returns 404', async () => {
		const res = await $fetchRaw(`/api/events/${eventId}/standings?roundId=999999`);

		expect(res.status).toBe(404);
	});

	// ── /api/realtime/token ──

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
