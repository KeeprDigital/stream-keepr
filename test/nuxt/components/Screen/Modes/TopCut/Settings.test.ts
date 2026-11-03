import type { Screen } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, h, ref } from 'vue';
import { TOP_CUT_BRACKET_SIZES } from '~~/shared/screenModeConfigs/topCut';
import { getDefaultConfigForMode } from '~~/shared/types/screenConfig';
import { UFormFieldStub, USelectStub } from '~~/test/nuxt/helpers/nuxtUiStubs';
import Settings from '~/components/Screen/Modes/TopCut/Settings.vue';

// Every mount reads the one shared config; a mount left behind re-renders on each later test's edit.
enableAutoUnmount(afterEach);

/**
 * The Top Cut Bracket settings editor picks the Phase of the Screen's Event its bracket
 * is derived from, its size, and whether each Player's Seed and Archetype show.
 */

/** A select's options, as their labels and the values they write. */
function options(wrapper: Awaited<ReturnType<typeof mountEditor>>, field: string) {
	return wrapper.findAll(`[data-field="${field}"] option`).map(option => [
		option.text(),
		option.attributes('value'),
	]);
}

const config = ref<Record<string, unknown>>({});
const writes: Record<string, unknown>[] = [];
const phaseStore = {
	isLoaded: false,
	phases: [
		{
			id: 4,
			eventId: 1,
			name: 'Top 8',
			sortOrder: 2,
		},
		{
			id: 3,
			eventId: 1,
			name: 'Swiss',
			sortOrder: 1,
		},
	],
	loadPhasesByEventId: vi.fn(),
	$reset: vi.fn(),
};

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
mockNuxtImport('usePhaseStore', () => () => phaseStore);

const ScreenSettingsToggleStub = defineComponent({
	props: {
		label: { type: String, required: true },
		modelValue: { type: Boolean, required: false },
	},
	emits: ['update:modelValue'],
	setup(props, { emit }) {
		return () => h('button', {
			'type': 'button',
			'data-testid': 'settings-toggle',
			'data-on': String(props.modelValue),
			'onClick': () => emit('update:modelValue', !props.modelValue),
		}, props.label);
	},
});

async function mountEditor() {
	const wrapper = mount(Settings, {
		props: {
			screen: { id: 1 } as Screen,
			eventId: 1,
		},
		global: {
			stubs: {
				ScreenSettingsCard: defineComponent({
					setup: (_, { slots }) => () => h('section', slots.default?.()),
				}),
				ScreenSettingsToggle: ScreenSettingsToggleStub,
				UFormField: UFormFieldStub,
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
		config.value = {
			...getDefaultConfigForMode('top-cut'),
		};
		writes.length = 0;
		phaseStore.loadPhasesByEventId.mockClear();
	});

	it('offers the Event\'s Phases in their order, loading them when the store holds none', async () => {
		const wrapper = await mountEditor();

		expect(phaseStore.loadPhasesByEventId).toHaveBeenCalledWith(1);
		expect(options(wrapper, 'phaseId')).toEqual([
			['Select a phase…', 'null'],
			['Swiss', '3'],
			['Top 8', '4'],
		]);
	});

	it('writes the picked Phase as the Screen\'s phaseId', async () => {
		const wrapper = await mountEditor();
		await wrapper.find('[data-field="phaseId"] select').setValue('4');

		expect(writes.at(-1)).toEqual({ phaseId: 4 });
	});

	it('offers the bracket sizes, sizing from the first Round until one is picked, and says a smaller one is ignored', async () => {
		const wrapper = await mountEditor();

		expect(options(wrapper, 'bracketSizeOverride').map(([, value]) => value)).toEqual([
			'null',
			...TOP_CUT_BRACKET_SIZES.map(String),
		]);
		expect(wrapper.find('[data-field="bracketSizeOverride"] p').text()).toMatch(/smaller .* ignored/);
	});

	it.each([
		[
			'8',
			{ bracketSizeOverride: 8 },
		],
		[
			'32',
			{ bracketSizeOverride: 32 },
		],
		[
			'null',
			{ bracketSizeOverride: null },
		],
	])('writes the picked size %s as the Screen\'s bracketSizeOverride', async (value, write) => {
		config.value = { ...config.value, bracketSizeOverride: 16 };
		const wrapper = await mountEditor();
		await wrapper.find('[data-field="bracketSizeOverride"] select').setValue(value);

		expect(writes.at(-1)).toEqual(write);
	});

	function toggle(wrapper: Awaited<ReturnType<typeof mountEditor>>, label: string) {
		return wrapper.findAll('[data-testid="settings-toggle"]').find(button => button.text() === label)!;
	}

	it('leaves seeds and Archetypes off for a Screen that never set them, so it renders as before', async () => {
		const wrapper = await mountEditor();

		expect(toggle(wrapper, 'Show Seeds').attributes('data-on')).toBe('false');
		expect(toggle(wrapper, 'Show Archetypes').attributes('data-on')).toBe('false');
	});

	it.each([
		['Show Seeds', 'showSeeds'],
		['Show Archetypes', 'showArchetypes'],
	])('writes %s as the Screen\'s %s', async (label, field) => {
		const wrapper = await mountEditor();

		await toggle(wrapper, label).trigger('click');
		expect(writes.at(-1)).toEqual({ [field]: true });
		await toggle(wrapper, label).trigger('click');
		expect(writes.at(-1)).toEqual({ [field]: false });
	});
});
