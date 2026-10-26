import type { Screen } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { getDefaultConfigForMode } from '~~/shared/types/screenConfig';

const mockConfig = ref<Record<string, any>>({});
const mockUpdateConfig = vi.fn((patch: Record<string, unknown>) => {
	mockConfig.value = {
		...mockConfig.value,
		...patch,
	};
});

mockNuxtImport('usePlayerStore', () => () => ({
	players: [
		{ id: 7, name: 'Nadia Rivers' },
		{ id: 8, name: 'Oskar Lind' },
	],
	isLoaded: true,
	loadPlayersByEventId: vi.fn(),
}));
mockNuxtImport('useFeatureMatchStore', () => () => ({
	loadFeatureMatchesByEventId: vi.fn(),
}));
mockNuxtImport('useFeatureMatchMenuItems', () => () => ref([
	{ label: 'Table 1', value: 4 },
	{ label: 'Table 2', value: 5 },
]));
mockNuxtImport('useModeConfigUpdate', () => () => ({
	config: mockConfig,
	saving: ref(false),
	updateConfig: mockUpdateConfig,
	resetConfig: vi.fn(),
}));

/** A select that names its field and offers its items' values, and picks the given value when told to. */
const USelectStub = defineComponent({
	props: {
		modelValue: { type: null, required: false },
		items: { type: Array, required: false },
	},
	emits: ['update:modelValue'],
	setup(props, { attrs, emit }) {
		return () => h('select', {
			'data-testid': attrs['data-testid'],
			'data-values': JSON.stringify((props.items as { value: unknown }[] | undefined ?? []).map(item => item.value)),
			'data-value': JSON.stringify(props.modelValue ?? null),
			'onChange': (event: Event) => emit('update:modelValue', JSON.parse((event.target as HTMLSelectElement).dataset.pick!)),
		});
	},
});

async function mountComponent() {
	const componentPath = '../../../../../../app/components/Screen/Modes/HeadToHead/Settings.vue';
	const { default: Settings } = await import(componentPath);

	const wrapper = mount(Settings, {
		props: {
			screen: { id: 1 } as Screen,
			eventId: 1,
		},
		global: {
			stubs: { USelect: USelectStub, UInput: true, ScreenSettingsToggle: true },
		},
	});
	await flushPromises();
	return wrapper;
}

async function pick(wrapper: Awaited<ReturnType<typeof mountComponent>>, testId: string, value: unknown) {
	const select = wrapper.get(`[data-testid="${testId}"]`);
	(select.element as unknown as HTMLElement).dataset.pick = JSON.stringify(value);
	await select.trigger('change');
}

describe('screenHeadToHeadSettings', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockConfig.value = {
			...getDefaultConfigForMode('head-to-head'),
		};
	});

	it('binds the Screen to a Feature Match Slot of the Event', async () => {
		const wrapper = await mountComponent();

		expect(JSON.parse(wrapper.get('[data-testid="head-to-head-slot"]').attributes('data-values')!)).toEqual([4, 5]);
		expect(wrapper.find('[data-testid="head-to-head-player-1"]').exists()).toBe(false);

		await pick(wrapper, 'head-to-head-slot', 5);

		expect(mockUpdateConfig).toHaveBeenCalledWith({ featureMatchId: 5 });
	});

	it('switches to picking two Players of the Event, keeping the Slot for switching back', async () => {
		mockConfig.value = { ...mockConfig.value, featureMatchId: 4 };
		const wrapper = await mountComponent();

		await pick(wrapper, 'head-to-head-source', 'players');
		expect(mockUpdateConfig).toHaveBeenCalledWith({ playerSource: 'players' });
		await flushPromises();

		expect(wrapper.find('[data-testid="head-to-head-slot"]').exists()).toBe(false);
		for (const testId of ['head-to-head-player-1', 'head-to-head-player-2'])
			expect(JSON.parse(wrapper.get(`[data-testid="${testId}"]`).attributes('data-values')!)).toEqual([null, 7, 8]);

		await pick(wrapper, 'head-to-head-player-1', 8);
		await pick(wrapper, 'head-to-head-player-2', 7);

		expect(mockUpdateConfig).toHaveBeenCalledWith({ player1Id: 8 });
		expect(mockUpdateConfig).toHaveBeenCalledWith({ player2Id: 7 });
		expect(mockUpdateConfig).not.toHaveBeenCalledWith(expect.objectContaining({
			featureMatchId: expect.anything(),
		}));
	});

	it('clears a picked Player as the deletion that reads as none', async () => {
		mockConfig.value = { ...mockConfig.value, playerSource: 'players', player1Id: 7 };
		const wrapper = await mountComponent();

		await pick(wrapper, 'head-to-head-player-1', null);

		expect(mockUpdateConfig).toHaveBeenCalledWith({ player1Id: null });
	});
});
