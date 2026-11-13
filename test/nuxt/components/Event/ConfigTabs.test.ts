import type { Game, Variant } from '~~/shared/types/enums';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { reactive } from 'vue';
import { nuxtUiStubs, UNavigationMenuStub } from '~~/test/nuxt/helpers/nuxtUiStubs';
import ConfigTabs from '~/components/Event/ConfigTabs.vue';

const mockEventStore = reactive({
	event: { id: 7, game: 'mtg' as Game, variant: null as Variant | null },
});

mockNuxtImport('useEventStore', () => () => mockEventStore);

function tabLabels(game: Game, variant: Variant | null) {
	Object.assign(mockEventStore.event, { game, variant });
	const wrapper = mount(ConfigTabs, {
		props: { eventId: 7 },
		global: {
			stubs: { ...nuxtUiStubs, UNavigationMenu: UNavigationMenuStub },
		},
	});
	return wrapper.findAll('a').map(link => link.text());
}

describe('event config tabs', () => {
	// Neither an OP Event (ADR-0057) nor a Commander Event (ADR-0087) models Rounds
	// or runs Melee Sync, so Event Structure and Integrations are not offered.
	it.each([
		[
			'mtg',
			'two-player',
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
			null,
			[
				'Event',
				'Feature Matches',
				'Broadcast',
			],
		],
		[
			'mtg',
			'commander',
			[
				'Event',
				'Feature Matches',
				'Broadcast',
			],
		],
	] as const)('on a %s Event of Variant %s, offers %j', (game, variant, tabs) => {
		expect(tabLabels(game, variant)).toEqual(tabs);
	});
});
