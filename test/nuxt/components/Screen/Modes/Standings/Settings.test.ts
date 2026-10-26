import type { Screen } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, ref } from 'vue';
import { getDefaultConfigForMode } from '~~/shared/types/screenConfig';

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

const config = ref<Record<string, any>>({});
const writes: Record<string, unknown>[] = [];

mockNuxtImport('useModeConfigUpdate', () => () => ({
	config: computed(() => config.value),
	saving: ref(false),
	updateConfig: (patch: Record<string, unknown>) => {
		writes.push(patch);
		config.value = {
			...config.value,
			...patch,
		};
	},
	resetConfig: vi.fn(),
}));

const loaded = {
	isLoaded: true,
	$reset: vi.fn(),
};
mockNuxtImport('usePlayerStore', () => () => ({
	...loaded,
	players: [],
	loadPlayersByEventId: vi.fn(),
}));
mockNuxtImport('usePlayerListStore', () => () => ({
	...loaded,
	lists: [],
	loadByEventId: vi.fn(),
}));
mockNuxtImport('useRoundStore', () => () => ({
	...loaded,
	rounds: [],
	loadRoundsByEventId: vi.fn(),
}));

const USwitchStub = defineComponent({
	props: {
		modelValue: { type: Boolean, required: false },
	},
	emits: ['update:modelValue'],
	template: '<button type="button" data-testid="u-switch" @click="$emit(\'update:modelValue\', !modelValue)" />',
});

async function mountSettings() {
	const { default: Settings } = await import('../../../../../../app/components/Screen/Modes/Standings/Settings.vue');
	const wrapper = mount(Settings, {
		props: {
			screen: { id: 1 } as Screen,
			eventId: 1,
		},
		global: {
			stubs: { USwitch: USwitchStub, UIcon: true },
		},
	});
	await flushPromises();
	return wrapper;
}

function columnLabels(wrapper: Awaited<ReturnType<typeof mountSettings>>) {
	return wrapper.findAll('[data-testid="column-label"]').map(label => label.text());
}

describe('the Standings settings editor\'s columns', () => {
	beforeEach(() => {
		writes.length = 0;
		config.value = structuredClone(getDefaultConfigForMode('standings'));
	});

	it('offers the Position Change column', async () => {
		const wrapper = await mountSettings();

		expect(columnLabels(wrapper)).toContain('Position Change');
	});

	it('offers the Position Change column to a Screen whose stored columns predate it, and shows it on request', async () => {
		config.value.columns = [
			{ key: 'name', visible: true },
			{ key: 'position', visible: true },
			{ key: 'record', visible: false },
			{ key: 'points', visible: true },
			{ key: 'deck', visible: false },
		];

		const wrapper = await mountSettings();
		const rows = wrapper.findAll('[data-testid="column-row"]');

		expect(columnLabels(wrapper)).toEqual([
			'Name',
			'#',
			'Record (W-L-D)',
			'Points',
			'Deck',
			'Position Change',
		]);

		await rows[5]!.get('[data-testid="u-switch"]').trigger('click');

		expect(writes.at(-1)).toMatchObject({
			columns: [
				{ key: 'name', visible: true },
				{ key: 'position', visible: true },
				{ key: 'record', visible: false },
				{ key: 'points', visible: true },
				{ key: 'deck', visible: false },
				{ key: 'positionChange', visible: true },
			],
		});
	});
});
