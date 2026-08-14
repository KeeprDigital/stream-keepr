import type { PropType } from 'vue';
import type { Screen } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent } from 'vue';
import ScreenListItem from '~/components/Screen/ListItem.vue';

/**
 * The mode registry pulls every mode's Display/Settings component in through
 * `defineAsyncComponent`, and none of it bears on the composition under test. The label
 * is the identity function so each card shows its own Screen's mode — which is how a
 * card bound to the wrong Screen gives itself away in the rendered text.
 */
vi.mock('~/modules/screen-mode', () => ({
	getScreenModeDisplayType: vi.fn(() => 'overlay'),
	getScreenModeIcon: vi.fn(() => 'i-lucide-monitor'),
	getScreenModeLabel: vi.fn((mode: string) => mode),
	getScreenModeSelectOptions: vi.fn(() => [
		{ label: 'Idle', icon: 'i-lucide-moon', value: 'idle' },
		{ label: 'Standings', icon: 'i-lucide-list', value: 'standings' },
	]),
}));

enableAutoUnmount(afterEach);

/**
 * The seams the card reaches the outside world through, mocked exactly where
 * `ListItem.test.ts` mocks them (#269). Nothing here hands out an output, so none of
 * them is expected to be called — they exist because the card's `setup` calls each one.
 */
const { mockApiFetch } = vi.hoisted(() => ({ mockApiFetch: vi.fn() }));
mockNuxtImport('$fetch', () => mockApiFetch);

/**
 * The one call that arrives here without this file asking for it: `useServerTime` is a
 * lazy singleton that samples the clock through the same `$fetch` (#123), so the mock
 * above records requests the composition never made. Selected out where it is asserted
 * about, never counted as one of the list's own (#342).
 */
const CLOCK_SYNC_ENDPOINT = '/api/time';
mockNuxtImport('useCopyToClipboard', () => () => ({ copyToClipboard: vi.fn() }));
mockNuxtImport('useToast', () => () => ({ add: vi.fn() }));
mockNuxtImport('navigateTo', () => vi.fn());

const UCardStub = defineComponent({ template: '<div><slot /></div>' });
const NuxtLinkStub = defineComponent({ template: '<a><slot /></a>' });
const UBadgeStub = defineComponent({ template: '<span data-badge><slot /></span>' });
const UIconStub = defineComponent({ template: '<i />' });
const ScreenTypeBadgeStub = defineComponent({ template: '<span />' });
const UILoadingSpinnerStub = defineComponent({ template: '<div data-testid="loading" />' });

/** `loading` reaches the DOM, because that is the only place a busy card shows. */
const UButtonStub = defineComponent({
	props: { loading: { type: Boolean, default: false } },
	template: '<button type="button" :data-loading="String(loading)"><slot /></button>',
});

/** The menu's items as buttons, the way the card's own suite renders them (#269). */
const UDropdownMenuStub = defineComponent({
	props: {
		items: {
			type: Array as PropType<Array<Array<{ label: string; onSelect: (event: Event) => void }>>>,
			default: () => [],
		},
	},
	setup(props) {
		return { entries: computed(() => props.items.flat()) };
	},
	template: `<div>
		<button
			v-for="entry in entries"
			:key="entry.label"
			type="button"
			:data-menu-item="entry.label"
			@click="entry.onSelect($event)"
		>{{ entry.label }}</button>
		<slot />
	</div>`,
});

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
	makeScreen({ id: 4, name: 'Stage Left', slug: 'stage-left', currentMode: 'idle' }),
	makeScreen({ id: 7, name: 'Stage Right', slug: 'stage-right', currentMode: 'standings' }),
	makeScreen({ id: 11, name: 'Feature Table', slug: 'feature-table', currentMode: 'card' }),
];

/** Screen 7 is deliberately absent: a Screen nobody is watching has no entry at all. */
const connectedCounts = new Map([[4, 3], [11, 9]]);

async function mountList(props: Partial<{
	loading: boolean;
	error: string | null;
	screens: Screen[];
	eventId: number;
	updatingScreenId: number | null;
	connectedCounts: Map<number, number>;
}> = {}) {
	const { default: ScreenList } = await import('~/components/Screen/List.vue');

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
		global: {
			// The real card mounts inside the list, and nothing in this options object is
			// what makes it: Nuxt resolves `<ScreenListItem>` in List's template to
			// `app/components/Screen/ListItem.vue` itself (`.nuxt/components.d.ts`), so the
			// card arrives whatever a caller registers. A `components: { ScreenListItem }`
			// entry here is inert — registering a stub under that name loses to the same
			// resolution.
			//
			// The one intervention that IS honoured is the `stubs` map below, which is also
			// exactly how the composition got missed in the first place: the screens index
			// suite stubs the list one layer up (#279). Adding `ScreenListItem: true` there
			// fails 9 of these 14 tests, so the assertions on rendered names, slugs,
			// addresses and menu items are what would catch a future stubbing rather than
			// let it read as covered.
			//
			// The import at the top of the file stays regardless: `findAllComponents` matches
			// on the component definition, and it is the same module Nuxt resolves to.
			stubs: {
				NuxtLink: NuxtLinkStub,
				UCard: UCardStub,
				UBadge: UBadgeStub,
				UIcon: UIconStub,
				UButton: UButtonStub,
				UDropdownMenu: UDropdownMenuStub,
				ScreenTypeBadge: ScreenTypeBadgeStub,
				UILoadingSpinner: UILoadingSpinnerStub,
			},
		},
	});
	await flushPromises();
	return wrapper;
}

/**
 * The list of Screens, and the first test ever to mount it.
 *
 * `Screen/List.vue` is the only thing between the screens index page and the cards an
 * operator actually clicks, and until #279 nothing mounted it: the index suite stubs it
 * out (`ScreenListStub`), and #269's suite mounts the card directly. So every binding
 * in this file's template — which Screen a card is for, which Event, which connected
 * count, which one is busy, and which Screen an action is reported against — was
 * unreached by any test at all.
 *
 * The subject here is the composition, not the card. What the card says about handing
 * out an output has its own nine tests (#269) and is deliberately not repeated: the
 * mutation table for this branch carries a negative control proving as much.
 */
describe('screen list — the cards it composes, and the Screen each one is for', () => {
	function cards(wrapper: Awaited<ReturnType<typeof mountList>>) {
		return wrapper.findAllComponents(ScreenListItem);
	}

	/** Everything the list actually asked for: the clock sync above is not its request. */
	function requestsOtherThanTheClockSync() {
		return mockApiFetch.mock.calls.filter(([path]) => String(path) !== CLOCK_SYNC_ENDPOINT);
	}

	/**
	 * One card per Screen, in the order handed down.
	 *
	 * Asserted through each card's rendered text as well as its props, because props
	 * alone are what a stub would have shown too — the names and slugs below are the
	 * real card's own output, so an iteration bound to the wrong element cannot pass by
	 * having the right prop object on some other row.
	 */
	it('renders one card per Screen, in the order it was given them', async () => {
		const wrapper = await mountList();

		const rendered = cards(wrapper);
		expect(rendered).toHaveLength(3);
		expect(rendered.map(card => card.props('screen'))).toEqual(screens);
		expect(rendered.map(card => card.get('h4').text())).toEqual([
			'Stage Left',
			'Stage Right',
			'Feature Table',
		]);
		// Each card's mode is its own Screen's, so a row bound to a neighbour shows it.
		expect(rendered.map(card => card.text())).toEqual([
			expect.stringContaining('idle'),
			expect.stringContaining('standings'),
			expect.stringContaining('card'),
		]);
	});

	/**
	 * Every card is told which Event it belongs to, and it is the list's Event rather
	 * than anything derivable from the Screen.
	 *
	 * The card builds its Screen's address out of this, so a wrong Event here is a whole
	 * list of addresses pointing at somebody else's installation — visible in the text,
	 * which is why the address is asserted and not just the prop.
	 *
	 * One substitution this cannot catch, deliberately: every Screen in the fixture
	 * carries the same `eventId` as the list, so binding `screen.eventId` here instead
	 * would pass. Giving a Screen a different Event to make that fail would pin a list
	 * the app never assembles — the page loads one Event's Screens — and pinning
	 * behaviour in an unreachable state is how a future correction reads as a
	 * regression. Recorded as a survivor in the branch's mutation table instead.
	 */
	it('hands every card the Event whose list it is', async () => {
		const wrapper = await mountList({ eventId: 2 });

		const rendered = cards(wrapper);
		expect(rendered.map(card => card.props('eventId'))).toEqual([2, 2, 2]);
		expect(rendered.map(card => card.get('p').text())).toEqual([
			`${window.location.origin}/event/2/screen/stage-left`,
			`${window.location.origin}/event/2/screen/stage-right`,
			`${window.location.origin}/event/2/screen/feature-table`,
		]);
	});

	/**
	 * The connected count is looked up per Screen, and a Screen with no entry is at
	 * zero rather than at whatever the last lookup answered.
	 *
	 * Screen 7 has no entry in the map on purpose: presence arrives asynchronously, so
	 * "no entry yet" is the ordinary state of a freshly loaded list and not an edge case.
	 */
	it('gives each card its own connected count, and zero to a Screen with no entry', async () => {
		const wrapper = await mountList();

		const rendered = cards(wrapper);
		expect(rendered.map(card => card.props('connectedCount'))).toEqual([3, 0, 9]);
		// The card shows a count only when someone is connected, so the unwatched Screen
		// is the one carrying its slug badge and nothing beside it.
		expect(rendered.map(card => card.findAll('[data-badge]').map(badge => badge.text()))).toEqual([
			['/stage-left', '3'],
			['/stage-right'],
			['/feature-table', '9'],
		]);
	});

	/**
	 * Exactly the Screen being updated is busy — the id is matched, not the position.
	 *
	 * A list where a mode change spins every card, or spins the wrong one, tells the
	 * operator the wrong Screen is mid-change; `updatingScreenId` is the only thing
	 * distinguishing them, so both the marked card and the unmarked ones are asserted.
	 *
	 * The Screen chosen is the last one rather than the middle one, so that the expected
	 * pattern is asymmetric: a list rendered in reverse leaves a three-card middle
	 * exactly where it was, and an assertion whose true answer is unchanged by reversal
	 * cannot see it.
	 */
	it('marks only the Screen whose mode is being changed as busy', async () => {
		const wrapper = await mountList({ updatingScreenId: 11 });

		const rendered = cards(wrapper);
		expect(rendered.map(card => card.props('isUpdating'))).toEqual([false, false, true]);
		expect(rendered.map(card => card.find('[data-loading="true"]').exists())).toEqual([
			false,
			false,
			true,
		]);
	});

	/** Nobody is updating, so nobody is busy. */
	it('marks no card busy when no Screen is being updated', async () => {
		const wrapper = await mountList({ updatingScreenId: null });

		expect(cards(wrapper).map(card => card.props('isUpdating'))).toEqual([false, false, false]);
	});

	/**
	 * The four relays, each asserted from a card that is *not* the first.
	 *
	 * A relay that closes over the wrong Screen — the first one, most plausibly, since
	 * that is what a hoisted reference produces — is the defect this list is uniquely
	 * placed to have, and it is invisible from the card's own suite: the card emits
	 * `edit` with no argument at all, and which Screen that edit is about is decided
	 * here and nowhere else.
	 */
	it('reports an edit against the Screen whose card asked for it', async () => {
		const wrapper = await mountList();

		await cards(wrapper)[1]!.get('[data-menu-item="Edit Screen"]').trigger('click');

		expect(wrapper.emitted('editScreen')).toEqual([[screens[1]]]);
	});

	it('reports a delete against the Screen whose card asked for it', async () => {
		const wrapper = await mountList();

		await cards(wrapper)[2]!.get('[data-menu-item="Delete Screen"]').trigger('click');

		expect(wrapper.emitted('deleteScreen')).toEqual([[screens[2]]]);
	});

	/**
	 * A mode change carries both halves: which Screen, and which mode.
	 *
	 * The card emits only the mode, so the pairing is the list's own work — and a relay
	 * that dropped the mode, or sent a fixed one, would still look like a working menu.
	 */
	it('reports a mode change with both the Screen and the mode chosen', async () => {
		const wrapper = await mountList();

		await cards(wrapper)[2]!.get('[data-menu-item="Standings"]').trigger('click');

		expect(wrapper.emitted('setMode')).toEqual([[screens[2], 'standings']]);
	});

	it('reports a command with both the Screen and the command chosen', async () => {
		const wrapper = await mountList();

		await cards(wrapper)[1]!.get('[data-menu-item="Identify"]').trigger('click');

		expect(wrapper.emitted('sendCommand')).toEqual([[screens[1], 'identify']]);
	});

	/**
	 * Two cards, two Screens, two separate reports.
	 *
	 * The single-click tests above would all pass against a list that reported every
	 * card's action against the same Screen if that Screen happened to be the one
	 * clicked. Two clicks on different rows cannot.
	 */
	it('keeps two cards’ commands apart', async () => {
		const wrapper = await mountList();

		await cards(wrapper)[0]!.get('[data-menu-item="Refresh Clients"]').trigger('click');
		await cards(wrapper)[2]!.get('[data-menu-item="Refresh Clients"]').trigger('click');

		expect(wrapper.emitted('sendCommand')).toEqual([
			[screens[0], 'refresh'],
			[screens[2], 'refresh'],
		]);
	});

	/**
	 * While the load is in flight there are no cards — not stale ones underneath a
	 * spinner.
	 *
	 * The Screens prop is deliberately non-empty here, and that combination is reachable
	 * rather than contrived: `loadScreensByEventId` does not clear `screens` before its
	 * fetch, so a page opened on a second Event renders with the first Event's Screens
	 * still in the store and `initialLoading` true. The cards a spinner replaces in that
	 * moment belong to somebody else's Event.
	 */
	it('shows a spinner and no cards while the Screens are loading', async () => {
		const wrapper = await mountList({ loading: true });

		expect(wrapper.find('[data-testid="loading"]').exists()).toBe(true);
		expect(cards(wrapper)).toHaveLength(0);
	});

	/**
	 * A failed load shows the sentence the caller was given, and no cards.
	 *
	 * The message is rendered rather than summarised because the page hands down what
	 * the server wrote — the same reason `Event/List.vue` is pinned on its own sentence
	 * (#271). A list that swallowed it would leave the operator with a bare failure and
	 * nothing to act on.
	 */
	it('shows the failure it was given, and no cards, when the load failed', async () => {
		const wrapper = await mountList({ error: 'This Event belongs to another installation' });

		expect(wrapper.text()).toContain('Unable to load screens');
		expect(wrapper.text()).toContain('This Event belongs to another installation');
		expect(cards(wrapper)).toHaveLength(0);
		expect(wrapper.find('[data-testid="loading"]').exists()).toBe(false);
	});

	/**
	 * Handed no Screens, the list renders nothing at all — no cards and no empty-state
	 * copy of its own.
	 *
	 * This is a division of labour, not a design decision about prose: the page above
	 * owns the empty state and shows `UIEmptyState` with "No screens configured"
	 * instead of ever rendering this component with an empty, unfailed, unloading list
	 * (`showScreenList` in `app/pages/event/[eventId]/screens/index.vue`, pinned by that
	 * page's suite). What is pinned here is that the list does not compete with it —
	 * two empty states on one page is the failure mode, and a second one added here
	 * would appear nowhere else.
	 */
	it('renders nothing when there are no Screens, leaving the empty state to the page', async () => {
		const wrapper = await mountList({ screens: [] });

		expect(cards(wrapper)).toHaveLength(0);
		expect(wrapper.text()).toBe('');
		expect(wrapper.find('[data-testid="loading"]').exists()).toBe(false);
	});

	/**
	 * The composition asks nothing of the network on its own.
	 *
	 * Every card calls `useScreenOutputAccessUrl` in `setup`, and a capability minted at
	 * mount is the staleness #231 and #269 were about — one per card, on a list an
	 * operator leaves open. The card's own suite pins that for one card; this pins that
	 * rendering a whole list of them does not add up to a request either.
	 *
	 * Filtered rather than counted whole, which is the half this was wrong about until
	 * #342. `$fetch` is mocked for the module, so the clock sync writes into the same
	 * mock, and an `/api/time` sample landing inside this window reddened an unfiltered
	 * `not.toHaveBeenCalled()` four times — twice on #342 and once on round fifteen's
	 * authoritative round-close run, where a suite nobody had touched read as a
	 * regression. A negative guard on a shared mock is blind in exactly the way a
	 * positive one is, and wants the same selection (#273, #280, #123).
	 *
	 * The breadth survives the filter: every call except that one is still asserted
	 * away, so a capability minted at mount fails this — and so does any other request
	 * the composition starts, which counting only capability requests would have missed.
	 */
	it('mints no asset capability merely by rendering the list', async () => {
		await mountList();

		expect(requestsOtherThanTheClockSync()).toEqual([]);
	});
});
