import type { FeatureMatchState } from '~~/shared/types/featureMatchState';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialFeatureMatchSessionStateFromSnapshot } from '~~/shared/modules/feature-match-session';
import { commanderSnapshot } from '~~/test/helpers/commanderSession';
import { deferred } from '~~/test/helpers/deferred';
import {
	commandResult,
	createSession,
	EVENT_ID,
	MATCH_ID,
	SERVER_NOW,
	sessionClient,
} from '~~/test/nuxt/helpers/featureMatchStateHarness';

/*
 * A Commander Session in the Feature Match State store (ADR-0087): each action
 * shows its prediction while its command is out, by the reducer's own rules.
 */

vi.mock('~/modules/feature-match-session/client', async () => {
	const { sessionClient } = await import('~~/test/nuxt/helpers/featureMatchSessionClientMock');
	return {
		useFeatureMatchSessionClient: () => sessionClient,
	};
});

mockNuxtImport('useServerTime', () => () => ({
	getServerTime: () => SERVER_NOW,
}));

// Batched writes flush at once, so a test sees each write as soon as it is made.
vi.mock('@vueuse/core', async () => {
	const actual = await vi.importActual<typeof import('@vueuse/core')>('@vueuse/core');
	return {
		...actual,
		useDebounceFn: (fn: (...args: any[]) => any) => fn,
	};
});

type ClientMethod = keyof typeof sessionClient;

describe('a Commander Session in the Feature Match State store', () => {
	let store: ReturnType<typeof useFeatureMatchStateStore>;
	const snapshot = commanderSnapshot({ player4: null });
	const held = () => store.featureMatchStates.get(MATCH_ID)!;

	/** Hold the Session as a load would, with `overrides` on its opening state. */
	function hold(overrides: Partial<FeatureMatchState> = {}) {
		const state = {
			...createInitialFeatureMatchSessionStateFromSnapshot(snapshot),
			...overrides,
		};
		store.cacheSession(createSession(state, { sourceSnapshot: snapshot }));
		return state;
	}

	/** Hold the client's answer open, so a test reads the store's prediction. */
	function pending(method: ClientMethod) {
		const answer = deferred<unknown>();
		sessionClient[method].mockReturnValueOnce(answer.promise);
		return answer;
	}

	const answered = (state: FeatureMatchState) => commandResult(state, { sourceSnapshot: snapshot, sequence: 4 });

	beforeEach(() => {
		vi.clearAllMocks();
		store = useFeatureMatchStateStore();
		store.$reset();
	});

	it('shows Commander Damage and the life it cost while its command is out, then the Session\'s answer', async () => {
		const opened = hold();
		const answer = pending('adjustCommanderDamage');

		store.adjustCommanderDamage(EVENT_ID, MATCH_ID, 'player2', 'player1', 1, 5);

		expect(held().player2).toMatchObject({
			lifeTotal: 35,
			commanderDamage: [
				{ seat: 'player1', commander: 1, damage: 5 },
			],
		});
		expect(sessionClient.adjustCommanderDamage).toHaveBeenCalledWith(EVENT_ID, MATCH_ID, 'player2', 'player1', 1, 5);

		answer.resolve(answered({
			...opened,
			player2: {
				...opened.player2,
				lifeTotal: 34,
				commanderDamage: [
					{ seat: 'player1', commander: 1, damage: 6 },
				],
			},
		}));
		await vi.waitFor(() => expect(held().player2.lifeTotal).toBe(34));
	});

	it('puts Commander Damage back when its command is refused', async () => {
		hold();
		const answer = pending('adjustCommanderDamage');

		store.adjustCommanderDamage(EVENT_ID, MATCH_ID, 'player2', 'player1', 1, 5);
		answer.reject(new Error('refused'));

		await vi.waitFor(() => expect(held().player2).toMatchObject({ lifeTotal: 40, commanderDamage: [] }));
	});

	it('shows a Seat Eliminated while its command is out', () => {
		hold();
		pending('setEliminated');

		void store.setEliminated(EVENT_ID, MATCH_ID, 'player3', true);

		expect(held().player3?.eliminated).toBe(true);
		expect(sessionClient.setEliminated).toHaveBeenCalledWith(EVENT_ID, MATCH_ID, 'player3', true);
	});

	it('shows the declared outcome while its command is out, and the game reopened when it is taken back', async () => {
		const opened = hold();
		pending('setOutcome');

		void store.setOutcome(EVENT_ID, MATCH_ID, { winner: 'player2' });

		expect(held()).toMatchObject({
			isComplete: true,
			outcome: { winner: 'player2' },
		});

		store.$reset();
		hold({
			isComplete: true,
			outcome: { winner: null },
		});
		sessionClient.setOutcome.mockResolvedValueOnce(answered(opened));

		await store.setOutcome(EVENT_ID, MATCH_ID, null);

		expect(held().isComplete).toBe(false);
		expect(held().outcome).toBeUndefined();
	});

	it('steps the turn in Seat order, over the empty Seat, while its command is out', () => {
		hold({ firstPlayer: 'player3', activePlayer: 'player3', turnNumber: 1 });
		pending('stepTurn');

		store.stepTurn(EVENT_ID, MATCH_ID, 1);

		expect([held().activePlayer, held().turnNumber]).toEqual(['player1', 1]);
	});
});
