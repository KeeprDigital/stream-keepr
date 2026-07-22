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

const screen = ref<any>({
	screenConfig: {
		primaryTextColor: '#123456',
		secondaryTextColor: '#654321',
		paddingY: 0,
	},
});

const config = ref<any>({
	viewMode: 'all',
	showHeader: true,
	showArchetypeColors: false,
	maxTableWidth: undefined,
	rowsPerPage: 8,
	revealCount: 8,
	animateEntries: false,
	columns: [
		{ key: 'position', visible: true },
		{ key: 'name', visible: true },
		{ key: 'deck', visible: true },
	],
});

const pageData = ref<any[]>([
	{
		id: 1,
		name: 'Matthew Guides',
		position: 1,
		wins: 12,
		losses: 2,
		draws: 1,
		points: 37,
		gameData: { type: 'mtg', deckName: 'Grixis', deckColors: 'UBR' },
	},
]);

mockNuxtImport('useScreenContext', () => () => ({
	screen: computed(() => screen.value),
}));

mockNuxtImport('useStandingsModeData', () => () => ({
	config: computed(() => config.value),
	loading: ref(false),
	error: ref<string | null>(null),
	isEmpty: computed(() => false),
	emptyMessage: computed(() => 'No standings data available'),
	headerText: computed(() => 'Standings'),
	visibleColumns: computed(() => config.value.columns.filter((column: any) => column.visible)),
	pageData: computed(() => pageData.value),
	formatCell: (player: any, key: string) => {
		switch (key) {
			case 'position':
				return String(player.position ?? '-');
			case 'name':
				return player.name;
			case 'deck':
				return player.gameData?.deckName ?? '-';
			default:
				return '-';
		}
	},
}));

const ScreenModeBaseStub = defineComponent({
	props: {
		loading: { type: Boolean, required: false },
		error: { type: String, required: false },
		empty: { type: Boolean, required: false },
	},
	template: '<div data-testid="mode-base"><slot /></div>',
});

const ManaColorDisplayStub = defineComponent({
	props: {
		colors: { type: String, required: false },
	},
	template: '<div data-testid="mana-colors">{{ colors }}</div>',
});

async function mountComponent() {
	const componentPath = '../../../../../../app/components/Screen/Modes/Standings/Display.vue';
	const { default: Display } = await import(componentPath);

	return mount(Display, {
		global: {
			stubs: {
				ScreenModeBase: ScreenModeBaseStub,
				MtgManaColorDisplay: ManaColorDisplayStub,
			},
		},
	});
}

describe('screenStandingsDisplay', () => {
	beforeEach(() => {
		screen.value = {
			screenConfig: {
				primaryTextColor: '#123456',
				secondaryTextColor: '#654321',
				paddingY: 0,
			},
		};
		config.value = {
			viewMode: 'all',
			showHeader: true,
			showArchetypeColors: false,
			maxTableWidth: undefined,
			rowsPerPage: 8,
			revealCount: 8,
			animateEntries: false,
			columns: [
				{ key: 'position', visible: true },
				{ key: 'name', visible: true },
				{ key: 'deck', visible: true },
			],
		};
		pageData.value = [
			{
				id: 1,
				name: 'Matthew Guides',
				position: 1,
				wins: 12,
				losses: 2,
				draws: 1,
				points: 37,
				gameData: { type: 'mtg', deckName: 'Grixis', deckColors: 'UBR' },
			},
		];
	});

	it('renders deck text without archetype colors when toggled off', async () => {
		const wrapper = await mountComponent();

		expect(wrapper.text()).toContain('Standings');
		expect(wrapper.text()).toContain('Matthew Guides');
		expect(wrapper.text()).toContain('Grixis');
		expect(wrapper.get('.standings-display').classes()).toContain('w-full');
		expect(wrapper.find('[data-testid="standings-deck-colors"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="mana-colors"]').exists()).toBe(false);
	});

	it('renders archetype colors inline inside the deck cell when toggled on', async () => {
		config.value = {
			...config.value,
			showArchetypeColors: true,
		};

		const wrapper = await mountComponent();

		expect(wrapper.text()).toContain('Grixis');
		expect(wrapper.find('[data-testid="standings-deck-colors"]').exists()).toBe(true);
		expect(wrapper.get('[data-testid="mana-colors"]').text()).toBe('UBR');
	});

	it('applies an optional max table width to the standings content', async () => {
		config.value = {
			...config.value,
			maxTableWidth: 1200,
		};

		const wrapper = await mountComponent();

		expect(wrapper.get('[data-testid="standings-content"]').attributes('style')).toContain('max-width: 1200px;');
	});

	it('keeps the same row sizing on a short last page', async () => {
		pageData.value = [pageData.value[0]];

		const wrapper = await mountComponent();

		expect(wrapper.get('.standings-rows').attributes('style')).toContain('--standings-row-height: 100px;');
	});

	it('keeps reveal mode row sizing based on the full reveal count', async () => {
		config.value = {
			...config.value,
			viewMode: 'reveal',
			rowsPerPage: 8,
			revealCount: 4,
		};
		pageData.value = [pageData.value[0]];

		const wrapper = await mountComponent();

		expect(wrapper.get('.standings-rows').attributes('style')).toContain('--standings-row-height: 200px;');
	});
});
