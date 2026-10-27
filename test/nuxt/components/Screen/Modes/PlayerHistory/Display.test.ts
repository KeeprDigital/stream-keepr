import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, ref } from 'vue';
import Display from '~/components/Screen/Modes/PlayerHistory/Display.vue';
import { modeTokenVar } from '~/modules/screen-mode';

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

// Canned strings, not a copy of the real algorithm: the component only splits
// whatever the composable returns on the first space, and the real formatOutcome
// is covered by the composable's own test.
const cannedOutcomes: Record<string, string> = {
	win: 'WIN 2-1',
	loss: 'LOSS 0-2',
	draw: 'DRAW 1-1-1',
	bye: 'BYE',
	pending: 'Pending',
};

function formatOutcome(row: any): string {
	return cannedOutcomes[row.outcome as string] ?? 'Result';
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
		player.value = {
			name: 'Nadia Rivers',
			wins: 12,
			losses: 2,
			draws: 1,
			position: 3,
		};
		pageData.value = [
			historyRow(),
		];
	});

	it('renders the header with the player record and position', async () => {
		const wrapper = await mountComponent();

		expect(wrapper.get('.history-header h2').text()).toBe('Nadia Rivers Match History');
		const subtitle = wrapper.get('.broadcast-table-subtitle').text();
		expect(subtitle).toContain('Record 12-2-1');
		expect(subtitle).toContain('· #3');
	});

	it('omits zero draws and a missing position from the record line', async () => {
		player.value = {
			name: 'Nadia Rivers',
			wins: 4,
			losses: 0,
			draws: 0,
			position: null,
		};

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
			historyRow({
				id: 2,
				roundName: 'Round 2',
				tableNumber: null,
				opponentName: 'Sam Ortiz',
				outcome: 'loss',
				playerGameWins: 0,
				opponentGameWins: 2,
			}),
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
		expect(badge.attributes('data-outcome')).toBe('win');
		expect(badge.get('.outcome-label').text()).toBe('WIN');
		expect(badge.get('.outcome-score').text()).toBe('2-1');
	});

	it.each([
		[
			'bye',
			historyRow({ outcome: 'bye' }),
			'BYE',
		],
		[
			'loss',
			historyRow({ outcome: 'loss', playerGameWins: 0, opponentGameWins: 2 }),
			'LOSS',
		],
		[
			'draw',
			historyRow({
				outcome: 'draw',
				playerGameWins: 1,
				opponentGameWins: 1,
				gameDraws: 1,
			}),
			'DRAW',
		],
		[
			'pending',
			historyRow({ outcome: 'pending', hasResult: false }),
			'Pending',
		],
	] as const)('badges a %s outcome with its state', async (outcome, row, expectedLabel) => {
		pageData.value = [row];

		const wrapper = await mountComponent();

		const badge = wrapper.get('.outcome-badge');
		expect(badge.attributes('data-outcome')).toBe(outcome);
		expect(badge.get('.outcome-label').text()).toBe(expectedLabel);
	});

	// A bye scores as a win, so it reads in the win colour.
	it('badges a bye in the win colour', async () => {
		pageData.value = [
			historyRow({ outcome: 'bye' }),
		];

		const badge = (await mountComponent()).get('.outcome-badge');

		expect(badge.attributes('style')).toContain(`color: ${modeTokenVar('player-history', 'outcome-win')};`);
	});

	it('leaves the score segment off an unscored outcome', async () => {
		pageData.value = [
			historyRow({ outcome: 'bye' }),
		];

		const wrapper = await mountComponent();

		expect(wrapper.get('.outcome-badge').find('.outcome-score').exists()).toBe(false);
	});

	it('shows the opponent deck with its colors when known', async () => {
		const wrapper = await mountComponent();

		expect(wrapper.get('.opponent-deck').text()).toContain('Grixis');
		expect(wrapper.get('[data-testid="mana-colors"]').text()).toBe('UBR');
	});

	it('omits the deck line when the opponent deck is unknown', async () => {
		pageData.value = [
			historyRow({ opponentDeckName: null, opponentDeckColors: null }),
		];

		const wrapper = await mountComponent();

		expect(wrapper.find('.opponent-deck').exists()).toBe(false);
		expect(wrapper.find('[data-testid="mana-colors"]').exists()).toBe(false);
	});

	describe('opponent archetype and game score columns', () => {
		function showingColumns(...keys: string[]) {
			config.value = {
				...config.value,
				columns: keys.map(key => ({ key, visible: true })),
			};
		}

		it('shows the opponent\'s archetype with its colors in its own column', async () => {
			showingColumns('opponent', 'opponentArchetype');

			const wrapper = await mountComponent();

			const row = wrapper.get('.history-row');
			expect(row.get('.opponent-archetype').text()).toContain('Grixis');
			expect(row.get('.opponent-archetype [data-testid="mana-colors"]').text()).toBe('UBR');
		});

		it('leaves the archetype column blank when the opponent has none', async () => {
			showingColumns('opponent', 'opponentArchetype');
			pageData.value = [
				historyRow({ opponentDeckName: null, opponentDeckColors: null }),
			];

			const wrapper = await mountComponent();

			expect(wrapper.get('.opponent-archetype').text()).toBe('');
			expect(wrapper.find('[data-testid="mana-colors"]').exists()).toBe(false);
		});

		it('moves the deck line out of the opponent cell while the archetype column shows', async () => {
			showingColumns('opponent', 'opponentArchetype');

			const wrapper = await mountComponent();

			expect(wrapper.get('.opponent').text()).toBe('vs Nadia Rivers');
			expect(wrapper.find('.opponent-deck').exists()).toBe(false);
		});

		it.each([
			[
				'a win',
				historyRow(),
				'2-1',
			],
			[
				'a loss',
				historyRow({ outcome: 'loss', playerGameWins: 0, opponentGameWins: 2 }),
				'0-2',
			],
			[
				'a game draw',
				historyRow({
					outcome: 'draw',
					playerGameWins: 1,
					opponentGameWins: 1,
					gameDraws: 1,
				}),
				'1-1-1',
			],
			[
				'a bye',
				historyRow({
					outcome: 'bye',
					opponentName: 'BYE',
					playerGameWins: 2,
					opponentGameWins: 0,
				}),
				'',
			],
			[
				'an unreported Match',
				historyRow({
					outcome: 'pending',
					hasResult: false,
					playerGameWins: null,
					opponentGameWins: null,
				}),
				'',
			],
		])('scores %s from the history Player\'s side', async (_name, row, expected) => {
			showingColumns('opponent', 'gameScore');
			pageData.value = [row];

			const wrapper = await mountComponent();

			expect(wrapper.get('.game-score').text()).toBe(expected);
		});

		it('drops the score from the outcome badge while the game score column shows', async () => {
			showingColumns('outcome', 'gameScore');

			const wrapper = await mountComponent();

			expect(wrapper.get('.outcome-label').text()).toBe('WIN');
			expect(wrapper.find('.outcome-score').exists()).toBe(false);
			expect(wrapper.get('.game-score').text()).toBe('2-1');
		});

		it('keeps both in place while the new columns are hidden', async () => {
			config.value = {
				...config.value,
				columns: [
					...config.value.columns,
					{ key: 'opponentArchetype', visible: false },
					{ key: 'gameScore', visible: false },
				],
			};

			const wrapper = await mountComponent();

			expect(wrapper.find('.opponent-archetype').exists()).toBe(false);
			expect(wrapper.find('.game-score').exists()).toBe(false);
			expect(wrapper.get('.opponent-deck').text()).toContain('Grixis');
			expect(wrapper.get('.outcome-score').text()).toBe('2-1');
		});
	});

	it('sizes rows from the measured table height and rows per page', async () => {
		const wrapper = await mountComponent();

		const style = wrapper.get('.player-history-display').attributes('style');
		expect(style).toContain('--history-row-height: 100px;');
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
