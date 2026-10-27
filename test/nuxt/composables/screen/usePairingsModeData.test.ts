import type { EffectScope } from 'vue';
import type { ScreenOutputPairingsResponse, ScreenOutputRoundMatch } from '~~/shared/types/screenOutputReads';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeEventChannel } from '~~/test/helpers/realtime-mock';

const defaultConfig = {
	roundId: undefined as number | undefined,
	showHeader: true,
	headerText: undefined as string | undefined,
	rowsPerPage: 10,
	autoPageEnabled: false,
	autoPageIntervalMs: 10000,
	currentPage: 1,
	rotationAnchor: undefined as number | undefined,
};

const mutableConfig = reactive({ ...defaultConfig });
const mockEventId = ref<number | null>(1);
const mockInteractive = ref(false);
const mockScreenStore = {
	updateModeConfig: vi.fn(),
};
const { mockFetch } = vi.hoisted(() => ({
	mockFetch: vi.fn(),
}));
const realtime = createFakeEventChannel();
const { deliver } = realtime;

mockNuxtImport('$fetch', () => mockFetch);
mockNuxtImport('tryUseRealtime', () => () => realtime.transport);
mockNuxtImport('useScreenStore', () => () => mockScreenStore);
mockNuxtImport('useScreenContext', () => () => ({
	screen: ref({ id: 1, name: 'Test' }),
	eventId: mockEventId,
	interactive: mockInteractive,
}));
mockNuxtImport('useScreenModeConfig', () => () => computed(() => mutableConfig));

function pairing(overrides: Partial<ScreenOutputRoundMatch> = {}): ScreenOutputRoundMatch {
	return {
		matchId: 1,
		tableNumber: 1,
		player1: { id: 7, name: 'Nadia Rivers' },
		player2: { id: 8, name: 'Oskar Lind' },
		isBye: false,
		hasResult: false,
		player1GameWins: null,
		player2GameWins: null,
		gameDraws: null,
		...overrides,
	};
}

const round = {
	id: 31,
	eventId: 1,
	phaseId: 3,
	name: 'Round 4',
	roundNumber: 4,
};

function answer(matches: ScreenOutputRoundMatch[], overrides: Partial<ScreenOutputPairingsResponse['round']> = {}) {
	return {
		round: {
			...round,
			...overrides,
		},
		matches,
	};
}

const scopes: EffectScope[] = [];

function makePairingsModeData() {
	const scope = effectScope();
	const result = scope.run(() => usePairingsModeData())!;
	scopes.push(scope);
	return result;
}

describe('usePairingsModeData', () => {
	beforeEach(() => {
		Object.assign(mutableConfig, defaultConfig);
		mockEventId.value = 1;
		mockInteractive.value = false;
		realtime.reset();
		mockFetch.mockReset();
		mockScreenStore.updateModeConfig.mockReset();
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		scopes.splice(0).forEach(scope => scope.stop());
	});

	it('reads the configured Round\'s pairings through the Screen', async () => {
		mutableConfig.roundId = 31;
		mockFetch.mockResolvedValue(answer([
			pairing(),
		]));

		const { round: held, pageData, isEmpty, error } = makePairingsModeData();
		await flushPromises();

		expect(mockFetch).toHaveBeenCalledWith('/api/screen-output/events/1/screens/1/pairings', expect.anything());
		expect(held.value?.name).toBe('Round 4');
		expect(pageData.value.map(row => row.matchId)).toEqual([1]);
		expect(isEmpty.value).toBe(false);
		expect(error.value).toBeNull();
	});

	it('reads nothing and is empty while no Round is selected', async () => {
		const { isEmpty } = makePairingsModeData();
		await flushPromises();

		expect(mockFetch).not.toHaveBeenCalled();
		expect(isEmpty.value).toBe(true);
	});

	it('is empty while the Round has no Matches yet', async () => {
		mutableConfig.roundId = 31;
		mockFetch.mockResolvedValue(answer([]));

		const { isEmpty } = makePairingsModeData();
		await flushPromises();

		expect(isEmpty.value).toBe(true);
	});

	it('stays empty while a re-read of an empty Round is in flight', async () => {
		mutableConfig.roundId = 31;
		mockFetch.mockResolvedValue(answer([]));
		const { isEmpty } = makePairingsModeData();
		await flushPromises();

		let release!: () => void;
		mockFetch.mockImplementationOnce(() => new Promise((resolve) => {
			release = () => resolve(answer([]));
		}));
		deliver('melee:pairingsSynced', { roundId: 31 });
		await flushPromises();
		expect(mockFetch).toHaveBeenCalledTimes(2);
		expect(isEmpty.value).toBe(true);

		release();
		await flushPromises();
		expect(isEmpty.value).toBe(true);
	});

	it('re-reads when the selected Round changes', async () => {
		mutableConfig.roundId = 31;
		mockFetch.mockResolvedValue(answer([
			pairing(),
		]));
		makePairingsModeData();
		await flushPromises();

		mutableConfig.roundId = 32;
		await flushPromises();

		expect(mockFetch).toHaveBeenCalledTimes(2);
	});

	describe('headerText', () => {
		it('prefers the configured header', async () => {
			mutableConfig.roundId = 31;
			mutableConfig.headerText = 'Top Tables';
			mockFetch.mockResolvedValue(answer([
				pairing(),
			]));

			const { headerText } = makePairingsModeData();
			await flushPromises();

			expect(headerText.value).toBe('Top Tables');
		});

		it('names the loaded Round when no header is configured', async () => {
			mutableConfig.roundId = 31;
			mockFetch.mockResolvedValue(answer([
				pairing(),
			]));

			const { headerText } = makePairingsModeData();
			await flushPromises();

			expect(headerText.value).toBe('Round 4 Pairings');
		});

		it('falls back to a generic header before a Round loads', () => {
			expect(makePairingsModeData().headerText.value).toBe('Pairings');
		});
	});

	describe('formatResult', () => {
		it.each([
			[
				'bye',
				pairing({
					isBye: true,
					player2: null,
					hasResult: true,
					player1GameWins: 2,
					player2GameWins: 0,
				}),
				'BYE',
			],
			[
				'pending Match',
				pairing(),
				'Pending',
			],
			[
				'reported Match',
				pairing({
					hasResult: true,
					player1GameWins: 2,
					player2GameWins: 1,
					gameDraws: 0,
				}),
				'2-1',
			],
			[
				'reported Match with game draws',
				pairing({
					hasResult: true,
					player1GameWins: 1,
					player2GameWins: 1,
					gameDraws: 1,
				}),
				'1-1-1',
			],
		])('formats a %s', (_name, row, expected) => {
			expect(makePairingsModeData().formatResult(row)).toBe(expected);
		});
	});

	describe('winner', () => {
		it.each([
			[
				'the first Player',
				pairing({ hasResult: true, player1GameWins: 2, player2GameWins: 1 }),
				1,
			],
			[
				'the second Player',
				pairing({ hasResult: true, player1GameWins: 0, player2GameWins: 2 }),
				2,
			],
			[
				'nobody on a draw',
				pairing({ hasResult: true, player1GameWins: 1, player2GameWins: 1 }),
				null,
			],
			[
				'nobody while pending',
				pairing(),
				null,
			],
			[
				'the Player with the bye',
				pairing({ isBye: true, player2: null }),
				1,
			],
			[
				'the Player with the bye, seated second',
				pairing({ isBye: true, player1: null }),
				2,
			],
		])('is %s', (_name, row, expected) => {
			expect(makePairingsModeData().winner(row)).toBe(expected);
		});
	});

	it('pages pairings by the configured page size and current page', async () => {
		mutableConfig.roundId = 31;
		mutableConfig.rowsPerPage = 2;
		mutableConfig.currentPage = 2;
		mockFetch.mockResolvedValue(answer([
			pairing({ matchId: 1, tableNumber: 1 }),
			pairing({ matchId: 2, tableNumber: 2 }),
			pairing({ matchId: 3, tableNumber: 3 }),
		]));

		const { pageData } = makePairingsModeData();
		await flushPromises();

		expect(pageData.value.map(row => row.tableNumber)).toEqual([3]);
	});

	it('never writes mode config from a rendering, even with auto-page on', async () => {
		mutableConfig.roundId = 31;
		mutableConfig.autoPageEnabled = true;
		mockInteractive.value = true;
		mockFetch.mockResolvedValue(answer([
			pairing({ matchId: 1 }),
			pairing({ matchId: 2 }),
		]));

		makePairingsModeData();
		await flushPromises();

		expect(mockScreenStore.updateModeConfig).not.toHaveBeenCalled();
	});

	describe('freshness', () => {
		// The Event, the selected Round and the Screen configuration are held
		// constant throughout: only Event Data changes under the output.
		const reported = pairing({ hasResult: true, player1GameWins: 2, player2GameWins: 0 });

		async function showingPendingPairings() {
			mutableConfig.roundId = 31;
			mockFetch.mockResolvedValue(answer([
				pairing(),
			]));
			const data = makePairingsModeData();
			await flushPromises();
			expect(data.formatResult(data.pageData.value[0]!)).toBe('Pending');
			mockFetch.mockClear();
			return data;
		}

		function match(overrides: Record<string, unknown> = {}) {
			return {
				id: 1,
				roundId: 31,
				player1Id: 7,
				player2Id: 8,
				...overrides,
			};
		}

		it('shows a Match result as it is reported, without reload', async () => {
			const { pageData, formatResult } = await showingPendingPairings();
			mockFetch.mockResolvedValue(answer([reported]));

			deliver('match:updated', {
				match: match({ hasResult: true }),
			});
			await flushPromises();

			expect(mockFetch).toHaveBeenCalledTimes(1);
			expect(formatResult(pageData.value[0]!)).toBe('2-0');
		});

		it('picks up a Match paired into the Round, or moved out of it', async () => {
			await showingPendingPairings();

			deliver('match:created', {
				match: match({ id: 5 }),
			});
			await flushPromises();
			deliver('match:updated', {
				match: match({ roundId: 32 }),
			});
			await flushPromises();
			deliver('match:deleted', { matchId: 1 });
			await flushPromises();

			expect(mockFetch).toHaveBeenCalledTimes(3);
		});

		it('ignores Matches of other Rounds', async () => {
			await showingPendingPairings();

			deliver('match:created', {
				match: match({ id: 9, roundId: 32 }),
			});
			deliver('match:updated', {
				match: match({ id: 9, roundId: 32 }),
			});
			deliver('match:deleted', { matchId: 9 });
			await flushPromises();

			expect(mockFetch).not.toHaveBeenCalled();
		});

		it('follows its own Round being renamed or re-paired, and no other', async () => {
			await showingPendingPairings();

			deliver('round:updated', {
				round: { id: 40 },
			});
			deliver('round:deleted', { roundId: 40 });
			deliver('round:matchesRefreshed', {
				roundId: 40,
				matchCount: 8,
				created: 1,
				updated: 0,
				staleDeleted: 0,
			});
			await flushPromises();
			expect(mockFetch).not.toHaveBeenCalled();

			deliver('round:updated', {
				round: { id: 31 },
			});
			await flushPromises();
			deliver('round:matchesRefreshed', {
				roundId: 31,
				matchCount: 8,
				created: 1,
				updated: 0,
				staleDeleted: 0,
			});
			await flushPromises();
			expect(mockFetch).toHaveBeenCalledTimes(2);
		});

		// Melee Sync fills in Match Results as they are reported; Round Standings
		// are not on the Screen.
		it.each([
			{
				type: 'melee:matchResultsSynced',
				payload: {
					roundId: 31,
					matchIds: [1],
				},
				rereads: true,
			},
			{
				type: 'melee:matchResultsSynced',
				payload: {
					roundId: 40,
					matchIds: [9],
				},
				rereads: false,
			},
			{
				type: 'melee:pairingsSynced',
				payload: { roundId: 31 },
				rereads: true,
			},
			{
				type: 'melee:pairingsSynced',
				payload: { roundId: 40 },
				rereads: false,
			},
			{
				type: 'melee:roundStandingsSynced',
				payload: { roundId: 31 },
				rereads: false,
			},
		])('$type for Round $payload.roundId re-reads: $rereads', async ({ type, payload, rereads }) => {
			const { pageData, formatResult } = await showingPendingPairings();
			mockFetch.mockResolvedValue(answer([reported]));

			deliver(type, payload);
			await flushPromises();

			expect(mockFetch).toHaveBeenCalledTimes(rereads ? 1 : 0);
			expect(formatResult(pageData.value[0]!)).toBe(rereads ? '2-0' : 'Pending');
		});

		it('follows a rename of a Player it shows, and of no one else', async () => {
			await showingPendingPairings();

			deliver('player:updated', {
				player: { id: 5 },
			});
			await flushPromises();
			expect(mockFetch).not.toHaveBeenCalled();

			deliver('player:updated', {
				player: { id: 8 },
			});
			await flushPromises();
			deliver('player:deleted', { playerId: 7 });
			await flushPromises();
			expect(mockFetch).toHaveBeenCalledTimes(2);
		});

		it('shows a result missed while disconnected once its channel is attached again', async () => {
			const { pageData, formatResult } = await showingPendingPairings();

			realtime.transport.connectionState = 'disconnected';
			await nextTick();
			mockFetch.mockResolvedValue(answer([reported]));
			realtime.transport.connectionState = 'connected';
			realtime.reattach();
			await flushPromises();

			expect(mockFetch).toHaveBeenCalledTimes(1);
			expect(formatResult(pageData.value[0]!)).toBe('2-0');
		});
	});
});
