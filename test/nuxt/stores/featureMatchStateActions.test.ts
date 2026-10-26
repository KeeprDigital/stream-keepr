import type { FeatureMatchState } from '~~/shared/types/featureMatchState';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '~~/test/helpers/deferred';
import { createMockFeatureMatchState } from '~~/test/helpers/fixtures';
import { transportFailure } from '~~/test/helpers/transportFailure';
import {
	clock,
	commandResult,
	createSourceSnapshot,
	EVENT_ID,
	MATCH_ID,
	seedState as seed,
	SERVER_NOW,
	sessionClient,
} from '~~/test/nuxt/helpers/featureMatchStateHarness';

vi.mock('~/modules/feature-match-session/client', async () => {
	const { sessionClient } = await import('~~/test/nuxt/helpers/featureMatchSessionClientMock');
	return {
		useFeatureMatchSessionClient: () => sessionClient,
	};
});

mockNuxtImport('useServerTime', () => () => ({
	getServerTime: () => SERVER_NOW,
}));
mockNuxtImport('useEventStore', () => () => ({
	event: { featureMatchDefaultClockDuration: 50 },
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

describe('useFeatureMatchStateStore actions', () => {
	let store: ReturnType<typeof useFeatureMatchStateStore>;

	const seedState = (overrides?: Partial<FeatureMatchState>, matchId = MATCH_ID) => seed(store, overrides, matchId);
	const held = (matchId = MATCH_ID) => store.featureMatchStates.get(matchId)!;

	/** Hold the client's answer open, so a test reads the store's prediction. */
	function pending(method: ClientMethod) {
		const answer = deferred<unknown>();
		sessionClient[method].mockReturnValueOnce(answer.promise);
		return answer;
	}

	beforeEach(() => {
		store = useFeatureMatchStateStore();
		store.$reset();
	});

	describe('the clock, while its command is out', () => {
		it.each([
			[
				'startClock',
				'startClock',
				{},
				{ isRunning: true, lastStartedAt: SERVER_NOW },
			],
			[
				'pauseClock',
				'pauseClock',
				{ elapsedMs: 1000, isRunning: true, lastStartedAt: SERVER_NOW - 1000 },
				{ isRunning: false, elapsedMs: 2000 },
			],
			[
				'resetClock',
				'resetClock',
				{ elapsedMs: 50_000, isRunning: true, lastStartedAt: SERVER_NOW - 1000 },
				{ isRunning: false, elapsedMs: 0 },
			],
			[
				'restartClock',
				'restartClock',
				{ elapsedMs: 50_000 },
				{ isRunning: true, elapsedMs: 0 },
			],
		] as const)('%s shows the predicted clock', async (action, method, before, predicted) => {
			seedState({
				clock: clock(before),
			});
			const answer = pending(method);

			const acting = store[action](EVENT_ID, MATCH_ID);

			expect(held().clock).toMatchObject(predicted);

			answer.resolve(commandResult(createMockFeatureMatchState({
				clock: clock(predicted),
			})));
			await acting;
		});

		it('setClock shows a count-up clock reading its target', async () => {
			seedState({
				clock: clock({ type: 'countup', durationMs: 0, elapsedMs: 10_000 }),
			});
			const answer = pending('setClock');

			const setting = store.setClock(EVENT_ID, MATCH_ID, 60_000);

			expect(held().clock.elapsedMs).toBe(60_000);

			answer.resolve(commandResult(createMockFeatureMatchState({
				clock: clock({ type: 'countup', durationMs: 0, elapsedMs: 60_000 }),
			})));
			await setting;
		});

		it('adjustClock extends a countdown\'s duration', () => {
			seedState({
				clock: clock(),
			});

			store.adjustClock(EVENT_ID, MATCH_ID, 60_000);

			expect(held().clock.durationMs).toBe(3_060_000);
		});

		it('a refused command puts the clock back and reports the server\'s sentence', async () => {
			seedState({
				clock: clock(),
			});
			sessionClient.startClock.mockRejectedValue(transportFailure({
				status: 409,
				body: { message: 'The Session has ended' },
			}));

			await store.startClock(EVENT_ID, MATCH_ID);

			expect(held().clock.isRunning).toBe(false);
			expect(store.error).toBe('The Session has ended');
		});
	});

	describe('every clock at once, while the bulk command is out', () => {
		beforeEach(() => {
			seedState({
				clock: clock({ elapsedMs: 1000 }),
				overtime: { active: true, turnsRemaining: 3, totalTurns: 5 },
			}, 100);
			seedState({
				clock: clock({ elapsedMs: 1000, isRunning: true, lastStartedAt: SERVER_NOW - 1000 }),
			}, 200);
		});

		it.each([
			[
				'startAllClocks',
				{
					100: { isRunning: true, lastStartedAt: SERVER_NOW },
					200: { isRunning: true, lastStartedAt: SERVER_NOW - 1000 },
				},
			],
			[
				'pauseAllClocks',
				{
					100: { isRunning: false, elapsedMs: 1000 },
					200: { isRunning: false, elapsedMs: 2000 },
				},
			],
			[
				'resetAllClocks',
				{
					100: { isRunning: false, elapsedMs: 0 },
					200: { isRunning: false, elapsedMs: 0 },
				},
			],
			[
				'restartAllClocks',
				{
					100: { isRunning: true, elapsedMs: 0 },
					200: { isRunning: true, elapsedMs: 0 },
				},
			],
		] as const)('%s predicts each clock, leaving one already in that state alone', async (action, predicted) => {
			const answer = pending('bulkClockAction');

			const acting = store[action](EVENT_ID);

			expect(held(100).clock).toMatchObject(predicted[100]);
			expect(held(200).clock).toMatchObject(predicted[200]);

			answer.resolve({ updates: [] });
			await acting;
		});

		it('a reset of every clock also ends overtime', async () => {
			sessionClient.bulkClockAction.mockResolvedValue({ updates: [] });

			await store.resetAllClocks(EVENT_ID);

			expect(held(100).overtime).toBeUndefined();
		});

		it('adjustAllClocks extends every countdown', () => {
			sessionClient.bulkClockAction.mockResolvedValue({ updates: [] });

			store.adjustAllClocks(EVENT_ID, 60_000);

			expect(held(100).clock.durationMs).toBe(3_060_000);
			expect(held(200).clock.durationMs).toBe(3_060_000);
		});
	});

	describe('player state', () => {
		it.each([
			[
				'a life change',
				(s: ReturnType<typeof useFeatureMatchStateStore>) => s.updatePlayerFeatureMatchState(EVENT_ID, MATCH_ID, 'player1', { lifeDelta: -3 }),
				'player1',
				{ lifeTotal: 17 },
			],
			[
				'a life total',
				(s: ReturnType<typeof useFeatureMatchStateStore>) => s.updatePlayerFeatureMatchState(EVENT_ID, MATCH_ID, 'player1', { lifeTotal: 10 }),
				'player1',
				{ lifeTotal: 10 },
			],
			[
				'counters',
				(s: ReturnType<typeof useFeatureMatchStateStore>) => s.updatePlayerFeatureMatchState(EVENT_ID, MATCH_ID, 'player1', {
					counters: [
						{ type: 'poison', value: 3 },
					],
				}),
				'player1',
				{
					counters: [
						{ type: 'poison', value: 3 },
					],
				},
			],
			[
				'adjustLife',
				(s: ReturnType<typeof useFeatureMatchStateStore>) => s.adjustLife(EVENT_ID, MATCH_ID, 'player2', -5),
				'player2',
				{ lifeTotal: 15 },
			],
			[
				'setLife',
				(s: ReturnType<typeof useFeatureMatchStateStore>) => s.setLife(EVENT_ID, MATCH_ID, 'player1', 40),
				'player1',
				{ lifeTotal: 40 },
			],
		] as const)('%s shows at once', (_, act, player, predicted) => {
			seedState();

			act(store);

			expect(held()[player]).toMatchObject(predicted);
		});

		it('a change for a Slot the store does not hold changes nothing', () => {
			store.updatePlayerFeatureMatchState(EVENT_ID, 999, 'player1', { lifeDelta: -3 });

			expect(store.featureMatchStates.size).toBe(0);
		});

		it('setCardsKept shows the kept count while its write is out', async () => {
			seedState();
			const answer = pending('updatePlayerFeatureMatchState');

			const setting = store.setCardsKept(EVENT_ID, MATCH_ID, 'player1', 6);

			expect(held().player1.cardsKept).toBe(6);

			answer.resolve(commandResult(createMockFeatureMatchState()));
			await setting;
		});

		it('setSideboardRevealed reveals both sideboards in one Match-level write', async () => {
			seedState();
			const answer = pending('updateState');

			const revealing = store.setSideboardRevealed(EVENT_ID, MATCH_ID, true);

			expect(held().player1.sideboardRevealed).toBe(true);
			expect(held().player2.sideboardRevealed).toBe(true);
			expect(sessionClient.updateState).toHaveBeenCalledOnce();
			expect(sessionClient.updateState).toHaveBeenCalledWith(EVENT_ID, MATCH_ID, {
				player1: { sideboardRevealed: true },
				player2: { sideboardRevealed: true },
			});

			answer.resolve(commandResult(createMockFeatureMatchState()));
			await revealing;
		});
	});

	describe('turns, while their write is out', () => {
		it.each([
			[
				'selectFirstPlayer',
				(s: ReturnType<typeof useFeatureMatchStateStore>) => s.selectFirstPlayer(EVENT_ID, MATCH_ID, 'player1'),
				{},
				{ firstPlayer: 'player1', activePlayer: 'player1', turnNumber: 1 },
			],
			[
				'changeFirstPlayer from player1',
				(s: ReturnType<typeof useFeatureMatchStateStore>) => s.changeFirstPlayer(EVENT_ID, MATCH_ID),
				{ firstPlayer: 'player1' },
				{ firstPlayer: 'player2' },
			],
			[
				'changeFirstPlayer from player2',
				(s: ReturnType<typeof useFeatureMatchStateStore>) => s.changeFirstPlayer(EVENT_ID, MATCH_ID),
				{ firstPlayer: 'player2' },
				{ firstPlayer: 'player1' },
			],
			[
				'setActivePlayer',
				(s: ReturnType<typeof useFeatureMatchStateStore>) => s.setActivePlayer(EVENT_ID, MATCH_ID, 'player2'),
				{},
				{ activePlayer: 'player2' },
			],
			[
				'setTurnNumber',
				(s: ReturnType<typeof useFeatureMatchStateStore>) => s.setTurnNumber(EVENT_ID, MATCH_ID, 10),
				{},
				{ turnNumber: 10 },
			],
		] as const)('%s shows the change', async (_, act, before, predicted) => {
			seedState(before as Partial<FeatureMatchState>);
			const answer = pending('updateState');

			const acting = act(store);

			expect(held()).toMatchObject(predicted);

			answer.resolve(commandResult(createMockFeatureMatchState()));
			await acting;
		});

		it.each([
			[
				'hands the turn to the second player',
				{ firstPlayer: 'player1', activePlayer: 'player1', turnNumber: 1 },
				{ activePlayer: 'player2', turnNumber: 1 },
			],
			[
				'starts the next turn once the second player finishes',
				{ firstPlayer: 'player1', activePlayer: 'player2', turnNumber: 1 },
				{ activePlayer: 'player1', turnNumber: 2 },
			],
			[
				'does nothing with no active player',
				{ firstPlayer: 'player1', activePlayer: null, turnNumber: 1 },
				{ turnNumber: 1 },
			],
			[
				'does nothing with no first player',
				{ firstPlayer: null, activePlayer: 'player1', turnNumber: 1 },
				{ turnNumber: 1 },
			],
		] as const)('stepping a turn forward %s', (_, before, after) => {
			seedState(before as Partial<FeatureMatchState>);

			store.stepTurn(EVENT_ID, MATCH_ID, 1);

			expect(held()).toMatchObject(after);
		});
	});

	describe('overtime', () => {
		it('startOvertime shows overtime while its write is out', async () => {
			seedState();
			const answer = pending('startOvertime');

			const starting = store.startOvertime(EVENT_ID, MATCH_ID, 5);

			expect(held().overtime).toEqual({ active: true, turnsRemaining: 5, totalTurns: 5 });

			answer.resolve(commandResult(createMockFeatureMatchState()));
			await starting;
		});

		it.each([
			[
				'next: counts a turn down and passes the turn',
				'nextOvertimeTurn',
				'player1',
				{ active: true, turnsRemaining: 3, totalTurns: 5 },
				'player2',
				{ active: true, turnsRemaining: 2 },
			],
			[
				'next: ends overtime on its last turn',
				'nextOvertimeTurn',
				'player1',
				{ active: true, turnsRemaining: 1, totalTurns: 5 },
				'player2',
				{ active: false, turnsRemaining: 0 },
			],
			[
				'next: does nothing once overtime has ended',
				'nextOvertimeTurn',
				'player1',
				{ active: false, turnsRemaining: 0, totalTurns: 5 },
				'player1',
				{ active: false, turnsRemaining: 0 },
			],
			[
				'prev: counts a turn back and passes the turn back',
				'prevOvertimeTurn',
				'player2',
				{ active: true, turnsRemaining: 2, totalTurns: 5 },
				'player1',
				{ active: true, turnsRemaining: 3 },
			],
			[
				'prev: counts no further back than the total',
				'prevOvertimeTurn',
				'player1',
				{ active: true, turnsRemaining: 5, totalTurns: 5 },
				'player2',
				{ turnsRemaining: 5 },
			],
			[
				'prev: reopens overtime stepped back from its end',
				'prevOvertimeTurn',
				'player1',
				{ active: false, turnsRemaining: 0, totalTurns: 5 },
				'player2',
				{ active: true, turnsRemaining: 1 },
			],
		] as const)('%s', (_, step, activePlayer, overtime, nextActive, nextOvertime) => {
			seedState({ activePlayer, overtime });

			store[step](EVENT_ID, MATCH_ID);

			expect(held().activePlayer).toBe(nextActive);
			expect(held().overtime).toMatchObject(nextOvertime);
		});

		it.each(['nextOvertimeTurn', 'prevOvertimeTurn'] as const)('%s does nothing outside overtime', (step) => {
			seedState({ activePlayer: 'player1' });

			store[step](EVENT_ID, MATCH_ID);

			expect(held().activePlayer).toBe('player1');
		});
	});

	describe('game lifecycle', () => {
		it('recordGameWin sends its options and holds the server\'s state', async () => {
			seedState();
			sessionClient.recordGameWin.mockResolvedValue(commandResult(createMockFeatureMatchState({ currentGame: 2 })));

			await store.recordGameWin(EVENT_ID, MATCH_ID, 'player1', { resetLife: true, startingLife: 40 });

			expect(sessionClient.recordGameWin).toHaveBeenCalledWith(EVENT_ID, MATCH_ID, 'player1', { resetLife: true, startingLife: 40 });
			expect(held().currentGame).toBe(2);
		});

		it('swapPlayers swaps the seats while its write is out, then holds the swapped Session snapshot', async () => {
			seedState({
				player1: {
					lifeTotal: 20,
					gameWins: 1,
					counters: [],
					sideboardRevealed: false,
				},
				player2: {
					lifeTotal: 15,
					gameWins: 0,
					counters: [],
					sideboardRevealed: false,
				},
				activePlayer: 'player1',
				firstPlayer: 'player1',
			});
			const answer = pending('swapPlayers');

			const swapping = store.swapPlayers(EVENT_ID, MATCH_ID);

			expect(held()).toMatchObject({
				player1: { lifeTotal: 15, gameWins: 0 },
				player2: { lifeTotal: 20, gameWins: 1 },
				activePlayer: 'player2',
				firstPlayer: 'player2',
			});

			answer.resolve(commandResult(held(), {
				sourceSnapshot: {
					...createSourceSnapshot(),
					player1: {
						playerId: null,
						data: { name: 'Bob' },
					},
					player2: {
						playerId: null,
						data: { name: 'Alice' },
					},
				} as never,
			}));
			await swapping;

			expect(store.featureMatchSessions.get(500)?.sourceSnapshot.player1.data?.name).toBe('Bob');
		});
	});
});
