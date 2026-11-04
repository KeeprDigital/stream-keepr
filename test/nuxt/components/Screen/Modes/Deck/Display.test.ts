import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { computed, defineComponent, h, reactive, ref } from 'vue';
import Display from '~/components/Screen/Modes/Deck/Display.vue';

// A Deck List Screen lays out its Deck List by its Event's Card Game: a One
// Piece Player or Slot side in the One Piece layout, a Magic deck in Magic's.

const eventStore = reactive({ displayEvent: null as { game: string } | null });
mockNuxtImport('useEventStore', () => () => eventStore);

function mountDisplay(deckSource: Record<string, unknown>, options: { game?: string; sampleDataset?: 'mtg' | 'op' } = {}) {
	eventStore.displayEvent = options.game
		? { game: options.game }
		: null;
	const Parent = defineComponent({
		setup() {
			provideScreenContext({
				screen: ref({
					id: 42,
					modeConfigs: {
						deck: { deckSource },
					},
				} as never),
				eventId: computed(() => 7),
				interactive: ref(false),
				overlayContainer: ref(null),
				sampleDataset: options.sampleDataset,
			});
			return () => h(Display);
		},
	});
	return mount(Parent, {
		global: {
			stubs: {
				ScreenModesDeckOpDisplay: { template: '<div data-layout="op" />' },
				ScreenModesDeckMtgDisplay: { template: '<div data-layout="mtg" />' },
			},
		},
	});
}

describe('the Deck List Screen Mode', () => {
	it.each([
		{
			name: 'a One Piece Player',
			source: { type: 'player', playerId: 31 },
			options: { game: 'op' },
			layout: 'op',
		},
		{
			name: 'a One Piece Slot side',
			source: { type: 'featureMatchSlot', slotId: 11, side: 'player1' },
			options: { game: 'op' },
			layout: 'op',
		},
		{
			name: 'a One Piece Theme preview',
			source: { type: 'featureMatchSlot', slotId: 1, side: 'player1' },
			options: { sampleDataset: 'op' as const },
			layout: 'op',
		},
		{
			name: 'a Magic Player',
			source: { type: 'player', playerId: 31 },
			options: { game: 'mtg' },
			layout: 'mtg',
		},
		{
			name: 'a Magic Theme preview',
			source: { type: 'player', playerId: 1 },
			options: { sampleDataset: 'mtg' as const },
			layout: 'mtg',
		},
	])('lays out $name in the $layout layout', ({ source, options, layout }) => {
		const wrapper = mountDisplay(source, options);

		expect(wrapper.find('[data-layout]').attributes('data-layout')).toBe(layout);
	});
});
