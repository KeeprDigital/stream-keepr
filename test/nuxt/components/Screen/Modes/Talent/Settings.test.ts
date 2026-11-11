import type { Screen } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { getDefaultConfigForMode } from '~~/shared/types/screenConfig';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import { screenSettingsCardSpies, settingsCards, settingsCardSummary } from '~~/test/nuxt/helpers/screenSettingsCards';
import Settings from '~/components/Screen/Modes/Talent/Settings.vue';

// The Talent Screen's settings: who it shows, then its layout, header and
// Social Profiles, each card ending with the Look of what it styles (#983).

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
			stubs: {
				...nuxtUiStubs,
				...screenSettingsCardSpies,
			},
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

	// Every element it paints has a Foundation role, so no card holds a Look.
	it('orders its cards Talent, Layout, Header, Social Profiles', async () => {
		const wrapper = await mountComponent();

		expect(settingsCards(wrapper)).toEqual([
			{
				title: 'Talent',
				id: 'talent:talent',
				collapsible: false,
				looks: [],
			},
			{
				title: 'Layout',
				id: 'talent:layout',
				collapsible: true,
				looks: [],
			},
			{
				title: 'Header',
				id: 'talent:header',
				collapsible: true,
				looks: [],
			},
			{
				title: 'Social Profiles',
				id: 'talent:social-profiles',
				collapsible: true,
				looks: [],
			},
		]);
	});

	it.each([
		[
			'selection',
			{},
			'select',
			'lineup',
			{ selection: 'lineup' },
		],
		[
			'layout',
			{},
			'select',
			'fullPanel',
			{ layout: 'fullPanel' },
		],
		[
			'showPhoto',
			{},
			'switch',
			undefined,
			{ showPhoto: false },
		],
		[
			'showRole',
			{},
			'switch',
			undefined,
			{ showRole: false },
		],
		[
			'rotateSocialProfiles',
			{},
			'switch',
			undefined,
			{ rotateSocialProfiles: true },
		],
		[
			'socialProfileDwellMs',
			{ rotateSocialProfiles: true },
			'input',
			'12',
			{ socialProfileDwellMs: 12000 },
		],
		[
			'showHeader',
			{},
			'switch',
			undefined,
			{ showHeader: true },
		],
		[
			'headerText',
			{ showHeader: true, headerText: 'Desk' },
			'input',
			'',
			{ headerText: null },
		],
	] as const)('writes %s through its contract field', async (key, stored, control, value, written) => {
		mockConfig.value = {
			...mockConfig.value,
			...stored,
		};
		const wrapper = await mountComponent();
		const field = wrapper.get(`[data-config-field="${key}"]`);

		if (control === 'switch')
			await field.get('[role="switch"]').trigger('click');
		else
			await field.get(control).setValue(value);

		expect(mockUpdateConfig).toHaveBeenCalledWith(written);
	});

	it.each([
		[
			'socialProfileDwellMs',
			{ rotateSocialProfiles: false },
		],
		[
			'headerText',
			{ showHeader: false },
		],
	] as const)('hides %s while the control revealing it is off', async (key, stored) => {
		mockConfig.value = {
			...mockConfig.value,
			...stored,
		};
		const wrapper = await mountComponent();

		expect(wrapper.find(`[data-config-field="${key}"]`).exists()).toBe(false);
	});

	it.each([
		['Layout', {}, 'Lower third · Photo · Role'],
		[
			'Layout',
			{ layout: 'fullPanel', showPhoto: false, showRole: false },
			'Full panel',
		],
		['Header', {}, 'Hidden'],
		[
			'Header',
			{ showHeader: true },
			'On the Desk',
		],
		[
			'Header',
			{ showHeader: true, headerText: 'Commentary' },
			'Commentary',
		],
		[
			'Social Profiles',
			{
				socialNetworks: ['twitch', 'x'],
			},
			'2 networks',
		],
		[
			'Social Profiles',
			{
				socialNetworks: ['twitch'],
				rotateSocialProfiles: true,
				socialProfileDwellMs: 5000,
			},
			'1 network · one at a time, 5 s each',
		],
		[
			'Social Profiles',
			{ socialNetworks: [] },
			'None shown',
		],
	] as const)('summarises %s when closed: %o', async (title, stored, summary) => {
		mockConfig.value = {
			...mockConfig.value,
			...stored,
		};
		const wrapper = await mountComponent();

		expect(settingsCardSummary(wrapper, title)).toBe(summary);
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
