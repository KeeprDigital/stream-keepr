import type { BracketEntrant, BracketMatchInput, TopCutBracket } from '~~/shared/modules/top-cut-bracket';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { computed, ref } from 'vue';
import { deriveTopCutBracket, EMPTY_TOP_CUT_BRACKET } from '~~/shared/modules/top-cut-bracket';

const screen = ref<any>({ id: 1, screenConfig: {} });
const config = ref({ phaseId: 3, showSeeds: false, showArchetypes: false, showHeader: true, headerText: undefined as string | undefined });
const error = ref<string | null>(null);
const isEmpty = ref(false);
const headerText = ref('Top 8');
const bracket = ref<TopCutBracket>(EMPTY_TOP_CUT_BRACKET);

mockNuxtImport('useScreenContext', () => () => ({
	screen: computed(() => screen.value),
}));

mockNuxtImport('useTopCutModeData', () => () => ({
	config: computed(() => config.value),
	error: computed(() => error.value),
	isEmpty: computed(() => isEmpty.value),
	headerText: computed(() => headerText.value),
	bracket: computed(() => bracket.value),
}));

function player(id: number): BracketEntrant {
	return { playerId: id, name: `Seed ${id}` };
}

function match(matchId: number, table: number, a: BracketEntrant | null, b: BracketEntrant | null, result?: [number, number]): BracketMatchInput {
	return {
		matchId,
		tableNumber: table,
		player1: a,
		player2: b,
		isBye: false,
		hasResult: result != null,
		player1GameWins: result?.[0] ?? null,
		player2GameWins: result?.[1] ?? null,
		gameDraws: result ? 0 : null,
	};
}

/** A Top `size` with every first-Round Match unplayed. */
function unplayed(size: number): TopCutBracket {
	return deriveTopCutBracket([{
		roundId: 1,
		name: 'First Round',
		matches: Array.from({ length: size / 2 }, (_, index) => match(index + 1, index + 1, player(index + 1), player(size - index))),
	}]);
}

async function mountComponent() {
	const componentPath = '../../../../../../app/components/Screen/Modes/TopCut/Display.vue';
	const { default: Display } = await import(componentPath);

	// ScreenModeBase is left real so the empty case asserts the broadcast
	// contract itself: that state renders nothing at all.
	return mount(Display);
}

function columnTexts(wrapper: Awaited<ReturnType<typeof mountComponent>>) {
	return wrapper.findAll('.bracket-column').map(column => ({
		name: column.find('.bracket-column-name').text(),
		positions: column.findAll('.bracket-position').map(position =>
			position.findAll('.bracket-entrant').map(entrant => entrant.findAll('span').map(part => part.text()).join(' '))),
	}));
}

describe('screenModesTopCutDisplay', () => {
	beforeEach(() => {
		config.value = { phaseId: 3, showSeeds: false, showArchetypes: false, showHeader: true, headerText: undefined };
		error.value = null;
		isEmpty.value = false;
		headerText.value = 'Top 8';
	});

	it('renders one column per Round, each Match\'s Players and result, and the winners advancing into pending positions', async () => {
		bracket.value = deriveTopCutBracket([{
			roundId: 1,
			name: 'Quarterfinals',
			matches: [
				match(1, 1, player(1), player(8), [2, 1]),
				match(2, 2, player(4), player(5), [0, 2]),
				match(3, 3, player(2), player(7)),
				match(4, 4, player(3), player(6)),
			],
		}]);
		const wrapper = await mountComponent();

		expect(wrapper.find('.broadcast-table-title').text()).toBe('Top 8');
		expect(columnTexts(wrapper)).toEqual([
			{ name: 'Quarterfinals', positions: [['Seed 1 2', 'Seed 8 1'], ['Seed 4 0', 'Seed 5 2'], ['Seed 2', 'Seed 7'], ['Seed 3', 'Seed 6']] },
			{ name: 'Semifinals', positions: [['Seed 1', 'Seed 5'], ['TBD', 'TBD']] },
			{ name: 'Final', positions: [['TBD', 'TBD']] },
		]);

		const firstMatch = wrapper.findAll('.bracket-column')[0]!.findAll('.bracket-position')[0]!;
		expect(firstMatch.findAll('.bracket-entrant').map(entrant => entrant.classes())).toEqual([
			expect.arrayContaining(['is-winner']),
			expect.arrayContaining(['is-eliminated']),
		]);
		expect(wrapper.findAll('.bracket-column')[1]!.findAll('.bracket-position').map(position => position.attributes('data-status')))
			.toEqual(['awaiting', 'awaiting']);
		expect(wrapper.find('.bracket-champion').exists()).toBe(false);
	});

	it('shows a bye\'s empty seat as a bye', async () => {
		bracket.value = deriveTopCutBracket([{
			roundId: 1,
			name: 'Semifinals',
			matches: [{ ...match(1, 1, player(1), null), isBye: true }, match(2, 2, player(2), player(3))],
		}]);
		const wrapper = await mountComponent();

		expect(columnTexts(wrapper)[0]!.positions[0]).toEqual(['Seed 1', 'Bye']);
		expect(columnTexts(wrapper)[1]!.positions[0]).toEqual(['Seed 1', 'TBD']);
	});

	it('crowns the Final\'s winner', async () => {
		bracket.value = deriveTopCutBracket([
			{ roundId: 1, name: 'Semifinals', matches: [match(1, 1, player(1), player(4), [2, 0]), match(2, 2, player(2), player(3), [2, 0])] },
			{ roundId: 2, name: 'Finals', matches: [match(3, 1, player(1), player(2), [1, 2])] },
		]);
		const wrapper = await mountComponent();

		expect(wrapper.find('.bracket-champion').text()).toContain('Seed 2');
	});

	it.each([4, 8, 16])('renders every position of a Top %i, sized to its first column', async (size) => {
		bracket.value = unplayed(size);
		const wrapper = await mountComponent();

		expect(wrapper.findAll('.bracket-position')).toHaveLength(size - 1);
		expect(wrapper.find('.topcut-display').attributes('style')).toContain(`--bracket-rows: ${size / 2}`);
	});

	describe('seeds and Archetypes', () => {
		/** A Semifinal whose Players carry a seed and an Archetype, or neither. */
		function detailed(): TopCutBracket {
			return deriveTopCutBracket([{
				roundId: 1,
				name: 'Semifinals',
				matches: [
					match(1, 1, { ...player(1), seed: 1, deck: { name: 'Izzet Prowess', colors: 'UR' } }, { ...player(4), seed: null, deck: null }),
					match(2, 2, { ...player(2), seed: 2, deck: null }, { ...player(3), seed: 3, deck: { name: 'Mono-Green Landfall', colors: 'G' } }),
				],
			}]);
		}

		function firstColumnEntrants(wrapper: Awaited<ReturnType<typeof mountComponent>>) {
			return wrapper.findAll('.bracket-column')[0]!.findAll('.bracket-entrant');
		}

		it('shows each Player\'s seed before their name, blank for one with none', async () => {
			bracket.value = detailed();
			config.value = { ...config.value, showSeeds: true };
			const wrapper = await mountComponent();

			expect(firstColumnEntrants(wrapper).map(entrant => [entrant.find('.bracket-entrant-seed').text(), entrant.find('.bracket-entrant-name').text()])).toEqual([
				['1', 'Seed 1'],
				['', 'Seed 4'],
				['2', 'Seed 2'],
				['3', 'Seed 3'],
			]);
			expect(wrapper.find('.bracket-entrant-archetype').exists()).toBe(false);
		});

		it('shows each Player\'s Archetype under their name, blank for one with none', async () => {
			bracket.value = detailed();
			config.value = { ...config.value, showArchetypes: true };
			const wrapper = await mountComponent();

			expect(firstColumnEntrants(wrapper).map(entrant => entrant.find('.bracket-entrant-archetype').text())).toEqual([
				'Izzet Prowess',
				'',
				'',
				'Mono-Green Landfall',
			]);
			expect(wrapper.find('.bracket-entrant-seed').exists()).toBe(false);
		});

		it('shows neither while the Screen turns both off', async () => {
			bracket.value = detailed();
			const wrapper = await mountComponent();

			expect(wrapper.find('.bracket-entrant-seed').exists()).toBe(false);
			expect(wrapper.find('.bracket-entrant-archetype').exists()).toBe(false);
		});

		it('keeps every position of a Top 16 on screen with both on, sizing type for a second line per entrant', async () => {
			bracket.value = unplayed(16);
			config.value = { ...config.value, showSeeds: true, showArchetypes: true };
			const wrapper = await mountComponent();

			expect(wrapper.findAll('.bracket-position')).toHaveLength(15);
			const style = wrapper.find('.topcut-display').attributes('style');
			expect(style).toContain('--bracket-rows: 8');
			expect(style).toContain('--bracket-position-height: 6.4');
		});

		it('sizes type for one line per entrant while Archetypes are off', async () => {
			bracket.value = unplayed(16);
			config.value = { ...config.value, showSeeds: true };
			const wrapper = await mountComponent();

			expect(wrapper.find('.topcut-display').attributes('style')).toContain('--bracket-position-height: 4.6');
		});
	});

	it('hides the header when the Screen turns it off', async () => {
		bracket.value = unplayed(4);
		config.value = { ...config.value, showHeader: false };
		const wrapper = await mountComponent();

		expect(wrapper.find('.broadcast-table-title').exists()).toBe(false);
	});

	it('renders nothing while the Screen names no Phase, or its Phase holds no Rounds', async () => {
		isEmpty.value = true;
		const wrapper = await mountComponent();

		expect(wrapper.find('.topcut-display').exists()).toBe(false);
	});
});
