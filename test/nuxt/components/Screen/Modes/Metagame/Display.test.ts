import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { computed, defineComponent, ref } from 'vue';

const screen = ref<any>({
	screenConfig: {
		primaryTextColor: '#123456',
		secondaryTextColor: '#654321',
	},
});

const config = ref<any>({
	viewMode: 'archetype',
	showHeader: true,
	animateEntries: false,
	archetypeColumns: [
		{ key: 'archetype', visible: true },
		{ key: 'count', visible: true },
		{ key: 'metaShare', visible: true },
		{ key: 'winRate', visible: true },
		{ key: 'avgPlace', visible: false },
		{ key: 'colors', visible: false },
	],
	cardColumns: [
		{ key: 'card', visible: true },
		{ key: 'manaCost', visible: true },
		{ key: 'type', visible: true },
		{ key: 'inclusionRate', visible: true },
		{ key: 'avgCopies', visible: true },
		{ key: 'totalCopies', visible: true },
		{ key: 'deckCount', visible: true },
		{ key: 'mainboardCount', visible: true },
		{ key: 'sideboardCount', visible: true },
	],
});

const pageData = ref<any[]>([
	{ id: 1, name: 'Mono Red', count: 12, metaShare: 25, winRate: 61.5, avgPosition: 3.2, colors: 'R' },
]);

mockNuxtImport('useScreenContext', () => () => ({
	screen: computed(() => screen.value),
}));

mockNuxtImport('useMetagameModeData', () => () => ({
	config: computed(() => config.value),
	loading: ref(false),
	error: ref<string | null>(null),
	isEmpty: computed(() => false),
	emptyMessage: computed(() => 'No metagame data available'),
	headerText: computed(() => config.value.viewMode === 'cards' ? 'Most Played Cards' : 'Full Field Metagame'),
	pageData: computed(() => pageData.value),
	currentPage: computed(() => 1),
	totalPages: computed(() => 2),
}));

const ScreenModeBaseStub = defineComponent({
	props: {
		loading: { type: Boolean, required: false },
		error: { type: String, required: false },
		empty: { type: Boolean, required: false },
	},
	template: '<div data-testid="mode-base"><slot /></div>',
});

const ManaDisplayStub = defineComponent({
	props: {
		colors: { type: String, required: false },
		manaCost: { type: String, required: false },
	},
	template: '<div data-testid="mana-display">{{ colors || manaCost }}</div>',
});

async function mountComponent() {
	const componentPath = '../../../../../../app/components/Screen/Modes/Metagame/Display.vue';
	const { default: Display } = await import(componentPath);

	return mount(Display, {
		global: {
			stubs: {
				ScreenModeBase: ScreenModeBaseStub,
				MtgManaColorDisplay: ManaDisplayStub,
			},
		},
	});
}

describe('screenMetagameDisplay', () => {
	beforeEach(() => {
		screen.value = {
			screenConfig: {
				primaryTextColor: '#123456',
				secondaryTextColor: '#654321',
			},
		};
		config.value = {
			viewMode: 'archetype',
			showHeader: true,
			animateEntries: false,
			archetypeColumns: [
				{ key: 'archetype', visible: true },
				{ key: 'count', visible: true },
				{ key: 'metaShare', visible: true },
				{ key: 'winRate', visible: true },
				{ key: 'avgPlace', visible: false },
				{ key: 'colors', visible: false },
			],
			cardColumns: [
				{ key: 'card', visible: true },
				{ key: 'manaCost', visible: true },
				{ key: 'type', visible: true },
				{ key: 'inclusionRate', visible: true },
				{ key: 'avgCopies', visible: true },
				{ key: 'totalCopies', visible: true },
				{ key: 'deckCount', visible: true },
				{ key: 'mainboardCount', visible: true },
				{ key: 'sideboardCount', visible: true },
			],
		};
		pageData.value = [
			{ id: 1, name: 'Mono Red', count: 12, metaShare: 25, winRate: 61.5, avgPosition: 3.2, colors: 'R' },
		];
	});

	it('renders the colors column when it is visible', async () => {
		config.value = {
			...config.value,
			archetypeColumns: config.value.archetypeColumns.map((column: any) =>
				column.key === 'colors' ? { ...column, visible: true } : column,
			),
		};

		const wrapper = await mountComponent();

		expect(wrapper.get('[data-testid="metagame-header-row"]').text()).toContain('Colors');
		expect(wrapper.get('[data-testid="mana-display"]').text()).toBe('R');
	});
});
