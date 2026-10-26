import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, ref } from 'vue';
import Display from '~/components/Screen/Modes/Pairings/Display.vue';

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
const headerText = ref('Round 4 Pairings');
const pageData = ref<any[]>([]);

// Canned answers keyed by Match, not a copy of the real formatting, which the
// composable's own test covers: the component only places what it is handed.
const cannedResults = new Map<number, string>();
const cannedWinners = new Map<number, 1 | 2 | null>();

mockNuxtImport('useScreenContext', () => () => ({
	screen: computed(() => screen.value),
}));

mockNuxtImport('usePairingsModeData', () => () => ({
	config: computed(() => config.value),
	error: computed(() => error.value),
	isEmpty: computed(() => isEmpty.value),
	headerText: computed(() => headerText.value),
	pageData: computed(() => pageData.value),
	formatResult: (row: any) => cannedResults.get(row.matchId) ?? 'Pending',
	winner: (row: any) => cannedWinners.get(row.matchId) ?? null,
}));

function pairingRow(overrides: Record<string, unknown> = {}) {
	return {
		matchId: 1,
		tableNumber: 3,
		player1: { id: 7, name: 'Nadia Rivers' },
		player2: { id: 8, name: 'Oskar Lind' },
		isBye: false,
		hasResult: false,
		player1GameWins: null,
		player2GameWins: null,
		gameDraws: null,
		resultString: null,
		...overrides,
	};
}

async function mountComponent() {
	// ScreenModeBase is left real so the empty case asserts the broadcast
	// contract itself: that state renders nothing at all.
	return mount(Display);
}

describe('screenModesPairingsDisplay', () => {
	beforeEach(() => {
		screen.value = {
			screenConfig: { primaryTextColor: '#123456', secondaryTextColor: '#654321', paddingY: 0 },
		};
		config.value = {
			roundId: 31,
			showHeader: true,
			rowsPerPage: 8,
			autoPageEnabled: false,
			autoPageIntervalMs: 10000,
		};
		error.value = null;
		isEmpty.value = false;
		headerText.value = 'Round 4 Pairings';
		pageData.value = [
			pairingRow(),
		];
		cannedResults.clear();
		cannedWinners.clear();
	});

	it('shows the header, and hides it when the mode config disables it', async () => {
		expect((await mountComponent()).get('.pairings-header h2').text()).toBe('Round 4 Pairings');

		config.value = { ...config.value, showHeader: false };
		const hidden = await mountComponent();
		expect(hidden.find('.pairings-header').exists()).toBe(false);
		expect(hidden.find('.pairings-rows').exists()).toBe(true);
	});

	it('lists each Match with its table, both Players and its result, in the order given', async () => {
		pageData.value = [
			pairingRow({
				matchId: 1,
				tableNumber: 1,
				player1: { id: 7, name: 'Nadia Rivers' },
				player2: { id: 8, name: 'Oskar Lind' },
			}),
			pairingRow({
				matchId: 2,
				tableNumber: 2,
				player1: { id: 9, name: 'Sam Ortiz' },
				player2: { id: 10, name: 'Ivy Chen' },
				hasResult: true,
			}),
		];
		cannedResults.set(2, '2-1');

		const rows = (await mountComponent()).findAll('.pairing-row');

		expect(rows.map(row => row.get('.table').text())).toEqual(['1', '2']);
		expect(rows[0]!.get('.player-1').text()).toBe('Nadia Rivers');
		expect(rows[0]!.get('.player-2').text()).toBe('Oskar Lind');
		expect(rows[0]!.get('.result').text()).toBe('Pending');
		expect(rows[0]!.get('.result').classes()).toContain('result-pending');
		expect(rows[1]!.get('.result').text()).toBe('2-1');
		expect(rows[1]!.get('.result').classes()).not.toContain('result-pending');
	});

	it('marks the winning side of a reported Match', async () => {
		pageData.value = [
			pairingRow({ hasResult: true }),
		];
		cannedResults.set(1, '0-2');
		cannedWinners.set(1, 2);

		const row = (await mountComponent()).get('.pairing-row');

		expect(row.get('.player-2').classes()).toContain('winner');
		expect(row.get('.player-1').classes()).not.toContain('winner');
	});

	it('marks a bye, with no table and no opponent', async () => {
		pageData.value = [
			pairingRow({ tableNumber: null, isBye: true, player2: null }),
		];
		cannedResults.set(1, 'BYE');

		const row = (await mountComponent()).get('.pairing-row');

		expect(row.classes()).toContain('bye');
		expect(row.get('.table').text()).toBe('');
		expect(row.get('.player-2').text()).toBe('BYE');
		expect(row.get('.result').text()).toBe('BYE');
	});

	it('names an unfilled seat as to be decided', async () => {
		pageData.value = [
			pairingRow({ player2: null }),
		];

		expect((await mountComponent()).get('.player-2').text()).toBe('TBD');
	});

	it('sizes rows from the measured table height and rows per page', async () => {
		const style = (await mountComponent()).get('.pairings-display').attributes('style');

		expect(style).toContain('--pairings-row-height: 100px;');
		expect(style).toContain('--pairings-row-font-size: 26.8px;');
		expect(style).toContain('--pairings-row-secondary-font-size: 19.296px;');
		expect(style).toContain('--broadcast-table-primary-text: #123456;');
	});

	it('renders nothing while the mode is empty', async () => {
		isEmpty.value = true;

		const wrapper = await mountComponent();

		expect(wrapper.text()).toBe('');
		expect(wrapper.find('.pairings-display').exists()).toBe(false);
	});
});
