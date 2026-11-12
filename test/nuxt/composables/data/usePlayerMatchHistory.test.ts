import type { EffectScope } from 'vue';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, reactive, ref } from 'vue';
import { deferred } from '~~/test/helpers/deferred';
import { createFakeEventChannel } from '~~/test/helpers/realtime-mock';

const { mockFetch } = vi.hoisted(() => ({
	mockFetch: vi.fn(),
}));
const realtime = createFakeEventChannel();

mockNuxtImport('$fetch', () => mockFetch);
mockNuxtImport('tryUseRealtime', () => () => realtime.transport);
mockNuxtImport('useEventStore', () => () => reactive({ eventId: 1 }));

function answer(id: number, name: string, opponentName = 'Bob') {
	return {
		player: { id, name },
		history: [
			{
				id: 1,
				roundId: 31,
				opponentId: 8,
				opponentName,
			},
		],
	};
}

const scopes: EffectScope[] = [];
function readHistory(playerId: () => number | null) {
	const scope = effectScope();
	scopes.push(scope);
	return scope.run(() => usePlayerMatchHistory(playerId))!;
}

describe('usePlayerMatchHistory', () => {
	beforeEach(() => {
		mockFetch.mockReset();
		realtime.reset();
	});

	afterEach(() => {
		scopes.splice(0).forEach(scope => scope.stop());
	});

	it('reads the Player\'s history from the Event, and again when one of their Matches changes', async () => {
		mockFetch.mockResolvedValue(answer(7, 'Alice'));
		const { history } = readHistory(() => 7);
		await flushPromises();

		expect(mockFetch).toHaveBeenCalledWith('/api/events/1/players/7/match-history');
		expect(history.value.map(row => row.opponentName)).toEqual(['Bob']);

		mockFetch.mockResolvedValue(answer(7, 'Alice', 'Bob (renamed)'));
		realtime.deliver('match:updated', {
			match: {
				id: 1,
				roundId: 31,
				player1Id: 7,
				player2Id: 8,
			},
		});
		await flushPromises();

		expect(history.value.map(row => row.opponentName)).toEqual(['Bob (renamed)']);
	});

	// An Archetype rename or delete names the Players it re-projected, or none when they do not fit (ADR-0084).
	it.each([
		{
			naming: 'its Player',
			playerIds: [7],
			reads: 2,
		},
		{
			naming: 'an opponent it holds',
			playerIds: [3, 8],
			reads: 2,
		},
		{
			naming: 'Players it does not show',
			playerIds: [3, 4],
			reads: 1,
		},
		{ naming: 'no Player', playerIds: null, reads: 2 },
	])('has read $reads times after a deck projection change naming $naming', async ({ playerIds, reads }) => {
		mockFetch.mockResolvedValue(answer(7, 'Alice'));
		readHistory(() => 7);
		await flushPromises();

		realtime.deliver('player:deckProjectionsChanged', { playerIds });
		await flushPromises();

		expect(mockFetch).toHaveBeenCalledTimes(reads);
	});

	it('shows nothing of the last Player while the next Player\'s history loads', async () => {
		const playerId = ref(7);
		mockFetch.mockResolvedValue(answer(7, 'Alice'));
		const { player, history, loading } = readHistory(() => playerId.value);
		await flushPromises();
		const bobsAnswer = deferred<unknown>();
		mockFetch.mockReturnValue(bobsAnswer.promise);

		playerId.value = 8;
		await flushPromises();

		expect([player.value, history.value, loading.value]).toEqual([null, [], true]);
		bobsAnswer.resolve(answer(8, 'Bob', 'Alice'));
		await flushPromises();
		expect([player.value?.name, loading.value]).toEqual(['Bob', false]);
	});
});
