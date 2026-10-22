import type { BracketEntrant, BracketMatchInput, TopCutBracket } from '~~/shared/modules/top-cut-bracket';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { computed, ref } from 'vue';
import { deriveTopCutBracket, EMPTY_TOP_CUT_BRACKET } from '~~/shared/modules/top-cut-bracket';

const screen = ref<any>({ id: 1, screenConfig: {} });
const config = ref({ phaseId: 3, showHeader: true, headerText: undefined as string | undefined });
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
		slots: column.findAll('.bracket-slot').map(slot =>
			slot.findAll('.bracket-entrant').map(entrant => entrant.findAll('span').map(part => part.text()).join(' '))),
	}));
}

describe('screenModesTopCutDisplay', () => {
	beforeEach(() => {
		config.value = { phaseId: 3, showHeader: true, headerText: undefined };
		error.value = null;
		isEmpty.value = false;
		headerText.value = 'Top 8';
	});

	it('renders one column per Round, each Match\'s Players and result, and the winners advancing into pending slots', async () => {
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
			{ name: 'Quarterfinals', slots: [['Seed 1 2', 'Seed 8 1'], ['Seed 4 0', 'Seed 5 2'], ['Seed 2', 'Seed 7'], ['Seed 3', 'Seed 6']] },
			{ name: 'Semifinals', slots: [['Seed 1', 'Seed 5'], ['TBD', 'TBD']] },
			{ name: 'Final', slots: [['TBD', 'TBD']] },
		]);

		const firstMatch = wrapper.findAll('.bracket-column')[0]!.findAll('.bracket-slot')[0]!;
		expect(firstMatch.findAll('.bracket-entrant').map(entrant => entrant.classes())).toEqual([
			expect.arrayContaining(['is-winner']),
			expect.arrayContaining(['is-eliminated']),
		]);
		expect(wrapper.findAll('.bracket-column')[1]!.findAll('.bracket-slot').map(slot => slot.attributes('data-status')))
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

		expect(columnTexts(wrapper)[0]!.slots[0]).toEqual(['Seed 1', 'Bye']);
		expect(columnTexts(wrapper)[1]!.slots[0]).toEqual(['Seed 1', 'TBD']);
	});

	it('crowns the Final\'s winner', async () => {
		bracket.value = deriveTopCutBracket([
			{ roundId: 1, name: 'Semifinals', matches: [match(1, 1, player(1), player(4), [2, 0]), match(2, 2, player(2), player(3), [2, 0])] },
			{ roundId: 2, name: 'Finals', matches: [match(3, 1, player(1), player(2), [1, 2])] },
		]);
		const wrapper = await mountComponent();

		expect(wrapper.find('.bracket-champion').text()).toContain('Seed 2');
	});

	it.each([4, 8, 16])('renders every slot of a Top %i, sized to its first column', async (size) => {
		bracket.value = unplayed(size);
		const wrapper = await mountComponent();

		expect(wrapper.findAll('.bracket-slot')).toHaveLength(size - 1);
		expect(wrapper.find('.topcut-display').attributes('style')).toContain(`--bracket-rows: ${size / 2}`);
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
