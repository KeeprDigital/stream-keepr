import type { Screen } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { getDefaultConfigForMode } from '~~/shared/types/screenConfig';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
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

async function mountComponent() {
	const wrapper = mount(Settings, {
		props: {
			screen: { id: 1 } as Screen,
			eventId: 1,
		},
		global: {
			stubs: { ...nuxtUiStubs, ScreenSettingsToggle: true },
		},
	});
	await flushPromises();
	return wrapper;
}

type Wrapper = Awaited<ReturnType<typeof mountComponent>>;

/** Choose the option whose value is `value`, as the kit's select keys it. */
async function pick(wrapper: Wrapper, testId: string, value: number) {
	await wrapper.get(`select[data-testid="${testId}"]`).setValue(String(value));
}

/** The labels of the options a select offers, its placeholder aside. */
const offered = (wrapper: Wrapper, testId: string) => wrapper.findAll(`select[data-testid="${testId}"] option:not([hidden])`).map(option => option.text());

describe('screenTalentSettings', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockConfig.value = {
			...getDefaultConfigForMode('talent'),
		};
	});

	it('picks one Talent of the Event', async () => {
		const wrapper = await mountComponent();

		expect(offered(wrapper, 'talent-one')).toEqual([
			'Select a Talent…',
			'Host',
			'Caster',
			'Analyst',
		]);
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
		expect(offered(wrapper, 'talent-lineup-add')).toEqual(['Host', 'Analyst']);
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

	it('shows the Supported Social Networks in catalog order, writing the choice in that order', async () => {
		mockConfig.value = {
			...mockConfig.value,
			socialNetworks: ['bluesky', 'twitch'],
		};
		const wrapper = await mountComponent();
		const boxes = wrapper.findAll('[role="checkbox"]');

		expect(boxes.map(box => [
			box.text(),
			box.attributes('aria-checked') === 'true',
		])).toEqual([
			['Twitch', true],
			['YouTube', false],
			['X', false],
			['Instagram', false],
			['TikTok', false],
			['Bluesky', true],
		]);
		await boxes[2]!.trigger('click');

		expect(mockUpdateConfig).toHaveBeenCalledWith({
			socialNetworks: ['twitch', 'x', 'bluesky'],
		});
	});
});
