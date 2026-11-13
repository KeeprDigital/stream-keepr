import type { FeatureMatchState } from '~~/shared/types/featureMatchState';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialFeatureMatchSessionStateFromSnapshot } from '~~/shared/modules/feature-match-session';
import { commanderSnapshot } from '~~/test/helpers/featureMatchSnapshots';
import {
	commandResult,
	createSession,
	EVENT_ID,
	MATCH_ID,
	SERVER_NOW,
	sessionClient,
} from '~~/test/nuxt/helpers/featureMatchStateHarness';

/*
 * Commander Damage in a Seat's batch (ADR-0087), on the real debounce: the taps
 * of one window are one command per opposing Commander, after the Seat's life.
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

/** Ana's one Commander, as the Commander Damage it deals is counted. */
const ATRAXA = { seat: 'player1', commander: 1 } as const;

describe('commander Damage in a Seat\'s batch', () => {
	let store: ReturnType<typeof useFeatureMatchStateStore>;
	// Ana (Atraxa), Ben (Tymna), Cleo (Tymna and Kraum), Dara (Atraxa).
	const snapshot = commanderSnapshot();
	let opened: FeatureMatchState;

	const held = () => store.featureMatchStates.get(MATCH_ID)!;
	const sent = (method: 'adjustCommanderDamage' | 'updatePlayerFeatureMatchState') =>
		sessionClient[method].mock.calls.map(call => call.slice(2));

	/** Lets the window close and every command of its flush answer. */
	async function flush() {
		await vi.advanceTimersByTimeAsync(400);
	}

	beforeEach(() => {
		vi.useFakeTimers();
		vi.clearAllMocks();
		store = useFeatureMatchStateStore();
		store.$reset();
		opened = createInitialFeatureMatchSessionStateFromSnapshot(snapshot);
		store.cacheSession(createSession(opened, { sourceSnapshot: snapshot }));
		// The Session answers each command with the state the store predicted.
		const answer = async () => commandResult(held(), { sourceSnapshot: snapshot, sequence: 9 });
		sessionClient.adjustCommanderDamage.mockImplementation(answer);
		sessionClient.updatePlayerFeatureMatchState.mockImplementation(answer);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('sends one command per opposing Commander for the taps of one window', async () => {
		const tymna = { seat: 'player3', commander: 1 } as const;
		const kraum = { seat: 'player3', commander: 2 } as const;

		store.adjustCommanderDamage(EVENT_ID, MATCH_ID, 'player1', tymna, 1);
		store.adjustLife(EVENT_ID, MATCH_ID, 'player1', -2);
		store.adjustCommanderDamage(EVENT_ID, MATCH_ID, 'player1', kraum, 1);
		store.adjustCommanderDamage(EVENT_ID, MATCH_ID, 'player1', tymna, 1);

		expect(held().player1.lifeTotal).toBe(35);
		expect(sent('adjustCommanderDamage')).toEqual([]);
		await flush();

		expect(sent('adjustCommanderDamage')).toEqual([
			[
				'player1',
				expect.objectContaining(tymna),
				2,
			],
			[
				'player1',
				expect.objectContaining(kraum),
				1,
			],
		]);
		expect(sent('updatePlayerFeatureMatchState')).toEqual([
			[
				'player1',
				{ lifeDelta: -2 },
			],
		]);
	});

	// A life typed in is what the operator saw: the damage goes first, then the life they left it at.
	it.each([
		{
			order: 'Commander Damage, then life set',
			act: () => {
				store.adjustCommanderDamage(EVENT_ID, MATCH_ID, 'player2', ATRAXA, 5);
				store.setLife(EVENT_ID, MATCH_ID, 'player2', 30);
			},
			life: 30,
		},
		{
			order: 'life set, then Commander Damage and a life lost',
			act: () => {
				store.setLife(EVENT_ID, MATCH_ID, 'player2', 30);
				store.adjustCommanderDamage(EVENT_ID, MATCH_ID, 'player2', ATRAXA, 5);
				store.adjustLife(EVENT_ID, MATCH_ID, 'player2', -1);
			},
			life: 24,
		},
	])('leaves a Seat at the life shown after $order in one window', async ({ act, life }) => {
		act();
		expect(held().player2.lifeTotal).toBe(life);
		await flush();

		expect(sent('updatePlayerFeatureMatchState')).toEqual([
			[
				'player2',
				{ lifeTotal: life },
			],
		]);
		expect(sessionClient.adjustCommanderDamage.mock.invocationCallOrder[0])
			.toBeLessThan(sessionClient.updatePlayerFeatureMatchState.mock.invocationCallOrder[0]!);
	});

	it('sends nothing for Commander Damage entered and taken back within one window', async () => {
		const atraxa = ATRAXA;

		store.adjustCommanderDamage(EVENT_ID, MATCH_ID, 'player2', atraxa, 1);
		store.adjustCommanderDamage(EVENT_ID, MATCH_ID, 'player2', atraxa, -1);
		await flush();

		expect(sent('adjustCommanderDamage')).toEqual([]);
		expect(sent('updatePlayerFeatureMatchState')).toEqual([]);
		expect(held().player2).toEqual(opened.player2);
		expect(store.error).toBeNull();
	});
});
