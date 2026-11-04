import type { Screen } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { getDefaultConfigForMode } from '~~/shared/types/screenConfig';
import { NuxtLinkStub, nuxtUiStubs, UFormFieldBesideStub } from '~~/test/nuxt/helpers/nuxtUiStubs';
import { screenSettingsLayoutStubs, settingsLayout, settingsSummaries } from '~~/test/nuxt/helpers/screenSettingsLayout';
import Settings from '~/components/Screen/Modes/ArchetypeSpotlight/Settings.vue';

enableAutoUnmount(afterEach);

vi.mock('~/modules/screen-mode/editorModeData', () => import('~~/test/helpers/editedScreenModeData'));

const loaded = {
	isLoaded: true,
	loadByEventId: vi.fn(),
	$reset: vi.fn(),
};
mockNuxtImport('useArchetypeStore', () => () => ({ ...loaded, archetypes: [] }));
mockNuxtImport('usePlayerListStore', () => () => ({ ...loaded, lists: [] }));
mockNuxtImport('useEventStore', () => () => ({
	event: { id: 1, conversionMetric: 'topN', conversionThreshold: 16 },
	$reset: vi.fn(),
}));
const { updateConfig } = vi.hoisted(() => ({
	updateConfig: vi.fn(),
}));
mockNuxtImport('useModeConfigUpdate', () => () => ({
	config: ref(getDefaultConfigForMode('archetype-spotlight')),
	saving: ref(false),
	updateConfig,
	resetConfig: vi.fn(),
}));

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
				UFormField: UFormFieldBesideStub,
				NuxtLink: NuxtLinkStub,
			},
		},
	});
	await flushPromises();
	return wrapper;
}

describe('the Archetype Spotlight settings editor', () => {
	beforeEach(() => {
		updateConfig.mockClear();
	});

	// Each Mode Token's Look sits in the card for what it styles (ADR-0071, #975).
	it('lays out Data, Top Cards, Pilots and Header, each holding its Look', async () => {
		const wrapper = await mountSettings();

		expect(settingsLayout(wrapper)).toEqual([
			{
				id: 'archetype-spotlight:data',
				title: 'Data',
				collapsible: false,
				groups: ['data'],
			},
			{
				id: 'archetype-spotlight:top-cards',
				title: 'Top Cards',
				collapsible: true,
				groups: ['top-cards'],
			},
			{
				id: 'archetype-spotlight:pilots',
				title: 'Pilots',
				collapsible: true,
				groups: ['pilots'],
			},
			{
				id: 'archetype-spotlight:header',
				title: 'Header',
				collapsible: true,
				groups: ['header'],
			},
		]);
		expect(settingsSummaries(wrapper)).toEqual({
			'archetype-spotlight:top-cards': 'Top 8 · Full Deck',
			'archetype-spotlight:pilots': '8 per page · Manual paging',
			'archetype-spotlight:header': 'Auto title',
		});
	});

	it.each([
		[
			'Top cards',
			'[data-config-field="cardLimit"] input',
			'5',
			{ cardLimit: 5 },
		],
		[
			'Board',
			'[data-config-field="board"] select',
			'sideboard',
			{ board: 'sideboard' },
		],
	] as const)('writes %s', async (_label, selector, value, written) => {
		const wrapper = await mountSettings();

		await wrapper.get(selector).setValue(value);

		expect(updateConfig).toHaveBeenCalledWith(written);
	});

	it('excludes a card type when its chip is toggled off', async () => {
		const wrapper = await mountSettings();

		const chip = wrapper.get('[data-testid="archetype-spotlight-type-Creature"]');
		expect(chip.attributes('aria-pressed')).toBe('true');
		await chip.trigger('click');

		expect(updateConfig).toHaveBeenCalledWith({
			excludedCardTypes: ['Land', 'Creature'],
		});
	});

	// The Conversion Target is the Event's (ADR-0061): the Screen names it and where to change it.
	it('shows its Event\'s Conversion Target read-only, linking to the Metagame page', async () => {
		const wrapper = await mountSettings();

		expect(wrapper.get('[data-testid="event-conversion-target"]').text()).toBe('Top 16');
		expect(wrapper.get('[data-testid="event-conversion-target-link"]').attributes('href')).toBe('/event/1/metagame');
		expect(wrapper.text()).not.toContain('Conversion threshold');
	});
});
