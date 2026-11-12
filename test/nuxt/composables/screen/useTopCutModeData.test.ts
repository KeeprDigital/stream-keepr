import type { EffectScope } from 'vue';
import type { ManualBracket, TopCutBracket } from '~~/shared/modules/top-cut-bracket';
import type { TopCutBracketSource } from '~~/shared/screenModeConfigs/topCut';
import type { Game } from '~~/shared/types/enums';
import type { ScreenOutputTopCutResponse } from '~~/shared/types/screenOutputReads';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deriveManualTopCutBracket, deriveTopCutBracket } from '~~/shared/modules/top-cut-bracket';
import { createFakeEventChannel } from '~~/test/helpers/realtime-mock';
import { screenContextOf } from '~~/test/nuxt/helpers/screenContext';

const defaultConfig = {
	bracketSource: 'phase' as TopCutBracketSource,
	phaseId: undefined as number | undefined,
	manualBracket: { size: 8, entrants: [], results: [] } as ManualBracket,
	showHeader: true,
	headerText: undefined as string | undefined,
	showSeeds: false,
	showArchetypes: false,
	bracketSizeOverride: undefined as number | undefined,
};

const mutableConfig = reactive({ ...defaultConfig });
const mockEventId = ref<number | null>(1);
const mockGame = ref<Game | undefined>('mtg');
const { mockFetch } = vi.hoisted(() => ({
	mockFetch: vi.fn(),
}));
const realtime = createFakeEventChannel();
const { deliver } = realtime;

mockNuxtImport('$fetch', () => mockFetch);
mockNuxtImport('tryUseRealtime', () => () => realtime.transport);
const screenContext = screenContextOf({
	screen: ref({ id: 1, name: 'Test' }),
	eventId: mockEventId,
});
mockNuxtImport('useScreenModeConfig', () => () => computed(() => mutableConfig));
mockNuxtImport('useScreenCardGame', () => () => computed(() => mockGame.value));

const phase = {
	id: 3,
	eventId: 1,
	name: 'Top 8',
	sortOrder: 1,
};

/** A Top 4 whose Semifinals (Round 31, Matches 101 and 102) seat Players 7 to 10. */
const bracket: TopCutBracket = deriveTopCutBracket([
	{
		roundId: 31,
		name: 'Semifinals',
		matches: [
			{
				matchId: 101,
				tableNumber: 1,
				player1: { playerId: 7, name: 'Nadia' },
				player2: { playerId: 8, name: 'Oskar' },
				isBye: false,
				hasResult: true,
				player1GameWins: 2,
				player2GameWins: 0,
				gameDraws: 0,
			},
			{
				matchId: 102,
				tableNumber: 2,
				player1: { playerId: 9, name: 'Pia' },
				player2: { playerId: 10, name: 'Quinn' },
				isBye: false,
				hasResult: false,
				player1GameWins: null,
				player2GameWins: null,
				gameDraws: null,
			},
		],
	},
]);

function answer(overrides: Partial<ScreenOutputTopCutResponse> = {}): ScreenOutputTopCutResponse {
	return { phase: phase as ScreenOutputTopCutResponse['phase'], bracket, ...overrides };
}

const scopes: EffectScope[] = [];

function makeTopCutModeData() {
	const scope = effectScope();
	const result = scope.run(() => useTopCutModeData(screenContext))!;
	scopes.push(scope);
	return result;
}

describe('useTopCutModeData', () => {
	beforeEach(() => {
		Object.assign(mutableConfig, defaultConfig);
		mockEventId.value = 1;
		mockGame.value = 'mtg';
		realtime.reset();
		mockFetch.mockReset();
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		scopes.splice(0).forEach(scope => scope.stop());
	});

	it('reads the configured Phase\'s bracket through the Screen', async () => {
		mutableConfig.phaseId = 3;
		mockFetch.mockResolvedValue(answer());

		const { bracket: held, isEmpty, error } = makeTopCutModeData();
		await flushPromises();

		expect(mockFetch).toHaveBeenCalledWith('/api/screen-output/events/1/screens/1/top-cut', expect.anything());
		expect(held.value.columns.map(column => column.name)).toEqual(['Semifinals', 'Final']);
		expect(isEmpty.value).toBe(false);
		expect(error.value).toBeNull();
	});

	it('reads nothing and is empty while no Phase is selected', async () => {
		const { isEmpty } = makeTopCutModeData();
		await flushPromises();

		expect(mockFetch).not.toHaveBeenCalled();
		expect(isEmpty.value).toBe(true);
	});

	it('is empty while the Phase holds no Rounds, or is gone', async () => {
		mutableConfig.phaseId = 3;
		mockFetch.mockResolvedValue(answer({
			bracket: { size: 0, columns: [], champion: null },
		}));

		const { isEmpty } = makeTopCutModeData();
		await flushPromises();

		expect(isEmpty.value).toBe(true);
	});

	it('heads the bracket with the configured header, else the Phase\'s name', async () => {
		mutableConfig.phaseId = 3;
		mockFetch.mockResolvedValue(answer());
		const { headerText } = makeTopCutModeData();
		await flushPromises();

		expect(headerText.value).toBe('Top 8');
		mutableConfig.headerText = 'Championship Bracket';
		expect(headerText.value).toBe('Championship Bracket');
	});

	it.each([
		['seeds', 'showSeeds'],
		['Archetypes', 'showArchetypes'],
	] as const)('re-reads when %s are turned on, since the read carries them only while shown', async (_, toggle) => {
		mutableConfig.phaseId = 3;
		mockFetch.mockResolvedValue(answer());
		makeTopCutModeData();
		await flushPromises();
		mockFetch.mockClear();

		mutableConfig[toggle] = true;
		await flushPromises();

		expect(mockFetch).toHaveBeenCalledTimes(1);
	});

	it('re-reads when the bracket size is set', async () => {
		mutableConfig.phaseId = 3;
		mockFetch.mockResolvedValue(answer());
		makeTopCutModeData();
		await flushPromises();
		mockFetch.mockClear();

		mutableConfig.bracketSizeOverride = 8;
		await flushPromises();

		expect(mockFetch).toHaveBeenCalledTimes(1);
	});

	describe('live-follow', () => {
		async function following(shown: Partial<Pick<typeof defaultConfig, 'showSeeds' | 'showArchetypes'>> = {}) {
			mutableConfig.phaseId = 3;
			Object.assign(mutableConfig, shown);
			mockFetch.mockResolvedValue(answer());
			makeTopCutModeData();
			await flushPromises();
			mockFetch.mockClear();
		}

		// Which message says which kind changed, and which kinds a bracket follows, is
		// `screenOutputInterest`'s own test. These are what only its read can narrow.
		it.each([
			[
				'a Match moved out of it',
				'match:updated',
				{
					match: { id: 101, roundId: 99 },
				},
			],
			[
				'a Round added to its Phase',
				'round:created',
				{
					round: { id: 32, phaseId: 3 },
				},
			],
			[
				'an entrant renamed',
				'player:updated',
				{
					player: { id: 9 },
				},
			],
		])('re-reads on %s', async (_, type, payload) => {
			await following();
			deliver(type, payload);
			await flushPromises();

			expect(mockFetch).toHaveBeenCalledTimes(1);
		});

		// Seeds place the bracket whether or not they show. They come from Round
		// Standings before the Phase, which a sync of any Round may store, and any
		// Round or Phase edit may reorder.
		const seedChanges = [
			[
				'an earlier Round\'s Round Standings synced from Melee',
				'melee:roundStandingsSynced',
				{ roundId: 20 },
			],
			[
				'an earlier Round renumbered',
				'round:updated',
				{
					round: { id: 20, phaseId: 2 },
				},
			],
			[
				'another Phase reordered',
				'phase:updated',
				{
					phase: { id: 2 },
				},
			],
		] as const;

		// An Archetype is named by its Archetype or a Deck List, neither of which
		// is a Player message.
		const archetypeChanges = [
			[
				'an Archetype deleted',
				'archetype:deleted',
				{ archetypeId: 5 },
			],
		] as const;

		it.each(seedChanges)('re-reads on %s, whether or not seeds show', async (_, type, payload) => {
			await following();
			deliver(type, payload);
			await flushPromises();

			expect(mockFetch).toHaveBeenCalledTimes(1);
		});

		it.each(archetypeChanges)('re-reads on %s while Archetypes show', async (_, type, payload) => {
			await following({ showArchetypes: true });
			deliver(type, payload);
			await flushPromises();

			expect(mockFetch).toHaveBeenCalledTimes(1);
		});

		it.each(archetypeChanges)('does not re-read on %s while Archetypes are hidden', async (_, type, payload) => {
			await following();
			deliver(type, payload);
			await flushPromises();

			expect(mockFetch).not.toHaveBeenCalled();
		});
	});

	describe('a Manual Bracket (ADR-0075)', () => {
		/** A Top 4 whose Seed 1 is Player 7 and Seed 4 a typed name. */
		const manual: ManualBracket = {
			size: 4,
			entrants: [
				{ playerId: 7 },
				null,
				null,
				{ name: 'Walk-in' },
			],
			results: [],
		};
		const manualAnswer = (): ScreenOutputTopCutResponse => ({
			phase: null,
			bracket: deriveManualTopCutBracket(manual, (entrant, seed) => ({
				playerId: 'playerId' in entrant
					? entrant.playerId
					: null,
				name: 'name' in entrant
					? entrant.name
					: 'Nadia',
				seed,
			})),
		});

		async function readingManual() {
			mutableConfig.bracketSource = 'manual';
			mutableConfig.manualBracket = manual;
			mockFetch.mockResolvedValue(manualAnswer());
			const data = makeTopCutModeData();
			await flushPromises();
			return data;
		}

		it('reads it through the Screen with no Phase selected, headed "Top Cut" unless configured', async () => {
			const { bracket: held, isEmpty, headerText } = await readingManual();

			expect(mockFetch).toHaveBeenCalledWith('/api/screen-output/events/1/screens/1/top-cut', expect.anything());
			expect(held.value.columns.map(column => column.name)).toEqual(['Semifinals', 'Final']);
			expect(isEmpty.value).toBe(false);
			expect(headerText.value).toBe('Top Cut');
		});

		it('reads it on a One Piece Event whatever source the Screen holds', async () => {
			mockGame.value = 'op';
			mockFetch.mockResolvedValue(manualAnswer());
			const { isEmpty } = makeTopCutModeData();
			await flushPromises();

			expect(mockFetch).toHaveBeenCalledTimes(1);
			expect(isEmpty.value).toBe(false);
		});

		it('re-reads when its entrants or results are edited', async () => {
			await readingManual();
			mockFetch.mockClear();

			mutableConfig.manualBracket = {
				...manual,
				results: [
					[
						{ winner: 0 },
					],
				],
			};
			await flushPromises();

			expect(mockFetch).toHaveBeenCalledTimes(1);
		});

		it.each([
			[
				'an entrant renamed',
				1,
				'player:updated',
				{
					player: { id: 7 },
				},
			],
			[
				'a Player it does not seat renamed',
				0,
				'player:updated',
				{
					player: { id: 50 },
				},
			],
		] as const)('on %s, re-reads %i times', async (_, reads, type, payload) => {
			await readingManual();
			mockFetch.mockClear();

			deliver(type, payload);
			await flushPromises();

			expect(mockFetch).toHaveBeenCalledTimes(reads);
		});

		it('follows the source it reads now, once the operator switches to it', async () => {
			mutableConfig.phaseId = 3;
			mockFetch.mockResolvedValue(answer());
			makeTopCutModeData();
			await flushPromises();

			mutableConfig.bracketSource = 'manual';
			mutableConfig.manualBracket = manual;
			await flushPromises();
			mockFetch.mockClear();

			deliver('round:updated', {
				round: { id: 31, phaseId: 3 },
			});
			await flushPromises();

			expect(mockFetch).not.toHaveBeenCalled();
		});
	});
});
