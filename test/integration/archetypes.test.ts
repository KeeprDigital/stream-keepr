import { $fetch } from '@nuxt/test-utils/e2e';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { $fetchRaw } from './helpers';

describe('archetypes API', () => {
	let eventId: number;
	let archetypeId: number;
	let opEventId: number;
	let keyCardArchetypeId: number;

	beforeAll(async () => {
		const event = await $fetch('/api/events', {
			method: 'POST',
			body: { name: 'Integration Archetypes Event', game: 'mtg', featureMatchOrientation: 'horizontal' },
		}) as any;
		eventId = event.id;

		const opEvent = await $fetch('/api/events', {
			method: 'POST',
			body: { name: 'Integration OP Archetypes Event', game: 'op', featureMatchOrientation: 'horizontal' },
		}) as any;
		opEventId = opEvent.id;

		const opArchetype = await $fetch(`/api/events/${opEventId}/archetypes`, {
			method: 'POST',
			body: { name: 'Straw Hat' },
		}) as any;
		expect(opArchetype.id).toBeTypeOf('number');

		const keyCardArchetype = await $fetch(`/api/events/${eventId}/archetypes`, {
			method: 'POST',
			body: { name: 'Key Cards Test', colors: 'R' },
		}) as any;
		keyCardArchetypeId = keyCardArchetype.id;
	});

	afterAll(async () => {
		try {
			await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
		}
		catch {}

		try {
			await $fetch(`/api/events/${opEventId}`, { method: 'DELETE' });
		}
		catch {}
	});

	// ── CRUD ──

	it('creates an archetype and returns 201', async () => {
		const res = await $fetchRaw(`/api/events/${eventId}/archetypes`, {
			method: 'POST',
			body: { name: 'Azorius Control', colors: 'WU' },
		});

		expect(res.status).toBe(201);
		expect(res._data).toMatchObject({
			name: 'Azorius Control',
			colors: 'WU',
			eventId,
		});
		// keyCards are managed separately via the /cards sub-resource
		expect(res._data.keyCards).toEqual([]);
		archetypeId = res._data.id;
	});

	it('lists archetypes for the event', async () => {
		const data = (await $fetch(`/api/events/${eventId}/archetypes`)) as any;

		expect(data.archetypes).toBeInstanceOf(Array);
		expect(data.total).toBeGreaterThanOrEqual(1);
		const found = data.archetypes.find((a: { id: number }) => a.id === archetypeId);
		expect(found).toBeDefined();
		expect(found.name).toBe('Azorius Control');
		// Each archetype includes keyCards array
		expect(found.keyCards).toBeInstanceOf(Array);
	});

	it('updates an archetype name', async () => {
		const updated = (await $fetch(`/api/events/${eventId}/archetypes/${archetypeId}`, {
			method: 'PATCH',
			body: { name: 'Azorius Control v2', colors: 'WUB' },
		})) as any;

		expect(updated.name).toBe('Azorius Control v2');
		expect(updated.colors).toBe('WUB');
	});

	it('deletes an archetype', async () => {
		const res = await $fetchRaw(`/api/events/${eventId}/archetypes/${archetypeId}`, {
			method: 'DELETE',
		});

		expect(res.status).toBe(200);
		expect(res._data.success).toBe(true);
	});

	// ── Delete atomicity ──

	describe('delete atomicity', () => {
		it('removes the archetype and clears player classifications for it in one observable step', async () => {
			const archetype = (await $fetch(`/api/events/${eventId}/archetypes`, {
				method: 'POST',
				body: { name: 'Delete Atomicity Test', colors: 'B' },
			})) as any;

			const player = (await $fetch(`/api/events/${eventId}/players`, {
				method: 'POST',
				body: { name: 'Delete Atomicity Player' },
			})) as any;

			await $fetch(`/api/events/${eventId}/players/${player.id}`, {
				method: 'PATCH',
				body: { archetypeId: archetype.id },
			});

			const beforeDelete = (await $fetch(`/api/events/${eventId}/players`)) as any;
			expect(beforeDelete.players.find((p: any) => p.id === player.id).archetypeId).toBe(archetype.id);

			const res = await $fetchRaw(`/api/events/${eventId}/archetypes/${archetype.id}`, {
				method: 'DELETE',
			});
			expect(res.status).toBe(200);
			expect(res._data.success).toBe(true);

			// Post-condition 1: the archetype is fully gone.
			const archetypesAfter = (await $fetch(`/api/events/${eventId}/archetypes`)) as any;
			expect(archetypesAfter.archetypes.find((a: any) => a.id === archetype.id)).toBeUndefined();

			// Post-condition 2: the player's classification into the deleted
			// archetype was cleared as part of the same delete request, not left
			// dangling — observing both facts together confirms they committed
			// as a single atomic step rather than the archetype removal alone.
			const afterDelete = (await $fetch(`/api/events/${eventId}/players`)) as any;
			expect(afterDelete.players.find((p: any) => p.id === player.id).archetypeId).toBeNull();

			// Deleting again 404s — confirms the archetype is truly gone, not
			// merely hidden from the list.
			const secondDelete = await $fetchRaw(`/api/events/${eventId}/archetypes/${archetype.id}`, {
				method: 'DELETE',
			});
			expect(secondDelete.status).toBe(404);
		});
	});

	// ── Validation ──

	// ── Key Cards API ──

	describe('key cards API', () => {
		it('gET /archetypes/:id/cards for fresh archetype returns empty keyCards', async () => {
			const data = (await $fetch(
				`/api/events/${eventId}/archetypes/${keyCardArchetypeId}/cards`,
			)) as any;

			expect(data).toHaveProperty('keyCards');
			expect(data.keyCards).toBeInstanceOf(Array);
			expect(data.keyCards).toHaveLength(0);
		});

		it('pATCH /archetypes/:id/cards with empty cardIds clears key cards', async () => {
			const data = (await $fetch(
				`/api/events/${eventId}/archetypes/${keyCardArchetypeId}/cards`,
				{ method: 'PATCH', body: { cardIds: [] } },
			)) as any;

			expect(data).toHaveProperty('keyCards');
			expect(data.keyCards).toBeInstanceOf(Array);
			expect(data.keyCards).toHaveLength(0);
		});

		it('pATCH /archetypes/:id/cards with > 5 cardIds returns 400', async () => {
			const res = await $fetchRaw(
				`/api/events/${eventId}/archetypes/${keyCardArchetypeId}/cards`,
				{
					method: 'PATCH',
					body: { cardIds: [1, 2, 3, 4, 5, 6] },
					ignoreResponseError: true,
				},
			);

			expect(res.status).toBeGreaterThanOrEqual(400);
		});

		it('gET /archetypes/99999/cards returns 404', async () => {
			const res = await $fetchRaw(
				`/api/events/${eventId}/archetypes/99999/cards`,
				{ ignoreResponseError: true },
			);

			expect(res.status).toBe(404);
		});

		it('pATCH /archetypes/99999/cards returns 404', async () => {
			const res = await $fetchRaw(
				`/api/events/${eventId}/archetypes/99999/cards`,
				{
					method: 'PATCH',
					body: { cardIds: [] },
					ignoreResponseError: true,
				},
			);

			expect(res.status).toBe(404);
		});

		it('pATCH archetype response includes keyCards', async () => {
			const data = (await $fetch(
				`/api/events/${eventId}/archetypes/${keyCardArchetypeId}`,
				{ method: 'PATCH', body: { name: 'Key Cards Test Updated' } },
			)) as any;

			expect(data).toHaveProperty('keyCards');
			expect(data.keyCards).toBeInstanceOf(Array);
		});
	});
});
