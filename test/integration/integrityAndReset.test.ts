import { $fetch } from '@nuxt/test-utils/e2e';
import { afterAll, describe, expect, it } from 'vitest';
import { executeIntegrationD1 } from './integrationD1';

describe('event integrity and melee reset', () => {
	const eventIds: number[] = [];

	async function createEvent(name: string) {
		const event = await $fetch('/api/events', {
			method: 'POST',
			body: { name, game: 'mtg', featureMatchOrientation: 'horizontal' },
		});
		eventIds.push(event.id);
		return event;
	}

	afterAll(async () => {
		for (const eventId of eventIds) {
			try {
				await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
			}
			catch {}
		}
	});

	it('disabling melee clears imported data and melee-linked feature match bindings', async () => {
		const event = await createEvent('Melee Reset Event');

		const importedPlayer = await $fetch(`/api/events/${event.id}/players`, {
			method: 'POST',
			body: {
				name: 'Imported Player',
			},
		});
		const phase = await $fetch(`/api/events/${event.id}/phases`, {
			method: 'POST',
			body: {
				name: 'Imported Phase',
				sortOrder: 0,
			},
		});
		const round = await $fetch(`/api/events/${event.id}/rounds`, {
			method: 'POST',
			body: {
				phaseId: phase.id,
				name: 'Imported Round',
				roundNumber: 1,
			},
		});
		const match = await $fetch(`/api/events/${event.id}/matches`, {
			method: 'POST',
			body: {
				roundId: round.id,
				player1Id: importedPlayer.id,
				player1Data: { name: importedPlayer.name },
			},
		});

		// Public DTOs intentionally cannot forge integration provenance. Promote
		// these otherwise-valid rows to controlled Melee fixtures directly in the
		// isolated D1 database, mirroring the internal sync boundary.
		await executeIntegrationD1(`
			UPDATE players SET external_id = 'p-1', external_source = 'melee' WHERE id = ${importedPlayer.id} AND event_id = ${event.id};
			UPDATE phases SET external_id = 'phase-1', external_source = 'melee' WHERE id = ${phase.id} AND event_id = ${event.id};
			UPDATE rounds SET external_id = 'round-1', external_source = 'melee' WHERE id = ${round.id} AND event_id = ${event.id};
			UPDATE matches SET external_id = 'match-1', external_source = 'melee' WHERE id = ${match.id} AND event_id = ${event.id};
		`);
		const featureMatch = await $fetch(`/api/events/${event.id}/feature-match-slots`, {
			method: 'POST',
			body: { bestOf: 3 },
		});

		await $fetch(`/api/events/${event.id}/feature-match-slots/${featureMatch.id}/setup`, {
			method: 'PATCH',
			body: {
				matchId: match.id,
				player1Id: importedPlayer.id,
				player1Data: { name: importedPlayer.name },
			},
		});

		const updatedEvent = await $fetch(`/api/events/${event.id}/melee-config`, {
			method: 'PUT',
			body: {
				meleeEnabled: false,
				meleeEventId: null,
				meleeClientId: null,
				meleeClientSecret: null,
			},
		});

		expect(updatedEvent.meleeEnabled).toBe(false);
		expect(updatedEvent.initialSetupCompletedAt).toBeNull();
		expect(updatedEvent.lastEventSyncedAt).toBeNull();

		const [players, phases, rounds, matches, featureMatches] = await Promise.all([
			$fetch(`/api/events/${event.id}/players`),
			$fetch(`/api/events/${event.id}/phases`),
			$fetch(`/api/events/${event.id}/rounds`),
			$fetch(`/api/events/${event.id}/matches`),
			$fetch(`/api/events/${event.id}/feature-match-slots`),
		]);

		expect(players.players).toHaveLength(0);
		expect(phases.phases).toHaveLength(0);
		expect(rounds.rounds).toHaveLength(0);
		expect(matches.matches).toHaveLength(0);
		const clearedFeatureMatch = featureMatches.featureMatchSlots.find((item: { id: number }) => item.id === featureMatch.id);
		expect(clearedFeatureMatch).toBeDefined();
		expect(clearedFeatureMatch).toMatchObject({
			id: featureMatch.id,
			matchId: null,
			externalId: null,
			externalSource: null,
			player1Id: null,
			player2Id: null,
			player1Data: null,
			player2Data: null,
			bestOf: 3,
		});
	});
});
