import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, reactive } from 'vue';
import { createMockPlayer } from '~~/test/helpers/fixtures';
import PlayerMatchHistoryButton from '~/components/Player/MatchHistoryButton.vue';

const { mockFetch, modals } = vi.hoisted(() => ({
	mockFetch: vi.fn(),
	modals: [] as { open: ReturnType<typeof vi.fn>; patch: ReturnType<typeof vi.fn> }[],
}));

mockNuxtImport('$fetch', () => mockFetch);
mockNuxtImport('useOverlay', () => () => ({
	create: () => {
		const modal = {
			open: vi.fn(),
			patch: vi.fn(),
		};
		modals.push(modal);
		return modal;
	},
}));
mockNuxtImport('useEventStore', () => () => reactive({ eventId: 1 }));
mockNuxtImport('useToast', () => () => ({
	add: vi.fn(),
}));

const alice = createMockPlayer({ id: 7, name: 'Alice' }) as never;
const bob = createMockPlayer({ id: 8, name: 'Bob' }) as never;

function mountNames(players: unknown[], name?: string) {
	return mount(defineComponent({
		components: { PlayerMatchHistoryButton },
		setup: () => ({ players, name }),
		template: '<div><PlayerMatchHistoryButton v-for="(player, i) in players" :key="i" :player="player" :name="name" /></div>',
	}));
}

/** The Players each modal was opened for, per modal that was opened at all. */
function openedPlayers() {
	return modals
		.filter(modal => modal.open.mock.calls.length > 0)
		.map(modal => modal.open.mock.calls.map(([props]) => props.player.name));
}

enableAutoUnmount(afterEach);

describe('player match history button', () => {
	beforeEach(() => {
		modals.length = 0;
		mockFetch.mockReset();
		mockFetch.mockReturnValue(new Promise(() => {}));
	});

	it('opens the Player\'s match history from their name', async () => {
		const wrapper = mountNames([alice]);

		const button = wrapper.get('button');
		expect(button.text()).toBe('Alice');
		await button.trigger('click');

		expect(openedPlayers()).toEqual([
			['Alice'],
		]);
		expect(mockFetch).toHaveBeenCalledWith('/api/events/1/players/7/match-history');
	});

	it('opens every name into one modal, so a second Player replaces the first', async () => {
		const wrapper = mountNames([alice, bob]);

		const [first, second] = wrapper.findAll('button');
		await first!.trigger('click');
		await second!.trigger('click');

		expect(openedPlayers()).toEqual([
			['Alice', 'Bob'],
		]);
	});

	it.each([
		[
			'the Player\'s',
			alice,
			undefined,
			'Alice',
			true,
		],
		[
			'a given',
			alice,
			'Alice (seat)',
			'Alice (seat)',
			true,
		],
		[
			'a Player-less',
			null,
			'TBD',
			'TBD',
			false,
		],
	])('shows %s name, as a button only when a Player is behind it', (_, player, name, text, clickable) => {
		const wrapper = mountNames([player], name);

		expect(wrapper.text()).toBe(text);
		expect(wrapper.find('button').exists()).toBe(clickable);
	});
});
