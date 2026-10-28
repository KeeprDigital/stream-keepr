import type { EffectScope } from 'vue';
import type { CardPageMode } from '~/types/card/page';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, ref } from 'vue';

function cardView(held: { mode?: CardPageMode; roundId?: number; matchId?: number; playerId?: number } = {}) {
	return {
		mode: ref<CardPageMode>(held.mode ?? 'search'),
		roundId: ref<number | null>(held.roundId ?? null),
		matchId: ref<number | null>(held.matchId ?? null),
		playerId: ref<number | null>(held.playerId ?? null),
	};
}

function snapshot(view: ReturnType<typeof cardView>) {
	return {
		mode: view.mode.value,
		roundId: view.roundId.value,
		matchId: view.matchId.value,
		playerId: view.playerId.value,
	};
}

const scopes: EffectScope[] = [];
function follow(view: ReturnType<typeof cardView>) {
	const scope = effectScope();
	scopes.push(scope);
	return scope.run(() => useCardPageLink(view))!;
}

describe('useCardPageLink', () => {
	beforeEach(async () => {
		await useRouter().replace({ query: {} });
	});

	afterEach(() => {
		scopes.splice(0).forEach(scope => scope.stop());
	});

	it.each([
		[
			'a Player\'s deck',
			{ mode: 'player-decklist', playerId: '12' },
			{
				mode: 'player-decklist',
				roundId: null,
				matchId: null,
				playerId: 12,
			},
			true,
		],
		[
			'a Round\'s Match',
			{ mode: 'match-decklist', roundId: '3', matchId: '40' },
			{
				mode: 'match-decklist',
				roundId: 3,
				matchId: 40,
				playerId: null,
			},
			true,
		],
		[
			'a deck mode without a valid id',
			{ mode: 'player-decklist', playerId: 'alice' },
			{
				mode: 'player-decklist',
				roundId: null,
				matchId: null,
				playerId: null,
			},
			true,
		],
		[
			'nothing for an unknown mode',
			{ mode: 'decks', playerId: '12' },
			{
				mode: 'search',
				roundId: null,
				matchId: null,
				playerId: null,
			},
			false,
		],
	])('restores %s on arrival', async (_, query, restored, linked) => {
		await useRouter().replace({ query });
		const view = cardView();

		expect(follow(view).linked).toBe(linked);
		expect(snapshot(view)).toEqual(restored);
	});

	it('keeps the view the store holds when the query names none, and links it', async () => {
		const view = cardView({ mode: 'player-decklist', playerId: 5 });

		expect(follow(view).linked).toBe(false);
		expect(snapshot(view)).toEqual({
			mode: 'player-decklist',
			roundId: null,
			matchId: null,
			playerId: 5,
		});
		await vi.waitFor(() => expect(useRoute().query).toEqual({ mode: 'player-decklist', playerId: '5' }));
	});

	it.each([
		[
			'a Player\'s deck',
			(view: ReturnType<typeof cardView>) => {
				view.mode.value = 'player-decklist';
				view.playerId.value = 8;
			},
			{ tab: 'x', mode: 'player-decklist', playerId: '8' },
		],
		[
			'a Round\'s Match',
			(view: ReturnType<typeof cardView>) => {
				view.mode.value = 'match-decklist';
				view.roundId.value = 2;
				view.matchId.value = 30;
				view.playerId.value = 8;
			},
			{
				tab: 'x',
				mode: 'match-decklist',
				roundId: '2',
				matchId: '30',
			},
		],
		[
			'search, naming no deck',
			(view: ReturnType<typeof cardView>) => {
				view.mode.value = 'search';
				view.roundId.value = 2;
				view.playerId.value = 8;
			},
			{ tab: 'x' },
		],
	])('follows the view to %s, keeping other query keys', async (_, change, query) => {
		await useRouter().replace({
			query: { tab: 'x', mode: 'player-decklist', playerId: '1' },
		});
		const view = cardView();
		follow(view);

		change(view);

		await vi.waitFor(() => expect(useRoute().query).toEqual(query));
	});
});
