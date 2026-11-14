import type { EffectScope } from 'vue';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '~~/test/helpers/deferred';
import { createMockEvent, createMockPlayer, createMockRound } from '~~/test/helpers/fixtures';
import { createFakeEventChannel } from '~~/test/helpers/realtime-mock';
import { screenContextOf } from '~~/test/nuxt/helpers/screenContext';

const defaultConfig = {
	viewMode: 'all' as string,
	columns: [
		{ key: 'position', visible: true },
		{ key: 'name', visible: true },
		{ key: 'record', visible: true },
		{ key: 'points', visible: true },
		{ key: 'deck', visible: false },
	],
	showArchetypeColors: false,
	roundId: undefined as number | undefined,
	rowsPerPage: 10,
	currentPage: 1,
	autoPageEnabled: false,
	autoPageIntervalMs: 5000,
	rotationAnchor: undefined as number | undefined,
	headerText: '',
	rangeStart: 1,
	rangeEnd: 16,
	revealCount: 8,
	revealedCount: 0,
	revealOrder: 'bottomUp' as string,
	playerListId: null as number | null,
};

const mutableConfig = reactive({ ...defaultConfig });

/** Ten Players in position order: name, wins, losses, draws, points. */
const players = ([
	['Alice', 5, 1, 0, 15],
	['Bob', 4, 2, 0, 12],
	['Charlie', 3, 3, 0, 9],
	['Diana', 3, 3, 1, 10],
	['Ethan', 2, 4, 0, 6],
	['Fiona', 1, 5, 0, 3],
	['George', 1, 5, 1, 4],
	['Helen', 0, 6, 0, 0],
	['Ivan', 0, 6, 0, 0],
	['Jane', 0, 6, 0, 0],
] as const).map(([name, wins, losses, draws, points], index) =>
	createMockPlayer({
		id: index + 1,
		name,
		position: index + 1,
		wins,
		losses,
		draws,
		points,
	}));

function standing(playerId: number, position: number, wins: number, losses: number, points: number) {
	return {
		playerId,
		position,
		wins,
		losses,
		draws: 0,
		points,
	};
}

/** The roster the server holds; the Standings read answers it. */
let serverPlayers = [...players];

/** An operator's loaded, stale Player store: a rendering must never read its roster (#603). */
const mockPlayerStore = reactive({
	players: [
		createMockPlayer({ id: 99, name: 'Stale Store Player', position: 1 }),
	],
	isLoaded: true,
	loadPlayersFrom: vi.fn(),
});
const mockScreenStore = {
	updateModeConfig: vi.fn(),
};
const mockEventStore = reactive({
	displayEvent: createMockEvent(),
});
const mockEventId = ref<number | null>(1);
const mockInteractive = ref(false);
const mockIsSynced = ref(true);
let mockServerNow = 1_000_000;
const { mockFetch } = vi.hoisted(() => ({
	mockFetch: vi.fn(),
}));
const realtime = createFakeEventChannel();
const { deliver } = realtime;

mockNuxtImport('$fetch', () => mockFetch);
mockNuxtImport('tryUseRealtime', () => () => realtime.transport);
mockNuxtImport('usePlayerStore', () => () => mockPlayerStore);
mockNuxtImport('useScreenStore', () => () => mockScreenStore);
mockNuxtImport('useEventStore', () => () => mockEventStore);
const screenContext = screenContextOf({
	screen: ref({ id: 1, name: 'Test' }),
	eventId: mockEventId,
	interactive: mockInteractive,
});
mockNuxtImport('useScreenModeConfig', () => () => computed(() => mutableConfig));
// Server time is the Page Rotation's clock.
mockNuxtImport('useServerTime', async () => (await import('~~/test/nuxt/helpers/serverTime')).fakeServerTime(() => ({
	isSynced: mockIsSynced,
	getServerTime: () => mockServerNow,
})));

/** The Standings Screen Output read's answer; by default, the roster as it stands. */
function standingsRead(overrides: Record<string, unknown> = {}) {
	return {
		players: [...serverPlayers],
		round: null,
		roundStandings: null,
		watchlist: null,
		previousRoundPositions: null,
		...overrides,
	};
}

function answerReads(overrides: Record<string, unknown>) {
	mockFetch.mockImplementation(async () => standingsRead(overrides));
}

const STANDINGS_READ = '/api/screen-output/events/1/screens/1/standings';

const scopes: EffectScope[] = [];

/** A rendering of Standings, its first read answered. */
async function mountStandings() {
	const scope = effectScope();
	scopes.push(scope);
	const result = scope.run(() => useStandingsModeData(screenContext))!;
	await flushPromises();
	return result;
}

const names = (rows: { name: string }[]) => rows.map(row => row.name);

describe('useStandingsModeData', () => {
	beforeEach(() => {
		Object.assign(mutableConfig, defaultConfig);
		serverPlayers = [...players];
		realtime.reset();
		mockEventStore.displayEvent = createMockEvent();
		mockEventId.value = 1;
		mockInteractive.value = false;
		mockIsSynced.value = true;
		mockServerNow = 1_000_000;
		mockFetch.mockReset();
		mockFetch.mockImplementation(async () => standingsRead());
	});

	afterEach(() => {
		scopes.splice(0).forEach(scope => scope.stop());
		vi.useRealTimers();
	});

	describe('reading', () => {
		it('reads everything Standings renders from in one Screen Output read', async () => {
			await mountStandings();

			expect(mockFetch).toHaveBeenCalledOnce();
			expect(mockFetch).toHaveBeenCalledWith(STANDINGS_READ, expect.anything());
		});

		it('re-reads when the selected Round changes', async () => {
			await mountStandings();

			mutableConfig.roundId = 3;
			await flushPromises();

			expect(mockFetch).toHaveBeenCalledTimes(2);
		});

		it('does not read without an Event', async () => {
			mockEventId.value = null;
			await mountStandings();

			expect(mockFetch).not.toHaveBeenCalled();
		});

		it('renders the roster the Standings read answers, never the Player store\'s', async () => {
			serverPlayers = [
				createMockPlayer({ id: 21, name: 'Read Player', position: 1 }),
			];

			const { displayRows } = await mountStandings();

			expect(mockPlayerStore.loadPlayersFrom).not.toHaveBeenCalled();
			expect(names(displayRows.value)).toEqual(['Read Player']);
		});
	});

	describe('displayRows', () => {
		it.each([
			[
				'all',
				{},
				[
					'Alice',
					'Bob',
					'Charlie',
					'Diana',
					'Ethan',
					'Fiona',
					'George',
					'Helen',
					'Ivan',
					'Jane',
				],
			],
			[
				'a range from the top',
				{ viewMode: 'range', rangeStart: 1, rangeEnd: 3 },
				['Alice', 'Bob', 'Charlie'],
			],
			[
				'a range further down',
				{ viewMode: 'range', rangeStart: 3, rangeEnd: 5 },
				['Charlie', 'Diana', 'Ethan'],
			],
			[
				'reveal bottom-up',
				{
					viewMode: 'reveal',
					revealCount: 8,
					revealedCount: 3,
					revealOrder: 'bottomUp',
				},
				['Fiona', 'George', 'Helen'],
			],
			[
				'reveal top-down',
				{
					viewMode: 'reveal',
					revealCount: 8,
					revealedCount: 3,
					revealOrder: 'topDown',
				},
				['Alice', 'Bob', 'Charlie'],
			],
			[
				'reveal before anything is revealed',
				{ viewMode: 'reveal', revealedCount: 0 },
				[],
			],
		] as const)('shows the %s view', async (viewMode, view, expected) => {
			Object.assign(mutableConfig, { viewMode, ...view });

			const { displayRows } = await mountStandings();

			expect(names(displayRows.value)).toEqual(expected);
		});

		it('orders tied and unplaced Players by id, whatever order the read answers them in', async () => {
			serverPlayers = [
				createMockPlayer({ id: 9, name: 'Ivy', position: null }),
				createMockPlayer({ id: 4, name: 'Dee', position: 2 }),
				createMockPlayer({ id: 7, name: 'Gus', position: null }),
				createMockPlayer({ id: 5, name: 'Eve', position: 2 }),
			];
			const { displayRows } = await mountStandings();

			expect(displayRows.value.map(row => row.id)).toEqual([4, 5, 7, 9]);
		});

		// An unplaced Player counts from its place in the order, after every placed one.
		it.each([
			{
				name: 'before any Player is placed, a range from the top shows the first rows',
				placed: 0,
				range: [1, 3],
				shown: ['Alice', 'Bob', 'Charlie'],
			},
			{
				name: 'an unplaced Player follows the placed ones',
				placed: 2,
				range: [2, 3],
				shown: ['Bob', 'Charlie'],
			},
			{
				name: 'an unplaced Player past the range end is left out',
				placed: 2,
				range: [1, 2],
				shown: ['Alice', 'Bob'],
			},
		])('$name', async ({ placed, range, shown }) => {
			Object.assign(mutableConfig, { viewMode: 'range', rangeStart: range[0], rangeEnd: range[1] });
			serverPlayers = players.slice(0, 4).map((player, index) => index < placed
				? player
				: { ...player, position: null });

			const { displayRows } = await mountStandings();

			expect(names(displayRows.value)).toEqual(shown);
		});

		// A range names positions, not a row count: Players sharing its last position all show.
		it('shows every Player tied at the last position of a range', async () => {
			Object.assign(mutableConfig, { viewMode: 'range', rangeStart: 1, rangeEnd: 2 });
			serverPlayers = players.slice(0, 4).map((player, index) => ({
				...player,
				position: Math.min(index + 1, 2),
			}));

			const { displayRows } = await mountStandings();

			expect(names(displayRows.value)).toEqual(['Alice', 'Bob', 'Charlie', 'Diana']);
		});

		it('filters to the watchlist members the read answers', async () => {
			Object.assign(mutableConfig, { viewMode: 'watchlist', playerListId: 42 });
			answerReads({
				watchlist: {
					name: 'VIPs',
					playerIds: [2, 4],
				},
			});

			const { displayRows } = await mountStandings();

			expect(names(displayRows.value)).toEqual(['Bob', 'Diana']);
		});

		it('shows the selected Round\'s snapshot standings', async () => {
			mutableConfig.roundId = 7;
			answerReads({
				round: createMockRound({ id: 7, name: 'Round 7' }),
				roundStandings: [
					standing(3, 1, 5, 0, 15),
					standing(1, 2, 4, 1, 12),
				],
			});

			const { displayRows } = await mountStandings();

			expect(names(displayRows.value)).toEqual(['Charlie', 'Alice']);
			expect(displayRows.value[0]).toMatchObject({ wins: 5, position: 1 });
		});
	});

	describe('headerText', () => {
		it.each([
			[
				'the custom header when one is set',
				{ headerText: 'Custom Header' },
				{},
				'Custom Header',
			],
			[
				'"Standings" for all',
				{ viewMode: 'all' },
				{},
				'Standings',
			],
			[
				'the count for a range from the top',
				{ viewMode: 'range', rangeStart: 1, rangeEnd: 16 },
				{},
				'Top 16 Standings',
			],
			[
				'both ends for a range further down',
				{ viewMode: 'range', rangeStart: 9, rangeEnd: 16 },
				{},
				'Standings (9-16)',
			],
			[
				'the list\'s name for a watchlist',
				{ viewMode: 'watchlist', playerListId: 42 },
				{
					watchlist: { name: 'VIPs', playerIds: [] },
				},
				'VIPs',
			],
			[
				'a fallback for a watchlist the read does not answer',
				{ viewMode: 'watchlist', playerListId: 999 },
				{},
				'Players to Watch',
			],
			[
				'the count for a reveal',
				{ viewMode: 'reveal', revealCount: 8 },
				{},
				'Top 8',
			],
			[
				'the selected Round',
				{ roundId: 4 },
				{
					round: createMockRound({ id: 4, name: 'Round 4' }),
					roundStandings: [
						standing(1, 1, 5, 0, 15),
					],
				},
				'End of Round 4',
			],
		])('reads %s', async (_, config, read, expected) => {
			Object.assign(mutableConfig, config);
			answerReads(read);

			const { headerText } = await mountStandings();

			expect(headerText.value).toBe(expected);
		});
	});

	it('shows only the visible columns, in order', async () => {
		mutableConfig.columns = [
			{ key: 'position', visible: true },
			{ key: 'name', visible: true },
			{ key: 'record', visible: false },
			{ key: 'points', visible: false },
			{ key: 'deck', visible: true },
		];

		const { visibleColumns } = await mountStandings();

		expect(visibleColumns.value.map(column => column.key)).toEqual(['position', 'name', 'deck']);
	});

	describe('formatCell', () => {
		const deckPlayer = createMockPlayer({
			gameData: { type: 'mtg', deckName: 'Mono Red', deckColors: 'R' },
		});

		it.each([
			['position', players[0], '1'],
			[
				'position',
				createMockPlayer({ position: null }),
				'-',
			],
			['name', players[1], 'Bob'],
			['record', players[3], '3-3-1'],
			['points', players[0], '15'],
			[
				'points',
				createMockPlayer({ points: null }),
				'-',
			],
			['deck', deckPlayer, 'Mono Red'],
			['deck', players[0], '-'],
		] as const)('formats %s as %j', async (column, player, expected) => {
			const { formatCell } = await mountStandings();

			expect(formatCell(player as any, column)).toBe(expected);
		});

		it('formats a record with the Event\'s record settings', async () => {
			mockEventStore.displayEvent = createMockEvent({ displayRecordSeparator: '/', displayHideZeroDraws: false });

			const { formatCell } = await mountStandings();

			expect(formatCell(players[0] as any, 'record')).toBe('5/1/0');
		});
	});

	describe('the empty state', () => {
		it('stays empty while an empty answer is re-read', async () => {
			serverPlayers = [];
			const { isEmpty, loading } = await mountStandings();

			loading.value = true;
			expect(isEmpty.value).toBe(true);
		});

		it('is not empty while the selected Round\'s snapshot is still being read', async () => {
			mutableConfig.roundId = 8;
			mockFetch.mockReturnValue(new Promise(() => {}));

			const { isEmpty } = await mountStandings();

			expect(isEmpty.value).toBe(false);
		});

		it.each([
			[
				'a watchlist with no list',
				{ viewMode: 'watchlist', playerListId: null },
				{},
				'Select a player list in settings',
			],
			[
				'an empty watchlist',
				{ viewMode: 'watchlist', playerListId: 42 },
				{},
				'No players in this list',
			],
			[
				'a reveal before anything is revealed',
				{ viewMode: 'reveal', revealedCount: 0 },
				{},
				'Waiting for reveal...',
			],
			[
				'a Round with no snapshot',
				{ roundId: 8 },
				{ roundStandings: [] },
				'No standings snapshot available for this round',
			],
			[
				'no standings at all',
				{ viewMode: 'all' },
				{ players: [] },
				'No standings data available',
			],
		])('explains %s', async (_, config, read, expected) => {
			Object.assign(mutableConfig, config);
			answerReads(read);

			const { emptyMessage } = await mountStandings();

			expect(emptyMessage.value).toBe(expected);
		});
	});

	describe('pages', () => {
		it('writes an operator\'s page selection to the Screen', async () => {
			mockInteractive.value = true;
			mutableConfig.rowsPerPage = 3;
			const { nextPage, prevPage } = await mountStandings();

			nextPage();
			prevPage();

			expect(mockScreenStore.updateModeConfig.mock.calls.map(([, , mode, patch]) => [mode, patch])).toEqual([
				[
					'standings',
					{ currentPage: 2 },
				],
				[
					'standings',
					{ currentPage: 4 },
				],
			]);
		});

		it('pages its rows by the configured page size', async () => {
			Object.assign(mutableConfig, { rowsPerPage: 3, currentPage: 2 });

			const { totalPages, pageData } = await mountStandings();

			expect(totalPages.value).toBe(4);
			expect(names(pageData.value)).toEqual(['Diana', 'Ethan', 'Fiona']);
		});
	});

	describe('freshness', () => {
		it('follows a Player edit made elsewhere', async () => {
			const { displayRows } = await mountStandings();
			mockFetch.mockClear();

			serverPlayers = serverPlayers.map(p => p.id === 2
				? { ...p, wins: 5, points: 15 }
				: p);
			deliver('player:updated', { player: serverPlayers[1] });
			await flushPromises();

			expect(mockFetch).toHaveBeenCalledOnce();
			expect(displayRows.value[1]).toMatchObject({ name: 'Bob', wins: 5, points: 15 });
		});
	});

	describe('the Position Change column', () => {
		const withPositionChange = [
			{ key: 'position', visible: true },
			{ key: 'name', visible: true },
			{ key: 'positionChange', visible: true },
		];
		// Round 7's Round Standings, measured against Round 6's.
		const roundSeven = {
			round: createMockRound({ id: 7, name: 'Round 7' }),
			roundStandings: [
				standing(3, 1, 5, 0, 15),
				standing(1, 2, 4, 1, 12),
				standing(2, 3, 4, 1, 12),
				standing(4, 4, 3, 2, 9),
			],
			previousRoundPositions: {
				roundId: 6,
				positions: [
					{ playerId: 1, position: 1 },
					{ playerId: 2, position: 3 },
					{ playerId: 3, position: 4 },
				],
			},
		};
		const positionChanges = (result: Awaited<ReturnType<typeof mountStandings>>) =>
			result.pageData.value.map(player => [
				player.name,
				result.formatCell(player, 'positionChange'),
			]);

		beforeEach(() => {
			Object.assign(mutableConfig, { columns: withPositionChange, roundId: 7 });
			answerReads(roundSeven);
		});

		it('shows each Player\'s Position Change since the previous Round', async () => {
			const result = await mountStandings();

			expect(positionChanges(result)).toEqual([
				['Charlie', '▲3'],
				['Alice', '▼1'],
				['Bob', '–'],
				['Diana', 'new'],
			]);
			expect(result.positionChangeOf(result.pageData.value[0]!)).toEqual({ kind: 'up', by: 3 });
		});

		it('leaves every Player\'s cell blank when there is no previous Round', async () => {
			answerReads({ ...roundSeven, previousRoundPositions: null });

			const result = await mountStandings();

			expect(positionChanges(result).map(([, change]) => change)).toEqual(['', '', '', '']);
		});

		it.each([
			[
				'watchlist',
				{ playerListId: 42 },
				[
					['Alice', '▼1'],
					['Diana', 'new'],
				],
			],
			[
				'range',
				{ rangeStart: 1, rangeEnd: 2 },
				[
					['Charlie', '▲3'],
					['Alice', '▼1'],
				],
			],
			[
				'range',
				{ rangeStart: 2, rangeEnd: 3 },
				[
					['Alice', '▼1'],
					['Bob', '–'],
				],
			],
			[
				'reveal',
				{ revealCount: 4, revealedCount: 1, revealOrder: 'bottomUp' },
				[
					['Diana', 'new'],
				],
			],
		] as const)('keeps each Player\'s Position Change in the %s view', async (viewMode, view, expected) => {
			Object.assign(mutableConfig, { viewMode, ...view });
			answerReads({
				...roundSeven,
				watchlist: {
					name: 'VIPs',
					playerIds: [1, 4],
				},
			});

			const result = await mountStandings();

			expect(positionChanges(result)).toEqual(expected);
		});

		it('reads again when the column is shown, so the previous Round is read only for a Screen showing it', async () => {
			mutableConfig.columns = defaultConfig.columns;
			await mountStandings();
			mockFetch.mockClear();

			mutableConfig.columns = withPositionChange;
			await flushPromises();

			expect(mockFetch).toHaveBeenCalledOnce();
		});

		it('follows a change to the Event\'s Round order while the column shows', async () => {
			await mountStandings();
			mockFetch.mockClear();

			deliver('round:updated', {
				round: createMockRound({ id: 3, name: 'Round 3' }),
			});
			await flushPromises();
			deliver('phase:updated', {
				phase: { id: 1 },
			});
			await flushPromises();
			deliver('round:deleted', { roundId: 6 });
			await flushPromises();

			expect(mockFetch).toHaveBeenCalledTimes(3);
		});

		it('ignores another Round\'s change while the column is hidden', async () => {
			mutableConfig.columns = defaultConfig.columns;
			await mountStandings();
			mockFetch.mockClear();

			deliver('round:updated', {
				round: createMockRound({ id: 3, name: 'Round 3' }),
			});
			deliver('phase:updated', {
				phase: { id: 1 },
			});
			await flushPromises();

			expect(mockFetch).not.toHaveBeenCalled();
		});

		describe('with no previous Round\'s Round Standings', () => {
			// Only a read made with the column showing looks for the previous Round (#905).
			it.each([
				[
					'the column shows and its read found none',
					withPositionChange,
					null,
					true,
				],
				[
					'its read found a previous Round',
					withPositionChange,
					roundSeven.previousRoundPositions,
					false,
				],
				[
					'the column is hidden',
					defaultConfig.columns,
					null,
					false,
				],
			])('is reported when %s: %s', async (_, columns, previousRoundPositions, reported) => {
				mutableConfig.columns = columns;
				answerReads({ ...roundSeven, previousRoundPositions });

				const { noPreviousRoundStandings } = await mountStandings();

				expect(noPreviousRoundStandings.value).toBe(reported);
			});

			it('is not reported from a read made before the column showed, while the column\'s read is pending', async () => {
				mutableConfig.columns = defaultConfig.columns;
				answerReads({ ...roundSeven, previousRoundPositions: null });
				const { noPreviousRoundStandings } = await mountStandings();
				const read = deferred<unknown>();
				mockFetch.mockReturnValue(read.promise);

				mutableConfig.columns = withPositionChange;
				await flushPromises();
				expect(noPreviousRoundStandings.value).toBe(false);

				read.resolve(standingsRead({ ...roundSeven, previousRoundPositions: null }));
				await flushPromises();
				expect(noPreviousRoundStandings.value).toBe(true);
			});

			it('clears once Melee Sync stores a previous Round\'s Round Standings', async () => {
				answerReads({ ...roundSeven, previousRoundPositions: null });
				const { noPreviousRoundStandings } = await mountStandings();
				expect(noPreviousRoundStandings.value).toBe(true);

				answerReads(roundSeven);
				deliver('melee:roundStandingsSynced', {});
				await flushPromises();

				expect(noPreviousRoundStandings.value).toBe(false);
			});
		});
	});
});
