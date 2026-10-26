import type { Screen } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';
import { getDefaultConfigForMode } from '~~/shared/types/screenConfig';
import Settings from '~/components/Screen/Modes/PlayerHistory/Settings.vue';

vi.mock('~/modules/screen-mode/editorModeData', () => import('~~/test/helpers/editedScreenModeData'));

vi.mock('vue-draggable-plus', () => ({
	VueDraggable: defineComponent({
		name: 'VueDraggable',
		props: {
			modelValue: { type: Array, required: false },
		},
		emits: ['update:modelValue', 'end'],
		template: '<div data-testid="draggable"><slot /></div>',
	}),
}));

const mockConfig = ref<Record<string, any>>({});
const mockUpdateConfig = vi.fn((patch: Record<string, unknown>) => {
	mockConfig.value = {
		...mockConfig.value,
		...patch,
	};
});

mockNuxtImport('usePlayerStore', () => () => ({
	players: [],
	isLoaded: true,
	loadPlayersByEventId: vi.fn(),
	$reset: vi.fn(),
}));
mockNuxtImport('useModeConfigUpdate', () => () => ({
	config: mockConfig,
	saving: ref(false),
	updateConfig: mockUpdateConfig,
	resetConfig: vi.fn(),
}));

const USwitchStub = defineComponent({
	props: {
		modelValue: { type: Boolean, required: false },
	},
	emits: ['update:modelValue'],
	template: '<button type="button" data-testid="u-switch" @click="$emit(\'update:modelValue\', !modelValue)">{{ String(!!modelValue) }}</button>',
});

async function mountComponent() {
	return mount(Settings, {
		props: {
			screen: { id: 1 } as Screen,
			eventId: 1,
		},
		global: {
			stubs: {
				USwitch: USwitchStub,
				USelect: true,
				UInput: true,
				UInputNumber: true,
				UButton: true,
				USeparator: true,
				UIcon: true,
			},
		},
	});
}

/** A Screen that stored its columns before opponent archetype and game score existed. */
const storedBeforeNewColumns = [
	{ key: 'outcome', visible: true },
	{ key: 'round', visible: true },
	{ key: 'opponent', visible: true },
	{ key: 'table', visible: false },
];

describe('screenPlayerHistorySettings', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockConfig.value = {
			...getDefaultConfigForMode('player-history'),
			columns: storedBeforeNewColumns,
		};
	});

	it('offers opponent archetype and game score on a Screen that stored its columns before them', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		const labels = wrapper.findAll('[data-testid="column-label"]').map(label => label.text());
		expect(labels).toEqual([
			'Outcome',
			'Round',
			'Opponent',
			'Table',
			'Opponent archetype',
			'Game score',
		]);
		const switches = wrapper.findAll('[data-testid="column-row"] [data-testid="u-switch"]').map(toggle => toggle.text());
		expect(switches).toEqual([
			'true',
			'true',
			'true',
			'false',
			'false',
			'false',
		]);
	});

	it('enables a new column, keeping the stored order', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		await wrapper.findAll('[data-testid="column-row"] [data-testid="u-switch"]')[5]!.trigger('click');

		expect(mockUpdateConfig).toHaveBeenCalledWith({
			columns: [
				...storedBeforeNewColumns,
				{ key: 'opponentArchetype', visible: false },
				{ key: 'gameScore', visible: true },
			],
		});
	});
});
