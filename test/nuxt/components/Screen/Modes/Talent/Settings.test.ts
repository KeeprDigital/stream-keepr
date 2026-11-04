import type { Screen } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { getDefaultConfigForMode } from '~~/shared/types/screenConfig';
import Settings from '~/components/Screen/Modes/Talent/Settings.vue';

enableAutoUnmount(afterEach);

const mockConfig = ref<Record<string, any>>({});
const mockUpdateConfig = vi.fn((patch: Record<string, unknown>) => {
	mockConfig.value = {
		...mockConfig.value,
		...patch,
	};
});

const HOST = 7;
const CASTER = 8;
const ANALYST = 9;
mockNuxtImport('useEventStore', () => () => ({
	event: {
		id: 1,
		talents: [
			{ id: HOST, name: 'Host' },
			{ id: CASTER, name: 'Caster' },
			{ id: ANALYST, name: 'Analyst' },
		],
	},
}));
mockNuxtImport('useModeConfigUpdate', () => () => ({
	config: mockConfig,
	saving: ref(false),
	updateConfig: mockUpdateConfig,
	resetConfig: vi.fn(),
}));

/** A select that offers its items' values, and picks the given value when told to. */
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
			'onChange': (event: Event) => emit('update:modelValue', JSON.parse((event.target as HTMLSelectElement).dataset.pick!)),
		});
	},
});

const UButtonStub = defineComponent({
	props: {
		disabled: { type: Boolean, required: false },
	},
	emits: ['click'],
	setup(props, { attrs, emit }) {
		return () => h('button', {
			'aria-label': attrs['aria-label'],
			'disabled': props.disabled,
			'onClick': () => emit('click'),
		});
	},
});

const UCheckboxStub = defineComponent({
	props: {
		modelValue: { type: Boolean, required: false },
		label: { type: String, required: false },
	},
	emits: ['update:modelValue'],
	setup(props, { emit }) {
		return () => h('input', {
			'type': 'checkbox',
			'aria-label': props.label,
			'checked': props.modelValue,
			'onChange': () => emit('update:modelValue', !props.modelValue),
		});
	},
});

async function mountComponent() {
	const wrapper = mount(Settings, {
		props: {
			screen: { id: 1 } as Screen,
			eventId: 1,
		},
		global: {
			stubs: {
				USelect: USelectStub,
				UButton: UButtonStub,
				UCheckbox: UCheckboxStub,
				UInput: true,
				UInputNumber: true,
				ScreenSettingsToggle: true,
			},
		},
	});
	await flushPromises();
	return wrapper;
}

type Wrapper = Awaited<ReturnType<typeof mountComponent>>;

async function pick(wrapper: Wrapper, testId: string, value: unknown) {
	const select = wrapper.get(`[data-testid="${testId}"]`);
	(select.element as unknown as HTMLElement).dataset.pick = JSON.stringify(value);
	await select.trigger('change');
}

const offered = (wrapper: Wrapper, testId: string) => JSON.parse(wrapper.get(`[data-testid="${testId}"]`).attributes('data-values')!);

describe('screenTalentSettings', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockConfig.value = {
			...getDefaultConfigForMode('talent'),
		};
	});

	it('picks one Talent of the Event', async () => {
		const wrapper = await mountComponent();

		expect(offered(wrapper, 'talent-one')).toEqual([null, HOST, CASTER, ANALYST]);
		await pick(wrapper, 'talent-one', CASTER);

		expect(mockUpdateConfig).toHaveBeenCalledWith({ talentId: CASTER });
	});

	it('builds a lineup in order from the Talents not yet in it', async () => {
		mockConfig.value = {
			...mockConfig.value,
			selection: 'lineup',
			talentIds: [CASTER],
		};
		const wrapper = await mountComponent();

		expect(wrapper.findAll('[data-lineup-talent]').map(row => row.text())).toEqual(['Caster']);
		expect(offered(wrapper, 'talent-lineup-add')).toEqual([HOST, ANALYST]);
		await pick(wrapper, 'talent-lineup-add', HOST);

		expect(mockUpdateConfig).toHaveBeenCalledWith({
			talentIds: [CASTER, HOST],
		});
	});

	it.each([
		[
			'Move Caster up',
			[CASTER, HOST, ANALYST],
		],
		[
			'Move Caster down',
			[HOST, ANALYST, CASTER],
		],
		[
			'Remove Caster',
			[HOST, ANALYST],
		],
	])('%s', async (action, talentIds) => {
		mockConfig.value = {
			...mockConfig.value,
			selection: 'lineup',
			talentIds: [HOST, CASTER, ANALYST],
		};
		const wrapper = await mountComponent();

		await wrapper.get(`button[aria-label="${action}"]`).trigger('click');

		expect(mockUpdateConfig).toHaveBeenCalledWith({ talentIds });
	});

	it('names a lineup Talent the Event no longer lists, so it can be removed', async () => {
		mockConfig.value = {
			...mockConfig.value,
			selection: 'lineup',
			talentIds: [42],
		};
		const wrapper = await mountComponent();

		expect(wrapper.findAll('[data-lineup-talent]').map(row => row.text())).toEqual(['Unknown Talent']);
	});

	it('shows the Supported Social Networks in catalogue order, writing the choice in that order', async () => {
		mockConfig.value = {
			...mockConfig.value,
			socialNetworks: ['bluesky', 'twitch'],
		};
		const wrapper = await mountComponent();
		const boxes = wrapper.findAll('input[type="checkbox"]');

		expect(boxes.map(box => [
			box.attributes('aria-label'),
			(box.element as HTMLInputElement).checked,
		])).toEqual([
			['Twitch', true],
			['YouTube', false],
			['X', false],
			['Instagram', false],
			['TikTok', false],
			['Bluesky', true],
		]);
		await boxes[2]!.trigger('change');

		expect(mockUpdateConfig).toHaveBeenCalledWith({
			socialNetworks: ['twitch', 'x', 'bluesky'],
		});
	});
});
