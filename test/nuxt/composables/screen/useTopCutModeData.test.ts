import type { EffectScope } from 'vue';
import type { TopCutBracket } from '~~/shared/modules/top-cut-bracket';
import type { ScreenOutputTopCutResponse } from '~~/shared/types/screenOutputReads';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deriveTopCutBracket } from '~~/shared/modules/top-cut-bracket';
import { createFakeEventChannel } from '~~/test/helpers/realtime-mock';

const defaultConfig = {
	phaseId: undefined as number | undefined,
	showHeader: true,
	headerText: undefined as string | undefined,
	showSeeds: false,
	showArchetypes: false,
};

const mutableConfig = reactive({ ...defaultConfig });
const mockEventId = ref<number | null>(1);
const { mockFetch } = vi.hoisted(() => ({
	mockFetch: vi.fn(),
}));
const realtime = createFakeEventChannel();
const { deliver } = realtime;

mockNuxtImport('$fetch', () => mockFetch);
mockNuxtImport('tryUseRealtime', () => () => realtime.transport);
mockNuxtImport('useScreenContext', () => () => ({
	screen: ref({ id: 1, name: 'Test' }),
	eventId: mockEventId,
	interactive: ref(false),
}));
mockNuxtImport('useScreenModeConfig', () => () => computed(() => mutableConfig));

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
	const result = scope.run(() => useTopCutModeData())!;
	scopes.push(scope);
	return result;
}

describe('useTopCutModeData', () => {
	beforeEach(() => {
		Object.assign(mutableConfig, defaultConfig);
		mockEventId.value = 1;
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

	describe('live-follow', () => {
		async function following(shown: Partial<Pick<typeof defaultConfig, 'showSeeds' | 'showArchetypes'>> = {}) {
			mutableConfig.phaseId = 3;
			Object.assign(mutableConfig, shown);
			mockFetch.mockResolvedValue(answer());
			makeTopCutModeData();
			await flushPromises();
			mockFetch.mockClear();
		}

		it.each([
			[
				'a result reported in a Round it shows',
				'match:updated',
				{
					match: { id: 102, roundId: 31 },
				},
			],
			[
				'a Match paired in a Round it shows',
				'match:created',
				{
					match: { id: 103, roundId: 31 },
				},
			],
			[
				'a Match deleted from it',
				'match:deleted',
				{ matchId: 101 },
			],
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
				'a Round of it renamed',
				'round:updated',
				{
					round: { id: 31, phaseId: 3 },
				},
			],
			[
				'a Round of it deleted',
				'round:deleted',
				{ roundId: 31 },
			],
			[
				'Match Results synced from Melee in a Round it shows',
				'melee:matchResultsSynced',
				{
					roundId: 31,
					matchIds: [102],
				},
			],
			[
				'a Round it shows re-paired from Melee',
				'melee:pairingsSynced',
				{ roundId: 31 },
			],
			[
				'its Phase renamed',
				'phase:updated',
				{
					phase: { id: 3 },
				},
			],
			[
				'its Phase deleted',
				'phase:deleted',
				{ phaseId: 3 },
			],
			[
				'an entrant renamed',
				'player:updated',
				{
					player: { id: 9 },
				},
			],
			['Melee\'s structure synced', 'melee:structureSynced', {}],
		])('re-reads on %s', async (_, type, payload) => {
			await following();
			deliver(type, payload);
			await flushPromises();

			expect(mockFetch).toHaveBeenCalledTimes(1);
		});

		it.each([
			[
				'a result in a Round it does not show',
				'match:updated',
				{
					match: { id: 500, roundId: 40 },
				},
			],
			[
				'a Round added to another Phase',
				'round:created',
				{
					round: { id: 41, phaseId: 4 },
				},
			],
			[
				'another Phase renamed',
				'phase:updated',
				{
					phase: { id: 4 },
				},
			],
			[
				'a Player it does not seat renamed',
				'player:updated',
				{
					player: { id: 50 },
				},
			],
			[
				'Match Results synced from Melee in a Round it does not show',
				'melee:matchResultsSynced',
				{
					roundId: 40,
					matchIds: [500],
				},
			],
			[
				'a Round it does not show re-paired from Melee',
				'melee:pairingsSynced',
				{ roundId: 40 },
			],
			[
				'the deprecated Round sync of a Round it shows',
				'melee:roundSynced',
				{
					roundId: 31,
					matchCount: 2,
					created: 0,
					updated: 1,
					staleDeleted: 0,
				},
			],
		])('does not re-read on %s', async (_, type, payload) => {
			await following();
			deliver(type, payload);
			await flushPromises();

			expect(mockFetch).not.toHaveBeenCalled();
		});

		// Seeds come from Round Standings before the Phase, which a sync of any
		// Round may store, and any Round or Phase edit may reorder.
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
				'an earlier Round deleted',
				'round:deleted',
				{ roundId: 20 },
			],
			[
				'another Phase reordered',
				'phase:updated',
				{
					phase: { id: 2 },
				},
			],
			[
				'another Phase deleted',
				'phase:deleted',
				{ phaseId: 2 },
			],
		] as const;

		// An Archetype is named by its Archetype or a Deck List, neither of which
		// is a Player message.
		const archetypeChanges = [
			[
				'an Archetype renamed',
				'archetype:updated',
				{
					archetype: { id: 5 },
				},
			],
			[
				'an Archetype deleted',
				'archetype:deleted',
				{ archetypeId: 5 },
			],
			['Melee\'s Deck Lists synced', 'melee:decklistsSynced', {}],
		] as const;

		it.each(seedChanges)('re-reads on %s while seeds show', async (_, type, payload) => {
			await following({ showSeeds: true });
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

		it.each([
			[
				'Match Results synced in an earlier Round',
				'melee:matchResultsSynced',
				{
					roundId: 20,
					matchIds: [200],
				},
			],
			[
				'an earlier Round re-paired',
				'melee:pairingsSynced',
				{ roundId: 20 },
			],
			[
				'the deprecated Round sync of an earlier Round',
				'melee:roundSynced',
				{
					roundId: 20,
					matchCount: 8,
					created: 0,
					updated: 8,
					staleDeleted: 0,
				},
			],
		] as const)('does not re-read on %s while seeds show', async (_, type, payload) => {
			await following({ showSeeds: true });
			deliver(type, payload);
			await flushPromises();

			expect(mockFetch).not.toHaveBeenCalled();
		});

		it.each([
			...seedChanges,
			...archetypeChanges,
		])('does not re-read on %s while neither shows', async (_, type, payload) => {
			await following();
			deliver(type, payload);
			await flushPromises();

			expect(mockFetch).not.toHaveBeenCalled();
		});
	});
});
