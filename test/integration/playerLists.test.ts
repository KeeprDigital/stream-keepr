import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { $fetch } from './client';
import { $fetchRaw } from './helpers';

describe('player lists API', () => {
	let eventId: number;
	let player1Id: number;
	let player2Id: number;
	let listId: number;

	beforeAll(async () => {
		const event = await $fetch('/api/events', {
			method: 'POST',
			body: { name: 'Integration PlayerLists Event', game: 'mtg', featureMatchOrientation: 'horizontal' },
		});
		eventId = event.id;

		const p1 = await $fetch(`/api/events/${eventId}/players`, {
			method: 'POST',
			body: { name: 'List Player A' },
		});
		player1Id = p1.id;

		const p2 = await $fetch(`/api/events/${eventId}/players`, {
			method: 'POST',
			body: { name: 'List Player B' },
		});
		player2Id = p2.id;
	});

	afterAll(async () => {
		try {
			await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
		}
		catch {}
	});

	it('creates a player list and returns 201', async () => {
		const res = await $fetchRaw(`/api/events/${eventId}/player-lists`, {
			method: 'POST',
			body: { name: 'Top 8 List' },
		});

		expect(res.status).toBe(201);
		expect(res._data).toMatchObject({
			name: 'Top 8 List',
			eventId,
		});
		expect(res._data.id).toBeTypeOf('number');
		listId = res._data.id;
	});

	it('lists player lists for the event', async () => {
		const data = await $fetch(`/api/events/${eventId}/player-lists`);

		expect(data.playerLists).toBeInstanceOf(Array);
		expect(data.total).toBeGreaterThanOrEqual(1);

		const found = data.playerLists.find((l: { id: number }) => l.id === listId);
		expect(found).toBeDefined();
		expect(found!.name).toBe('Top 8 List');
		expect(found).toHaveProperty('memberCount');
	});

	it('adds members to the list', async () => {
		const res = await $fetchRaw(`/api/events/${eventId}/player-lists/${listId}/members`, {
			method: 'POST',
			body: {
				playerIds: [player1Id, player2Id],
			},
		});

		expect(res.status).toBe(201);
	});

	it('gets member IDs from the list', async () => {
		const data = await $fetch(`/api/events/${eventId}/player-lists/${listId}/member-ids`);

		expect(data.memberIds).toBeInstanceOf(Array);
		expect(data.memberIds).toContain(player1Id);
		expect(data.memberIds).toContain(player2Id);
	});

	it('deletes the player list', async () => {
		// Create a throwaway list
		const list = await $fetch(`/api/events/${eventId}/player-lists`, {
			method: 'POST',
			body: { name: 'Delete Me List' },
		});

		const result = await $fetch(`/api/events/${eventId}/player-lists/${list.id}`, {
			method: 'DELETE',
		});

		expect(result).toEqual({ success: true });

		// Verify it's gone
		const res = await $fetchRaw(`/api/events/${eventId}/player-lists/${list.id}`);
		expect(res.status).toBe(404);
	});
});

describe('a player list and its members', () => {
	let eventId: number;
	let player1Id: number;
	let player2Id: number;
	let player3Id: number;
	let listId: number;

	beforeAll(async () => {
		const event = await $fetch('/api/events', {
			method: 'POST',
			body: { name: 'Integration PlayerList Extended', game: 'mtg', featureMatchOrientation: 'horizontal' },
		});
		eventId = event.id;

		const [p1, p2, p3] = await Promise.all([
			$fetch(`/api/events/${eventId}/players`, {
				method: 'POST',
				body: { name: 'ExtList Player A' },
			}),
			$fetch(`/api/events/${eventId}/players`, {
				method: 'POST',
				body: { name: 'ExtList Player B' },
			}),
			$fetch(`/api/events/${eventId}/players`, {
				method: 'POST',
				body: { name: 'ExtList Player C' },
			}),
		]);
		player1Id = p1.id;
		player2Id = p2.id;
		player3Id = p3.id;

		// Create a list and add all three members
		const list = await $fetch(`/api/events/${eventId}/player-lists`, {
			method: 'POST',
			body: { name: 'Extended Test List' },
		});
		listId = list.id;

		await $fetch(`/api/events/${eventId}/player-lists/${listId}/members`, {
			method: 'POST',
			body: {
				playerIds: [player1Id, player2Id, player3Id],
			},
		});
	});

	afterAll(async () => {
		try {
			await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
		}
		catch {}
	});

	// ── PATCH /player-lists/[listId] ──

	it('updates a player list name', async () => {
		const updated = await $fetch(`/api/events/${eventId}/player-lists/${listId}`, {
			method: 'PATCH',
			body: { name: 'Renamed List' },
		});

		expect(updated.id).toBe(listId);
		expect(updated.name).toBe('Renamed List');
		expect(updated.eventId).toBe(eventId);
	});

	// ── GET /player-lists/[listId] (with members) ──

	it('gets a player list with members', async () => {
		const data = await $fetch(`/api/events/${eventId}/player-lists/${listId}`);

		expect(data.id).toBe(listId);
		expect(data.name).toBe('Renamed List');
		expect(data.members).toBeInstanceOf(Array);
		expect(data.members).toHaveLength(3);

		const memberIds = data.members.map((m: { id: number }) => m.id);
		expect(memberIds).toContain(player1Id);
		expect(memberIds).toContain(player2Id);
		expect(memberIds).toContain(player3Id);

		// Each member should have player fields
		const member = data.members[0];
		expect(member).toHaveProperty('name');
		expect(member).toHaveProperty('id');
	});

	// ── PUT /player-lists/[listId]/members/reorder ──

	it('reorders members in the list', async () => {
		const reversedOrder = [player3Id, player1Id, player2Id];

		const result = await $fetch(`/api/events/${eventId}/player-lists/${listId}/members/reorder`, {
			method: 'PUT',
			body: { playerIds: reversedOrder },
		});

		expect(result).toEqual({ reordered: 3, memberCount: 3 });

		// Verify order via GET list with members
		const data = await $fetch(`/api/events/${eventId}/player-lists/${listId}`);
		const memberIds = data.members.map((m: { id: number }) => m.id);
		expect(memberIds).toEqual(reversedOrder);
	});
});
