import type { Game } from '~~/shared/types/enums';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { reactive } from 'vue';
import { nuxtUiStubs, UNavigationMenuStub } from '~~/test/nuxt/helpers/nuxtUiStubs';
import ConfigTabs from '~/components/Event/ConfigTabs.vue';

const mockEventStore = reactive({
	event: { id: 7, game: 'mtg' as Game },
});

mockNuxtImport('useEventStore', () => () => mockEventStore);

function tabLabels(game: Game) {
	mockEventStore.event.game = game;
	const wrapper = mount(ConfigTabs, {
		props: { eventId: 7 },
		global: {
			stubs: { ...nuxtUiStubs, UNavigationMenu: UNavigationMenuStub },
		},
	});
	return wrapper.findAll('a').map(link => link.text());
}

describe('event config tabs', () => {
	// An OP Event models no Rounds and never runs Melee Sync (ADR-0057), so Event
	// Structure and Integrations are not offered.
	it.each([
		[
			'mtg',
			[
				'Event',
				'Event Structure',
				'Feature Matches',
				'Broadcast',
				'Integrations',
			],
		],
		[
			'op',
			[
				'Event',
				'Feature Matches',
				'Broadcast',
			],
		],
	] as const)('on a %s Event, offers %j', (game, tabs) => {
		expect(tabLabels(game)).toEqual(tabs);
	});
});
