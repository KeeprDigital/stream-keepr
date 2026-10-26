import type { Screen } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import ScreenList from '~/components/Screen/List.vue';
import ScreenListItem from '~/components/Screen/ListItem.vue';

// The label is the identity, so a card bound to the wrong Screen shows the wrong mode.
vi.mock('~/modules/screen-mode', () => ({
	getScreenModeDisplayType: vi.fn(() => 'overlay'),
	getScreenModeIcon: vi.fn(() => 'i-lucide-monitor'),
	getScreenModeLabel: vi.fn((mode: string) => mode),
	getScreenModeSelectOptions: vi.fn(() => [
		{ label: 'Background', icon: 'i-lucide-wallpaper', value: 'background' },
		{ label: 'Standings', icon: 'i-lucide-list', value: 'standings' },
	]),
}));

enableAutoUnmount(afterEach);

const { apiFetch } = vi.hoisted(() => ({
	apiFetch: vi.fn(),
}));
mockNuxtImport('$fetch', () => apiFetch);
mockNuxtImport('useCopyToClipboard', () => () => ({
	copyToClipboard: vi.fn(),
}));
mockNuxtImport('useToast', () => () => ({
	add: vi.fn(),
}));
mockNuxtImport('navigateTo', () => vi.fn());

function makeScreen(fields: Pick<Screen, 'id' | 'name' | 'slug' | 'currentMode'>): Screen {
	return {
		eventId: 2,
		modeConfigs: null,
		screenConfig: null,
		stateVersion: 1,
		createdAt: new Date('2026-01-01T00:00:00.000Z'),
		updatedAt: new Date('2026-01-01T00:00:00.000Z'),
		...fields,
	};
}

const screens = [
	makeScreen({
		id: 4,
		name: 'Stage Left',
		slug: 'stage-left',
		currentMode: 'background',
	}),
	makeScreen({
		id: 7,
		name: 'Stage Right',
		slug: 'stage-right',
		currentMode: 'standings',
	}),
	makeScreen({
		id: 11,
		name: 'Feature Table',
		slug: 'feature-table',
		currentMode: 'card',
	}),
];

/** Screen 7 has no entry: presence arrives late, so "none yet" is the ordinary state. */
const connectedCounts = new Map([
	[4, 3],
	[11, 9],
]);

async function mountList(props: Record<string, unknown> = {}) {
	const wrapper = mount(ScreenList, {
		props: {
			loading: false,
			error: null,
			screens,
			eventId: 2,
			updatingScreenId: null,
			connectedCounts,
			...props,
		},
		// The real card mounts inside the list; only the shell around it is stubbed.
		global: {
			stubs: {
				...nuxtUiStubs,
				NuxtLink: { template: '<a><slot /></a>' },
				ScreenTypeBadge: true,
				UILoadingSpinner: { template: '<div data-testid="loading" />' },
			},
		},
	});
	await flushPromises();
	return wrapper;
}

type Wrapper = Awaited<ReturnType<typeof mountList>>;

const cards = (wrapper: Wrapper) => wrapper.findAllComponents(ScreenListItem);

async function choose(card: ReturnType<typeof cards>[number], label: string) {
	const items = card.findAllComponents({ name: 'UDropdownMenu' })
		.flatMap(menu => (menu.props('items') as Array<Array<{ label: string; onSelect: (event: Event) => void }>>).flat());
	items.find(item => item.label === label)!.onSelect(new Event('select'));
	await flushPromises();
}

describe('screen list', () => {
	it('renders one card per Screen, in order, each showing its own Screen', async () => {
		const wrapper = await mountList();

		expect(cards(wrapper).map(card => card.get('h4').text())).toEqual(['Stage Left', 'Stage Right', 'Feature Table']);
		expect(cards(wrapper).map(card => card.text())).toEqual([
			expect.stringContaining('background'),
			expect.stringContaining('standings'),
			expect.stringContaining('card'),
		]);
	});

	it('addresses every card under the list\'s Event', async () => {
		const wrapper = await mountList({ eventId: 2 });

		expect(cards(wrapper).map(card => card.get('p').text())).toEqual(
			screens.map(screen => `${window.location.origin}/event/2/screen/${screen.slug}`),
		);
	});

	it('gives each card its own connected count, and zero to a Screen with no entry', async () => {
		const wrapper = await mountList();

		expect(cards(wrapper).map(card => card.props('connectedCount'))).toEqual([3, 0, 9]);
	});

	// The last Screen, so a reversed list cannot pass.
	it('marks only the Screen being updated as busy', async () => {
		const wrapper = await mountList({ updatingScreenId: 11 });

		expect(cards(wrapper).map(card => card.find('[aria-busy="true"]').exists())).toEqual([false, false, true]);
	});

	// From cards other than the first, so a relay closed over the wrong Screen shows.
	it.each([
		[
			'an edit',
			1,
			'Edit Screen',
			'editScreen',
			[screens[1]],
		],
		[
			'a delete',
			2,
			'Delete Screen',
			'deleteScreen',
			[screens[2]],
		],
		[
			'a mode change',
			2,
			'Standings',
			'setMode',
			[screens[2], 'standings'],
		],
		[
			'a command',
			1,
			'Identify',
			'sendCommand',
			[screens[1], 'identify'],
		],
	] as const)('reports %s against the Screen whose card asked for it', async (_, index, label, event, payload) => {
		const wrapper = await mountList();

		await choose(cards(wrapper)[index]!, label);

		expect(wrapper.emitted(event)).toEqual([payload]);
	});

	it('keeps two cards’ commands apart', async () => {
		const wrapper = await mountList();

		await choose(cards(wrapper)[0]!, 'Refresh Clients');
		await choose(cards(wrapper)[2]!, 'Refresh Clients');

		expect(wrapper.emitted('sendCommand')).toEqual([
			[screens[0], 'refresh'],
			[screens[2], 'refresh'],
		]);
	});

	// The store keeps the previous Event's Screens until the load lands, so a
	// loading list must not show them.
	it('shows a spinner and no cards while the Screens are loading', async () => {
		const wrapper = await mountList({ loading: true });

		expect(wrapper.find('[data-testid="loading"]').exists()).toBe(true);
		expect(cards(wrapper)).toHaveLength(0);
	});

	it('shows the failure it was given, and no cards, when the load failed', async () => {
		const wrapper = await mountList({ error: 'This Event belongs to another installation' });

		expect(wrapper.text()).toContain('Unable to load screens');
		expect(wrapper.text()).toContain('This Event belongs to another installation');
		expect(cards(wrapper)).toHaveLength(0);
	});

	// The page owns the empty state; a second one here would compete with it.
	it('renders nothing when there are no Screens', async () => {
		const wrapper = await mountList({ screens: [] });

		expect(wrapper.text()).toBe('');
	});

	// A capability minted at mount would be stale on a list left open (#231).
	it('asks the network for nothing merely by rendering', async () => {
		await mountList();

		expect(apiFetch).not.toHaveBeenCalled();
	});
});
