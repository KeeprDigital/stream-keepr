import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockFeatureMatch, createMockMatch, createMockPhase, createMockPlayer, createMockRound } from '~~/test/helpers/fixtures';

/*
 * The refresh after a Melee data reset, over the real stores it reloads. Faked:
 * `$fetch`, the network every one of them reads through.
 */

const { mockFetch } = vi.hoisted(() => ({
	mockFetch: vi.fn(),
}));
mockNuxtImport('$fetch', () => mockFetch);

/** What the server holds once the reset has committed, by the resource each store reads. */
const server: Record<string, unknown> = {
	'phases': [
		createMockPhase({ id: 1, eventId: 1 }),
	],
	'rounds': [
		createMockRound({ id: 10, eventId: 1, phaseId: 1 }),
	],
	'players': [
		createMockPlayer({ id: 7, eventId: 1 }),
	],
	'decks': {
		decks: [
			{ id: 70, eventId: 1, playerId: 7 },
		],
	},
	'feature-match-slots': [
		createMockFeatureMatch({ id: 5, eventId: 1 }),
	],
	'matches': [
		createMockMatch({ id: 100, eventId: 1, roundId: 10 }),
	],
};

/** The server answers every read but those of one resource. */
function serveAllBut(failing?: string) {
	mockFetch.mockImplementation(async (path: string) => {
		const resource = path.replace(/^\/api\/events\/\d+\//, '');
		if (resource === failing)
			throw new Error(`${resource} offline`);
		return server[resource];
	});
}

/** What this client holds, by the resource it was read from. */
function held() {
	return {
		'phases': usePhaseStore().phases.map(phase => phase.id),
		'rounds': useRoundStore().rounds.map(round => round.id),
		'players': usePlayerStore().players.map(player => player.id),
		'decks': usePlayerDeckStore().decks.map(deck => deck.id),
		'feature-match-slots': useFeatureMatchStore().featureMatches.map(slot => slot.id),
		'matches': useMatchStore().matches.map(match => match.id),
	};
}

const reloaded = {
	'phases': [1],
	'rounds': [10],
	'players': [7],
	'decks': [70],
	'feature-match-slots': [5],
	'matches': [100],
};

describe('refreshAfterMeleeReset, when a reload fails', () => {
	beforeEach(async () => {
		for (const store of [
			usePhaseStore(),
			useRoundStore(),
			useMatchStore(),
			usePlayerStore(),
			usePlayerDeckStore(),
			useFeatureMatchStore(),
			useFeatureMatchStateStore(),
			useMetagameStore(),
		])
			store.$reset();
		// Matches are re-read only where held; nothing else is held before the reset.
		mockFetch.mockResolvedValue([]);
		await useMatchStore().loadMatchesByEventId(1);
	});

	// The reset committed, so its caller reports the failure rather than the store.
	it.each([
		'phases',
		'rounds',
		'players',
		'feature-match-slots',
		'matches',
	] as const)('raises a failed %s reload to a caller that asked, once every other reload has landed', async (failing) => {
		serveAllBut(failing);

		await expect(useMeleeDataRefresh().refreshAfterMeleeReset(1, { failure: 'raise' })).rejects.toThrow(`${failing} offline`);

		expect(held()).toEqual({ ...reloaded, [failing]: [] });
	});

	it('answers a caller that did not ask as it answers a refresh that landed', async () => {
		serveAllBut('players');

		await expect(useMeleeDataRefresh().refreshAfterMeleeReset(1)).resolves.toBeUndefined();

		expect(held()).toEqual({ ...reloaded, players: [] });
		expect(usePlayerStore().error).toBe('players offline');
	});
});
