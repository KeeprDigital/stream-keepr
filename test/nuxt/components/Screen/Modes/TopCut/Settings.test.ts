import type { Screen } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, h, ref } from 'vue';
import { getDefaultConfigForMode } from '~~/shared/types/screenConfig';

/** The Top Cut settings editor picks the Phase of the Screen's Event its bracket is derived from (#752). */

const config = ref<Record<string, unknown>>({});
const writes: Record<string, unknown>[] = [];
const phaseStore = {
	isLoaded: false,
	phases: [
		{ id: 4, eventId: 1, name: 'Top 8', sortOrder: 2 },
		{ id: 3, eventId: 1, name: 'Swiss', sortOrder: 1 },
	],
	loadPhasesByEventId: vi.fn(),
	$reset: vi.fn(),
};

mockNuxtImport('useModeConfigUpdate', () => () => ({
	config: computed(() => config.value),
	saving: ref(false),
	updateConfig: (patch: Record<string, unknown>) => {
		writes.push(patch);
		config.value = { ...config.value, ...patch };
	},
	resetConfig: vi.fn(),
}));
mockNuxtImport('usePhaseStore', () => () => phaseStore);

const USelectStub = defineComponent({
	props: { modelValue: { type: null, required: false }, items: { type: Array, required: true } },
	emits: ['update:modelValue'],
	setup(props, { emit }) {
		// Choosing the Top 8 Phase.
		return () => h('select', { 'data-items': JSON.stringify(props.items), 'onChange': () => emit('update:modelValue', 4) });
	},
});

async function mountEditor() {
	const { default: Settings } = await import('../../../../../../app/components/Screen/Modes/TopCut/Settings.vue');
	const wrapper = mount(Settings, {
		props: { screen: { id: 1 } as Screen, eventId: 1 },
		global: {
			stubs: {
				ScreenSettingsCard: defineComponent({ setup: (_, { slots }) => () => h('section', slots.default?.()) }),
				ScreenSettingsToggle: true,
				UFormField: defineComponent({ setup: (_, { slots }) => () => h('div', slots.default?.()) }),
				USelect: USelectStub,
				UInput: true,
			},
		},
	});
	await flushPromises();
	return wrapper;
}

describe('screenModesTopCutSettings', () => {
	beforeEach(() => {
		config.value = { ...getDefaultConfigForMode('topCut') };
		writes.length = 0;
		phaseStore.loadPhasesByEventId.mockClear();
	});

	it('offers the Event\'s Phases in their order, loading them when the store holds none', async () => {
		const wrapper = await mountEditor();

		expect(phaseStore.loadPhasesByEventId).toHaveBeenCalledWith(1);
		expect(JSON.parse(wrapper.find('select').attributes('data-items')!)).toEqual([
			{ label: 'Select a phase…', value: null },
			{ label: 'Swiss', value: 3 },
			{ label: 'Top 8', value: 4 },
		]);
	});

	it('writes the picked Phase as the Screen\'s phaseId', async () => {
		const wrapper = await mountEditor();
		await wrapper.find('select').trigger('change');

		expect(writes.at(-1)).toEqual({ phaseId: 4 });
	});
});
