import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { $fetch } from './client';

describe('player lists extended API', () => {
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
			body: { playerIds: [player1Id, player2Id, player3Id] },
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

	it('rejects a partial or duplicate reorder payload', async () => {
		await expect($fetch(`/api/events/${eventId}/player-lists/${listId}/members/reorder`, {
			method: 'PUT',
			body: { playerIds: [player1Id, player2Id] },
		})).rejects.toMatchObject({ statusCode: 400 });

		await expect($fetch(`/api/events/${eventId}/player-lists/${listId}/members/reorder`, {
			method: 'PUT',
			body: { playerIds: [player1Id, player1Id, player3Id] },
		})).rejects.toMatchObject({ statusCode: 400 });

		const data = await $fetch(`/api/events/${eventId}/player-lists/${listId}`);
		const memberIds = data.members.map((member: { id: number }) => member.id);
		expect(memberIds).toEqual([player3Id, player1Id, player2Id]);
	});

	// ── POST /player-lists/[listId]/members/batch-remove ──
});
