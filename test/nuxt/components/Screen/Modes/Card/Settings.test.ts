import type { Screen } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { getDefaultConfigForMode } from '~~/shared/types/screenConfig';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import { screenSettingsLayoutStubs, settingsLayout, settingsSummaries } from '~~/test/nuxt/helpers/screenSettingsLayout';
import Settings from '~/components/Screen/Modes/Card/Settings.vue';

// Card Spotlight's settings: its Feature Match Slot, then its Card with the card's motion beside its width.

enableAutoUnmount(afterEach);

const config = ref<Record<string, any>>({});
const writes: Record<string, unknown>[] = [];

mockNuxtImport('useModeConfigUpdate', () => () => ({
	config,
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
mockNuxtImport('useFeatureMatchStore', () => () => ({
	loadFeatureMatchesByEventId: vi.fn(),
}));
mockNuxtImport('useFeatureMatchMenuItems', () => () => ref([
	{
		value: 4,
		label: 'Feature Match 1',
		player1DeckName: 'Burn',
		player2DeckName: 'Tron',
	},
]));

beforeEach(() => {
	writes.length = 0;
	config.value = structuredClone(getDefaultConfigForMode('card'));
});

async function mountSettings() {
	const wrapper = mount(Settings, {
		props: {
			screen: { id: 1 } as Screen,
			eventId: 1,
		},
		global: {
			stubs: {
				...nuxtUiStubs,
				...screenSettingsLayoutStubs,
				MtgManaColorDisplay: true,
			},
		},
	});
	await flushPromises();
	return wrapper;
}

describe('the Card Spotlight settings editor', () => {
	it('shows its Feature Match Slot open, then a collapsible Card holding its motion', async () => {
		const wrapper = await mountSettings();

		expect(settingsLayout(wrapper)).toEqual([
			{
				id: 'card:feature-match-slot',
				title: 'Source',
				collapsible: false,
				groups: [],
			},
			{
				id: 'card:card',
				title: 'Card',
				collapsible: true,
				groups: ['card'],
			},
		]);
		expect(settingsSummaries(wrapper)).toEqual({ 'card:card': `${config.value.cardWidth} px wide` });
	});

	it.each([
		[
			'links a match',
			4,
			{ featureMatchId: 4 },
		],
		[
			'unlinks it',
			'',
			{ featureMatchId: null },
		],
	] as const)('%s as the Event Reference write', async (_case, value, written) => {
		config.value.featureMatchId = 4;
		const wrapper = await mountSettings();

		// Named as Feature Match Controls names its Slot picker.
		expect(wrapper.get('[data-settings-card="card:feature-match-slot"] label > span').text()).toBe('Feature Match Slot');
		await wrapper.get('select').setValue(String(value));

		expect(writes).toEqual([written]);
	});

	it('writes the card width', async () => {
		const wrapper = await mountSettings();

		await wrapper.get('[data-config-field="cardWidth"] input').setValue('400');

		expect(writes).toEqual([
			{ cardWidth: 400 },
		]);
	});
});
