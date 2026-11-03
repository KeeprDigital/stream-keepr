import type { Screen } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { getDefaultConfigForMode } from '~~/shared/types/screenConfig';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
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
mockNuxtImport('useModeConfigUpdate', () => () => ({
	config: ref(getDefaultConfigForMode('archetype-spotlight')),
	saving: ref(false),
	updateConfig: vi.fn(),
	resetConfig: vi.fn(),
}));

describe('the Archetype Spotlight settings editor', () => {
	// The Conversion Target is the Event's (ADR-0061): the Screen names it and where to change it.
	it('shows its Event\'s Conversion Target read-only, linking to the Metagame page', async () => {
		const wrapper = mount(Settings, {
			props: {
				screen: { id: 1 } as Screen,
				eventId: 1,
			},
			global: {
				stubs: {
					...nuxtUiStubs,
					NuxtLink: {
						props: ['to'],
						template: '<a :href="to"><slot /></a>',
					},
				},
			},
		});
		await flushPromises();

		expect(wrapper.get('[data-testid="event-conversion-target"]').text()).toBe('Top 16');
		expect(wrapper.get('[data-testid="event-conversion-target-link"]').attributes('href')).toBe('/event/1/metagame');
		expect(wrapper.text()).not.toContain('Conversion threshold');
	});
});
