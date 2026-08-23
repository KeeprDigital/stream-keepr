import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, ref } from 'vue';

vi.mock('@vueuse/core', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@vueuse/core')>();

	return {
		...actual,
		useElementSize: () => ({
			height: ref(800),
			width: ref(0),
		}),
	};
});

const screen = ref<any>(null);
const config = ref<any>(null);
const error = ref<string | null>(null);
const isEmpty = ref(false);
const headerText = ref('Player Match History');
const pageData = ref<any[]>([]);
const player = ref<any>(null);

// Mirrors usePlayerHistoryModeData's formatOutcome contract; the real
// implementation is covered by the composable's own test.
function formatOutcome(row: any): string {
	if (row.outcome === 'bye') {
		return 'BYE';
	}
	if (!row.hasResult) {
		return 'Pending';
	}
	if (row.playerGameWins != null && row.opponentGameWins != null) {
		const draws = row.gameDraws ? `-${row.gameDraws}` : '';

		return `${String(row.outcome).toUpperCase()} ${row.playerGameWins}-${row.opponentGameWins}${draws}`;
	}

	return row.resultString ?? 'Result';
}

mockNuxtImport('useScreenContext', () => () => ({
	screen: computed(() => screen.value),
}));

mockNuxtImport('usePlayerHistoryModeData', () => () => ({
	config: computed(() => config.value),
	error: computed(() => error.value),
	isEmpty: computed(() => isEmpty.value),
	headerText: computed(() => headerText.value),
	pageData: computed(() => pageData.value),
	player: computed(() => player.value),
	formatOutcome,
}));

const ManaColorDisplayStub = defineComponent({
	props: {
		colors: { type: String, required: false, default: undefined },
	},
	template: '<div data-testid="mana-colors">{{ colors }}</div>',
});

function historyRow(overrides: Record<string, unknown> = {}) {
	return {
		id: 1,
		roundName: 'Round 1',
		tableNumber: 12,
		opponentName: 'Nadia Rivers',
		opponentDeckName: 'Grixis',
		opponentDeckColors: 'UBR',
		outcome: 'win',
		hasResult: true,
		playerGameWins: 2,
		opponentGameWins: 1,
		gameDraws: 0,
		...overrides,
	};
}

async function mountComponent() {
	const componentPath = '../../../../../../app/components/Screen/Modes/PlayerHistory/Display.vue';
	const { default: Display } = await import(componentPath);

	// ScreenModeBase is deliberately left real so the empty/error cases assert the
	// broadcast contract itself: those states render nothing at all.
	return mount(Display, {
		global: {
			stubs: {
				MtgManaColorDisplay: ManaColorDisplayStub,
			},
		},
	});
}

describe('screenModesPlayerHistoryDisplay', () => {
	beforeEach(() => {
		screen.value = {
			screenConfig: {
				primaryTextColor: '#123456',
				secondaryTextColor: '#654321',
				paddingY: 0,
			},
		};
		config.value = {
			playerId: 1,
			showHeader: true,
			rowsPerPage: 8,
			autoPageEnabled: false,
			autoPageIntervalMs: 10000,
			columns: [
				{ key: 'round', visible: true },
				{ key: 'opponent', visible: true },
				{ key: 'table', visible: true },
				{ key: 'outcome', visible: true },
			],
		};
		error.value = null;
		isEmpty.value = false;
		headerText.value = 'Nadia Rivers Match History';
		player.value = { name: 'Nadia Rivers', wins: 12, losses: 2, draws: 1, position: 3 };
		pageData.value = [historyRow()];
	});

	it('renders the header with the player record and position', async () => {
		const wrapper = await mountComponent();

		expect(wrapper.get('.history-header h2').text()).toBe('Nadia Rivers Match History');
		const subtitle = wrapper.get('.broadcast-table-subtitle').text();
		expect(subtitle).toContain('Record 12-2-1');
		expect(subtitle).toContain('· #3');
	});

	it('omits zero draws and a missing position from the record line', async () => {
		player.value = { name: 'Nadia Rivers', wins: 4, losses: 0, draws: 0, position: null };

		const wrapper = await mountComponent();

		const subtitle = wrapper.get('.broadcast-table-subtitle').text();
		expect(subtitle).toContain('Record 4-0');
		expect(subtitle).not.toContain('4-0-0');
		expect(subtitle).not.toContain('#');
	});

	it('hides the header when the mode config disables it', async () => {
		config.value = { ...config.value, showHeader: false };

		const wrapper = await mountComponent();

		expect(wrapper.find('.history-header').exists()).toBe(false);
		expect(wrapper.find('.history-rows').exists()).toBe(true);
	});

	it('omits the record subtitle when no player has loaded', async () => {
		player.value = null;

		const wrapper = await mountComponent();

		expect(wrapper.find('.history-header').exists()).toBe(true);
		expect(wrapper.find('.broadcast-table-subtitle').exists()).toBe(false);
	});

	it('renders every visible column for each history row', async () => {
		pageData.value = [
			historyRow(),
			historyRow({ id: 2, roundName: 'Round 2', tableNumber: null, opponentName: 'Sam Ortiz', outcome: 'loss', playerGameWins: 0, opponentGameWins: 2 }),
		];

		const wrapper = await mountComponent();

		const rows = wrapper.findAll('.history-row');
		expect(rows).toHaveLength(2);
		expect(rows[0]!.get('.round').text()).toBe('Round 1');
		expect(rows[0]!.get('.opponent').text()).toContain('vs Nadia Rivers');
		expect(rows[0]!.get('.table').text()).toBe('Table 12');
		expect(rows[1]!.get('.table').text()).toBe('');
	});

	it('builds the row grid from the visible columns only', async () => {
		config.value = {
			...config.value,
			columns: [
				{ key: 'round', visible: true },
				{ key: 'opponent', visible: true },
				{ key: 'table', visible: false },
				{ key: 'outcome', visible: true },
			],
		};

		const wrapper = await mountComponent();

		const row = wrapper.get('.history-row');
		expect(row.find('.table').exists()).toBe(false);
		expect(row.attributes('style')).toContain('grid-template-columns: minmax(10rem, 1fr) minmax(16rem, 2fr) minmax(8rem, auto);');
	});

	it('splits a scored outcome into label and score on the badge', async () => {
		const wrapper = await mountComponent();

		const badge = wrapper.get('.outcome-badge');
		expect(badge.classes()).toContain('outcome-win');
		expect(badge.get('.outcome-label').text()).toBe('WIN');
		expect(badge.get('.outcome-score').text()).toBe('2-1');
	});

	it.each([
		['bye', historyRow({ outcome: 'bye' }), 'outcome-win', 'BYE'],
		['loss', historyRow({ outcome: 'loss', playerGameWins: 0, opponentGameWins: 2 }), 'outcome-loss', 'LOSS'],
		['draw', historyRow({ outcome: 'draw', playerGameWins: 1, opponentGameWins: 1, gameDraws: 1 }), 'outcome-draw', 'DRAW'],
		['pending', historyRow({ outcome: 'pending', hasResult: false }), 'outcome-pending', 'Pending'],
	])('badges a %s outcome with its state class', async (_name, row, expectedClass, expectedLabel) => {
		pageData.value = [row];

		const wrapper = await mountComponent();

		const badge = wrapper.get('.outcome-badge');
		expect(badge.classes()).toContain(expectedClass);
		expect(badge.get('.outcome-label').text()).toBe(expectedLabel);
	});

	it('leaves the score segment off an unscored outcome', async () => {
		pageData.value = [historyRow({ outcome: 'bye' })];

		const wrapper = await mountComponent();

		expect(wrapper.get('.outcome-badge').find('.outcome-score').exists()).toBe(false);
	});

	it('shows the opponent deck with its colors when known', async () => {
		const wrapper = await mountComponent();

		expect(wrapper.get('.opponent-deck').text()).toContain('Grixis');
		expect(wrapper.get('[data-testid="mana-colors"]').text()).toBe('UBR');
	});

	it('omits the deck line when the opponent deck is unknown', async () => {
		pageData.value = [historyRow({ opponentDeckName: null, opponentDeckColors: null })];

		const wrapper = await mountComponent();

		expect(wrapper.find('.opponent-deck').exists()).toBe(false);
		expect(wrapper.find('[data-testid="mana-colors"]').exists()).toBe(false);
	});

	it('sizes rows from the measured table height and rows per page', async () => {
		const wrapper = await mountComponent();

		const style = wrapper.get('.player-history-display').attributes('style');
		expect(style).toContain('--history-row-height: 100px;');
		expect(style).toContain('--broadcast-table-primary-text: #123456;');
		expect(style).toContain('--broadcast-table-secondary-text: #654321;');
	});

	it('renders nothing while the mode is empty', async () => {
		isEmpty.value = true;

		const wrapper = await mountComponent();

		expect(wrapper.text()).toBe('');
		expect(wrapper.find('.player-history-display').exists()).toBe(false);
	});

	it('renders nothing on a load error', async () => {
		error.value = 'Failed to load player match history';

		const wrapper = await mountComponent();

		expect(wrapper.text()).toBe('');
		expect(wrapper.find('.player-history-display').exists()).toBe(false);
	});
});
