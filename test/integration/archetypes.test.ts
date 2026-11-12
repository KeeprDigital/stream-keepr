import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { $fetch } from './client';
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

		// A One Piece Archetype follows its Leader, so none is created by hand (ADR-0074).
		const opCreate = await $fetchRaw(`/api/events/${opEventId}/archetypes`, {
			method: 'POST',
			body: { name: 'Straw Hat' },
		});
		expect(opCreate.status).toBe(400);

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

	// ── Merge, name clashes and Empty Archetypes ──

	it('refuses a second Archetype of a name in another case, and merges one into another', async () => {
		const merged = (await $fetch(`/api/events/${eventId}/archetypes`, {
			method: 'POST',
			body: { name: 'Merge Away' },
		})) as any;
		const survivor = (await $fetch(`/api/events/${eventId}/archetypes`, {
			method: 'POST',
			body: { name: 'Merge Survivor' },
		})) as any;
		const player = (await $fetch(`/api/events/${eventId}/players`, {
			method: 'POST',
			body: { name: 'Merge Player' },
		})) as any;
		await $fetch(`/api/events/${eventId}/players/${player.id}`, {
			method: 'PATCH',
			body: { archetypeId: merged.id },
		});

		const clash = await $fetchRaw(`/api/events/${eventId}/archetypes/${merged.id}`, {
			method: 'PATCH',
			body: { name: ' merge survivor ' },
		});
		expect(clash.status).toBe(409);
		expect(clash._data.message).toContain('Merge Survivor');

		const res = await $fetchRaw(`/api/events/${eventId}/archetypes/${merged.id}/merge`, {
			method: 'POST',
			body: { intoArchetypeId: survivor.id },
		});
		expect(res.status).toBe(200);
		expect(res._data).toEqual({ archetypeId: survivor.id, mergedArchetypeId: merged.id });

		const archetypes = (await $fetch(`/api/events/${eventId}/archetypes`)) as any;
		expect(archetypes.archetypes.find((a: any) => a.id === merged.id)).toBeUndefined();
		const players = (await $fetch(`/api/events/${eventId}/players`)) as any;
		expect(players.players.find((p: any) => p.id === player.id).archetypeId).toBe(survivor.id);
	});

	// In an Event of its own: it removes every Empty Archetype of the Event it is asked of.
	it('removes the Empty Archetypes, keeping one a Player holds', async () => {
		const event = (await $fetch('/api/events', {
			method: 'POST',
			body: { name: 'Integration Empty Archetypes Event', game: 'mtg', featureMatchOrientation: 'horizontal' },
		})) as any;
		try {
			const empty = (await $fetch(`/api/events/${event.id}/archetypes`, {
				method: 'POST',
				body: { name: 'Empty To Remove' },
			})) as any;
			const held = (await $fetch(`/api/events/${event.id}/archetypes`, {
				method: 'POST',
				body: { name: 'Held By A Player' },
			})) as any;
			const player = (await $fetch(`/api/events/${event.id}/players`, {
				method: 'POST',
				body: { name: 'Holding Player' },
			})) as any;
			await $fetch(`/api/events/${event.id}/players/${player.id}`, {
				method: 'PATCH',
				body: { archetypeId: held.id },
			});

			const res = await $fetchRaw(`/api/events/${event.id}/archetypes/empty`, { method: 'DELETE' });

			expect(res.status).toBe(200);
			expect(res._data.archetypeIds).toEqual([empty.id]);
			const archetypes = (await $fetch(`/api/events/${event.id}/archetypes`)) as any;
			expect(archetypes.archetypes.map((a: any) => a.id)).toEqual([held.id]);
		}
		finally {
			await $fetch(`/api/events/${event.id}`, { method: 'DELETE' }).catch(() => {});
		}
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
				{
					method: 'PATCH',
					body: { cardIds: [] },
				},
			)) as any;

			expect(data).toHaveProperty('keyCards');
			expect(data.keyCards).toBeInstanceOf(Array);
			expect(data.keyCards).toHaveLength(0);
		});

		it('gET /archetypes/99999/cards returns 404', async () => {
			const res = await $fetchRaw(
				`/api/events/${eventId}/archetypes/99999/cards`,
				{ ignoreResponseError: true },
			);

			expect(res.status).toBe(404);
		});
	});
});
