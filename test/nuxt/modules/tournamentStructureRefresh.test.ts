import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockEvent, createMockFeatureMatch, createMockMatch, createMockPhase, createMockRound } from '~~/test/helpers/fixtures';
import { settleUntil, settleUntilStill } from '~~/test/helpers/settle';
import { realtimeHandlersFor } from '~~/test/nuxt/helpers/realtimeEventSession';

/*
 * A Phase or Round delete cascades on the server — a Phase's Rounds, their
 * Matches, the Match a Slot showed — and announces only itself.
 */

/** What the server holds for Event 1, answered by path. */
const server = vi.hoisted(() => ({
	held: {} as Record<string, unknown[]>,
	reads: [] as string[],
}));

mockNuxtImport('$fetch', () => async (path: string) => {
	server.reads.push(path);
	return server.held[path] ?? [];
});

const { deliver } = realtimeHandlersFor();

const EVENT = '/api/events/1';

async function loadStructure() {
	server.held = {
		[`${EVENT}/phases`]: [
			createMockPhase({ id: 1 }),
		],
		[`${EVENT}/rounds`]: [
			createMockRound({ id: 5, phaseId: 1 }),
		],
		[`${EVENT}/matches`]: [
			createMockMatch({ id: 7, roundId: 5 }),
		],
		[`${EVENT}/feature-match-slots`]: [
			createMockFeatureMatch({ id: 3, matchId: 7 }),
		],
	};
	await Promise.all([
		usePhaseStore().loadPhasesByEventId(1),
		useRoundStore().loadRoundsByEventId(1),
		useMatchStore().loadMatchesByEventId(1),
		useFeatureMatchStore().loadFeatureMatchesByEventId(1),
	]);
}

/** The server after the delete: the Round and its Match gone, the Slot showing no Match. */
function cascadeOnServer() {
	server.held[`${EVENT}/rounds`] = [];
	server.held[`${EVENT}/matches`] = [];
	server.held[`${EVENT}/feature-match-slots`] = [
		createMockFeatureMatch({ id: 3, matchId: null }),
	];
	server.reads = [];
}

function heldStructure() {
	return {
		rounds: useRoundStore().rounds.map(round => round.id),
		matches: useMatchStore().matches.map(match => match.id),
		slotMatches: useFeatureMatchStore().featureMatches.map(slot => slot.matchId),
	};
}

describe('a Phase or Round delete', () => {
	beforeEach(async () => {
		resetAllEventStores();
		useEventStore().event = createMockEvent({ id: 1 }) as never;
		await loadStructure();
	});

	// The Round store drops this client's own deleted Round as the delete answers,
	// before the re-read, so only that row still holds it here.
	it.each([
		[
			'a peer deletes a Phase',
			[],
			() => deliver('phase:deleted', { phaseId: 1 }),
		],
		[
			'a peer deletes a Round',
			[],
			() => deliver('round:deleted', { roundId: 5 }),
		],
		[
			'this client deleted a Phase',
			[],
			() => useTournamentStructureRefresh().refreshAfterPhaseDelete(1),
		],
		[
			'this client deleted a Round',
			[5],
			() => useTournamentStructureRefresh().refreshAfterRoundDelete(1),
		],
	])('when %s, the Rounds, Matches and Slots it reached are re-read', async (_, rounds, act) => {
		cascadeOnServer();

		await act();
		await settleUntil(() => useFeatureMatchStore().featureMatches[0]?.matchId === null
			&& useMatchStore().matches.length === 0);

		expect(heldStructure()).toEqual({
			rounds,
			matches: [],
			slotMatches: [null],
		});
	});

	// A rendering of a Screen holds no operator Event and no Session for the
	// operator's private reads, so it re-reads nothing (#604).
	it('re-reads nothing on a rendering of a Screen', async () => {
		useEventStore().event = null;
		cascadeOnServer();

		deliver('phase:deleted', { phaseId: 1 });
		await settleUntilStill(() => server.reads);

		expect(server.reads).toEqual([]);
	});

	it('loads no collection the client does not hold', async () => {
		resetAllEventStores();
		useEventStore().event = createMockEvent({ id: 1 }) as never;
		server.reads = [];

		deliver('phase:deleted', { phaseId: 1 });
		await settleUntilStill(() => server.reads);

		expect(server.reads).toEqual([]);
	});
});
