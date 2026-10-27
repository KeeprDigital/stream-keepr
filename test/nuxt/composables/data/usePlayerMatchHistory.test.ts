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
