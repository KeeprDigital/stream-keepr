import type { PropType } from 'vue';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, nextTick, reactive } from 'vue';
import { getScreenModeConfigurationPolicy } from '~/modules/screen-mode';

// The mode-settings module pulls in every mode's Display/Settings component
// (feature-match overlay, metagame, etc.) via defineAsyncComponent. None of
// that is relevant to the screenId race-condition behavior under test, so
// stub it down to plain, synchronous no-ops.
vi.mock('~/modules/screen-mode', () => ({
	getScreenModeConfigurationPolicy: vi.fn(() => null),
	getScreenModeLabel: vi.fn((mode: string) => mode),
	getScreenModeSelectOptions: vi.fn(() => []),
	getScreenModeSettingsComponent: vi.fn(() => null),
}));

const route = reactive({
	params: { eventId: '1', screenId: '1' } as Record<string, string>,
});

const mockEventStore = reactive({
	event: { id: 1 },
});

interface PendingLoad {
	screenId: number;
	resolve: (screen: unknown) => void;
}

let pendingLoads: PendingLoad[] = [];

const mockScreenStore = reactive({
	screens: [] as Array<{ id: number; screenConfig?: Record<string, unknown> }>,
	screenPresence: new Map<number, { count: number; members: Array<{ clientId: string; data?: Record<string, unknown> }> }>(),
	subscribeToScreenPresence: vi.fn(),
	unsubscribeFromScreenPresence: vi.fn(),
	getConnectedCount: vi.fn(() => 0),
	updateScreenConfig: vi.fn(),
	getScreenById: vi.fn((_eventId: number, screenId: number) => new Promise((resolve) => {
		pendingLoads.push({ screenId, resolve });
	})),
});

const mockToast = { add: vi.fn() };

/** What the Screen Output Asset Capability endpoint issues, if anything. */
const mockCapabilityResponse = { value: null as string | null };
const { mockApiFetch } = vi.hoisted(() => ({ mockApiFetch: vi.fn() }));

/** What the copy control reports through, and what it was handed. */
const mockCopyToClipboard = vi.fn();

mockNuxtImport('useRoute', () => () => route);
mockNuxtImport('useEventStore', () => () => mockEventStore);
mockNuxtImport('useScreenStore', () => () => mockScreenStore);
mockNuxtImport('useToast', () => () => mockToast);
mockNuxtImport('$fetch', () => mockApiFetch);
mockNuxtImport('useCopyToClipboard', () => () => ({ copyToClipboard: mockCopyToClipboard }));

const NuxtLayoutStub = defineComponent({
	template: '<div><slot name="actions" /><slot /></div>',
});

const UContainerStub = defineComponent({
	template: '<div><slot /></div>',
});

const CardStub = defineComponent({
	template: '<div><slot /></div>',
});

/** Renders its default slot, which the default stub does not — the hand-out controls live in one. */
const SlotStub = defineComponent({
	template: '<div><slot /></div>',
});

/**
 * The same, plus the tooltip's own words in the DOM.
 *
 * On this page the sentence saying what a hand-out carries lives in the tooltip
 * rather than on the button, so a naming test has no way to read it otherwise (#266).
 */
const UTooltipStub = defineComponent({
	props: { text: { type: String, default: '' } },
	template: '<div :data-tooltip="text"><slot /></div>',
});

const UButtonStub = defineComponent({
	name: 'UButton',
	props: { label: { type: String, default: '' } },
	emits: ['click'],
	template: '<button type="button" @click="$emit(\'click\')">{{ label }}<slot /></button>',
});

/**
 * The Open menu's items as buttons, since what the page decides is the item list and
 * every hand-out reaches `openScreenOutput` through one of its `onSelect`s.
 */
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
			:data-open-output="entry.label"
			@click="entry.onSelect($event)"
		>{{ entry.label }}</button>
		<slot />
	</div>`,
});

function makeScreen(id: number) {
	return {
		id,
		name: `Screen ${id}`,
		slug: `screen-${id}`,
		currentMode: 'idle',
		screenConfig: {},
	};
}

/**
 * What the mode registry answers for this Screen's mode. `null` stands for a Screen
 * whose mode declares no policy, which the registry's own return type does not admit.
 */
function stubModePolicy(policy: unknown) {
	vi.mocked(getScreenModeConfigurationPolicy).mockReturnValue(policy as never);
}

/** Resolve the getScreenById(...) call for a specific screenId, in whatever order the test wants. */
function resolveLoad(screenId: number, screen: unknown) {
	const index = pendingLoads.findIndex(load => load.screenId === screenId);
	if (index === -1)
		throw new Error(`No pending load for screen ${screenId}`);
	const [load] = pendingLoads.splice(index, 1);
	load!.resolve(screen);
}

async function mountPage() {
	const pagePath = '../../../../../../app/pages/event/[eventId]/screens/[screenId].vue';
	const { default: ScreenPage } = await import(pagePath);

	return mount(ScreenPage, {
		global: {
			stubs: {
				NuxtLayout: NuxtLayoutStub,
				UContainer: UContainerStub,
				UILoadingSpinner: true,
				UIEmptyState: true,
				UButton: UButtonStub,
				UCard: CardStub,
				UBadge: true,
				UIcon: true,
				UTooltip: UTooltipStub,
				USelect: true,
				UFieldGroup: SlotStub,
				UDropdownMenu: UDropdownMenuStub,
				USeparator: true,
				UPopover: true,
				UAlert: true,
			},
		},
	});
}

describe('screen config page — screenId route changes', () => {
	let wrapper: Awaited<ReturnType<typeof mountPage>> | null = null;

	beforeEach(() => {
		pendingLoads = [];
		route.params.screenId = '1';
		mockScreenStore.screens = [];
		mockScreenStore.subscribeToScreenPresence.mockClear();
		mockScreenStore.unsubscribeFromScreenPresence.mockClear();
		mockScreenStore.getScreenById.mockClear();
		mockToast.add.mockClear();
	});

	afterEach(() => {
		// The mocked route is a module-level singleton shared across tests — an
		// un-unmounted page instance would keep reacting to route changes made
		// by the next test and double up on loadScreen calls.
		wrapper?.unmount();
		wrapper = null;
	});

	it('loads and subscribes to the initial screenId on mount', async () => {
		wrapper = await mountPage();
		await flushPromises();

		expect(mockScreenStore.getScreenById).toHaveBeenCalledWith(1, 1);
		resolveLoad(1, makeScreen(1));
		await flushPromises();

		expect(mockScreenStore.subscribeToScreenPresence).toHaveBeenCalledWith(1);
	});

	it('discards a stale load and never subscribes an intermediate screenId when screenId changes rapidly', async () => {
		wrapper = await mountPage();
		await flushPromises();

		resolveLoad(1, makeScreen(1));
		await flushPromises();
		expect(mockScreenStore.subscribeToScreenPresence).toHaveBeenCalledWith(1);
		mockScreenStore.subscribeToScreenPresence.mockClear();

		// Rapid screenId change 1 -> 2 -> 3, before either the 2 or 3 load resolves
		route.params.screenId = '2';
		await nextTick();
		expect(mockScreenStore.unsubscribeFromScreenPresence).toHaveBeenCalledWith(1);
		expect(mockScreenStore.getScreenById).toHaveBeenCalledWith(1, 2);

		route.params.screenId = '3';
		await nextTick();
		expect(mockScreenStore.unsubscribeFromScreenPresence).toHaveBeenCalledWith(2);
		expect(mockScreenStore.getScreenById).toHaveBeenCalledWith(1, 3);

		// The intermediate (screenId=2) load resolves late, after screenId has already
		// moved on to 3 — its result must be discarded rather than applied.
		resolveLoad(2, makeScreen(2));
		await flushPromises();

		expect(mockScreenStore.subscribeToScreenPresence).not.toHaveBeenCalledWith(2);
		expect(wrapper.text()).not.toContain('Screen 2');

		// The current (screenId=3) load resolves and is applied normally.
		resolveLoad(3, makeScreen(3));
		await flushPromises();

		expect(mockScreenStore.subscribeToScreenPresence).toHaveBeenCalledWith(3);
		expect(wrapper.text()).toContain('Screen 3');
	});
});

/**
 * The presence-carried card data self-report (#465), shown where the operator is
 * rather than on program — the same channel and reasoning as the asset-access
 * report (#231). Outputs that report nothing are silent, not degraded.
 */
describe('screen config page — degraded card data on connected outputs', () => {
	let wrapper: Awaited<ReturnType<typeof mountPage>> | null = null;

	beforeEach(() => {
		pendingLoads = [];
		route.params.screenId = '1';
		mockScreenStore.screens = [];
		mockScreenStore.screenPresence = new Map();
		stubModePolicy(null);
	});

	afterEach(() => {
		wrapper?.unmount();
		wrapper = null;
	});

	async function mountLoadedPage() {
		wrapper = await mountPage();
		await flushPromises();
		resolveLoad(1, makeScreen(1));
		await flushPromises();
		return wrapper;
	}

	it('warns about the outputs currently reporting degraded card data', async () => {
		mockScreenStore.screenPresence = new Map([[1, {
			count: 2,
			members: [
				{ clientId: 'a', data: { screenId: 1, cardData: 'degraded' } },
				{ clientId: 'b', data: { screenId: 1, cardData: 'complete' } },
			],
		}]]);

		const page = await mountLoadedPage();

		expect(page.text()).toContain('Card data incomplete on 1 output');
	});

	it('says nothing while every reporting output is complete or silent', async () => {
		mockScreenStore.screenPresence = new Map([[1, {
			count: 2,
			members: [
				{ clientId: 'a', data: { screenId: 1, cardData: 'complete' } },
				// An output that predates the field is silent about its card data,
				// not degraded.
				{ clientId: 'b', data: { screenId: 1 } },
			],
		}]]);

		const page = await mountLoadedPage();

		expect(page.text()).not.toContain('Card data incomplete');
	});
});

/**
 * The two hand-outs of this Screen's real outputs, and what each says when it has
 * nothing to hand out.
 *
 * `useScreenOutputAccessUrl` refuses rather than degrading — a URL without a Screen
 * Output Asset Capability loads, renders, and silently omits every image, video and
 * library font (#231) — and it answers the refusal so its caller can report it. Until
 * #250 this page discarded that answer at both open sites, so a refused open opened a
 * tab, closed it again, and said nothing: exactly what the Live workspace stopped
 * doing in #237, still happening here.
 */
describe('screen config page — handing out this Screen’s output', () => {
	let wrapper: Awaited<ReturnType<typeof mountPage>> | null = null;

	beforeEach(() => {
		pendingLoads = [];
		route.params.screenId = '1';
		mockScreenStore.screens = [];
		stubModePolicy(null);
		mockCopyToClipboard.mockClear();
		mockToast.add.mockClear();
		mockCapabilityResponse.value = 'settings-capability';
		mockApiFetch.mockReset();
		mockApiFetch.mockImplementation(async (path: string) => {
			if (String(path).endsWith('/asset-capability')) {
				if (!mockCapabilityResponse.value)
					throw new Error('no capability');
				return { assetCapability: mockCapabilityResponse.value };
			}
			return {};
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		wrapper?.unmount();
		wrapper = null;
	});

	async function mountLoadedPage() {
		const page = await mountPage();
		await flushPromises();
		resolveLoad(1, makeScreen(1));
		await flushPromises();
		return page;
	}

	function stubOutputWindow() {
		const outputWindow = { opener: {} as unknown, location: { href: '' }, close: vi.fn() };
		vi.stubGlobal('open', vi.fn(() => outputWindow));
		return outputWindow;
	}

	/** A fresh window per `open`, so a second hand-out can be told from the first. */
	function stubOutputWindows() {
		const opened: Array<{ opener: unknown; location: { href: string }; close: () => void }> = [];
		vi.stubGlobal('open', vi.fn(() => {
			const outputWindow = { opener: {} as unknown, location: { href: '' }, close: vi.fn() };
			opened.push(outputWindow);
			return outputWindow;
		}));
		return opened;
	}

	function capabilityRequests() {
		return mockApiFetch.mock.calls.filter(([path]) => String(path).endsWith('/asset-capability'));
	}

	function accessUrl(capability: string, output = 'overlay') {
		return `${window.location.origin}/event/1/screen/screen-1?output=${output}#asset-capability=${capability}`;
	}

	/**
	 * The capability is rotated between mount and the click, and the handed-out URL has
	 * to carry the new one.
	 *
	 * Asserting only that some capability appears would pass against a value cached when
	 * the page mounted, and on this page that is the concrete failure rather than an
	 * academic one: the rotate control is *on this page*, a few pixels from these
	 * controls, so a URL built from a mount-time capability is dead the moment an
	 * operator uses it (#231).
	 */
	it('copies a URL carrying asset access, obtained at the moment of the hand-out', async () => {
		wrapper = await mountLoadedPage();
		mockCapabilityResponse.value = 'rotated-capability';

		await wrapper.get('[aria-label="Copy output URL"]').trigger('click');
		await flushPromises();

		expect(mockApiFetch).toHaveBeenCalledWith('/api/events/1/screens/1/asset-capability');
		// Named for the output rather than the Screen, matching the control that produced
		// it and the workspace's wording for the same hand-out (#234, #266).
		expect(mockCopyToClipboard).toHaveBeenCalledWith(
			`${window.location.origin}/event/1/screen/screen-1?output=overlay#asset-capability=rotated-capability`,
			expect.objectContaining({
				successTitle: 'Output URL copied',
				successDescription: expect.stringContaining('asset access'),
			}),
		);
	});

	/**
	 * And obtained again on every later hand-out, not once and remembered.
	 *
	 * "At the moment of the hand-out" is only tested by a *second* hand-out: a capability
	 * acquired on the first click and reused after is correct exactly once and dead from
	 * then on. The rotate control is on this page, a few pixels from these controls, so
	 * the operator most likely to copy twice is the one who has just rotated in between —
	 * and the stale URL they would be handed loads, renders, and silently omits every
	 * image, video and library font (#231).
	 */
	it('obtains asset access again for a second copy, rather than reusing the first', async () => {
		wrapper = await mountLoadedPage();

		await wrapper.get('[aria-label="Copy output URL"]').trigger('click');
		await flushPromises();
		mockCapabilityResponse.value = 'rotated-capability';
		await wrapper.get('[aria-label="Copy output URL"]').trigger('click');
		await flushPromises();

		expect(capabilityRequests()).toHaveLength(2);
		// The first hand-out carried the old capability, so the second cannot pass by
		// having been rotated all along.
		expect(mockCopyToClipboard).toHaveBeenNthCalledWith(1, accessUrl('settings-capability'), expect.anything());
		expect(mockCopyToClipboard).toHaveBeenNthCalledWith(2, accessUrl('rotated-capability'), expect.anything());
	});

	/**
	 * The empty string is what the clipboard helper reports as having nothing to copy,
	 * and the words it reports with have to name the reason — an operator told only
	 * "failed to copy" reaches for the address in their browser's bar, which is the
	 * media-losing URL this refusal exists to withhold.
	 */
	it('copies nothing at all when asset access cannot be obtained, and names why', async () => {
		mockCapabilityResponse.value = null;
		wrapper = await mountLoadedPage();

		await wrapper.get('[aria-label="Copy output URL"]').trigger('click');
		await flushPromises();

		expect(mockCopyToClipboard).toHaveBeenCalledWith('', expect.objectContaining({
			nothingToCopyTitle: 'Nothing copied',
			nothingToCopyDescription: expect.stringContaining('Asset access for this Screen could not be obtained'),
		}));
	});

	/** Rotated between mount and the click here too, for the same reason. */
	it('opens the default output in a tab it points only once asset access is in hand', async () => {
		const outputWindow = stubOutputWindow();
		wrapper = await mountLoadedPage();
		mockCapabilityResponse.value = 'rotated-capability';

		await wrapper.get('[data-open-output="Open output"]').trigger('click');
		await flushPromises();

		expect(window.open).toHaveBeenCalledWith('', '_blank');
		expect(outputWindow.opener).toBeNull();
		expect(outputWindow.location.href).toBe(
			`${window.location.origin}/event/1/screen/screen-1?output=overlay#asset-capability=rotated-capability`,
		);
		expect(outputWindow.close).not.toHaveBeenCalled();
		expect(mockToast.add).not.toHaveBeenCalled();
	});

	/** The same second hand-out, for the same reason: opening twice must ask twice. */
	it('obtains asset access again for a second open, rather than reusing the first', async () => {
		const opened = stubOutputWindows();
		wrapper = await mountLoadedPage();

		await wrapper.get('[data-open-output="Open output"]').trigger('click');
		await flushPromises();
		mockCapabilityResponse.value = 'rotated-capability';
		await wrapper.get('[data-open-output="Open output"]').trigger('click');
		await flushPromises();

		expect(capabilityRequests()).toHaveLength(2);
		expect(opened).toHaveLength(2);
		expect(opened[0]!.location.href).toBe(accessUrl('settings-capability'));
		expect(opened[1]!.location.href).toBe(accessUrl('rotated-capability'));
	});

	it('opens no output, and says why, when asset access cannot be obtained', async () => {
		mockCapabilityResponse.value = null;
		const outputWindow = stubOutputWindow();
		wrapper = await mountLoadedPage();

		await wrapper.get('[data-open-output="Open output"]').trigger('click');
		await flushPromises();

		expect(outputWindow.location.href).toBe('');
		expect(outputWindow.close).toHaveBeenCalledOnce();
		// The tab opened and closed again, so nothing visibly happened. Left unsaid it
		// reads as a popup blocker rather than as the media-losing hand-out it refused.
		//
		// Exactly once, because `toHaveBeenCalledWith` asks only whether *some* call
		// matched: a handler firing both sentences passes it, and hands the operator two
		// contradictory instructions (#278).
		expect(mockToast.add).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
			description: expect.stringContaining('Asset access for this Screen could not be obtained'),
		}));
	});

	/**
	 * A blocked pop-up is not a refused capability, and until #258 this page said it
	 * was — in the words of the very refusal the browser never gave it a chance to
	 * make. "Try again" is the wrong instruction for a tab the browser will block
	 * identically next time.
	 */
	it('names the browser, not asset access, when the output window is blocked', async () => {
		vi.stubGlobal('open', vi.fn(() => null));
		wrapper = await mountLoadedPage();

		await wrapper.get('[data-open-output="Open output"]').trigger('click');
		await flushPromises();

		// Counted before it is read. Reading the last call cannot see a spurious earlier
		// one, and with no toast at all the destructure throws `undefined is not iterable`
		// rather than saying what was expected (#278).
		expect(mockToast.add).toHaveBeenCalledOnce();
		const [reported] = mockToast.add.mock.calls[0] as [{ description: string }];
		expect(reported.description).toContain('pop-up');
		expect(reported.description).not.toContain('Asset access');
		// Nothing to hand a capability to, so none is minted.
		expect(capabilityRequests()).toHaveLength(0);
	});

	/**
	 * The #234 precedent, brought to this page (#266).
	 *
	 * These two controls sit beside the Screen's bare address, and that address is the
	 * one URL on the page that resolves no media (#231). "Copy screen URL" beside it
	 * read as a button for the text next to it, and "Open default screen" named a
	 * Screen rather than an output. An operator choosing between them and the address
	 * bar has to be able to see which of the three carries asset access.
	 */
	it('names both hand-out controls by what they hand out, and says what it carries', async () => {
		wrapper = await mountLoadedPage();

		const copy = wrapper.get('[aria-label="Copy output URL"]');
		expect(copy.attributes('aria-label')).toBe('Copy output URL');
		expect(wrapper.get('[data-open-output="Open output"]').text()).toBe('Open output');

		// The sentence naming asset access: in the tooltip for copy, on the menu's
		// trigger for open, which is the affordance an operator meets before the items.
		expect(copy.element.closest('[data-tooltip]')?.getAttribute('data-tooltip'))
			.toContain('asset access');
		expect(wrapper.get('[data-testid="open-output-menu"]').attributes('title'))
			.toContain('asset access');
	});

	/**
	 * The second open site. A Screen Mode's own outputs are handed out by a different
	 * function on the same page, and it discarded the same answer — so a mode with
	 * output options had two silent controls, not one.
	 */
	describe('a Screen Mode’s own outputs', () => {
		beforeEach(() => {
			stubModePolicy({
				outputOptions: [{ label: 'Open fill output', icon: 'i-lucide-square', value: 'fill' }],
			});
		});

		it('opens the chosen output with asset access obtained at the hand-out', async () => {
			const outputWindow = stubOutputWindow();
			wrapper = await mountLoadedPage();
			mockCapabilityResponse.value = 'rotated-capability';

			await wrapper.get('[data-open-output="Open fill output"]').trigger('click');
			await flushPromises();

			expect(outputWindow.location.href).toBe(
				`${window.location.origin}/event/1/screen/screen-1?output=fill#asset-capability=rotated-capability`,
			);
			expect(mockToast.add).not.toHaveBeenCalled();
		});

		it('opens nothing, and says why, when asset access cannot be obtained', async () => {
			mockCapabilityResponse.value = null;
			const outputWindow = stubOutputWindow();
			wrapper = await mountLoadedPage();

			await wrapper.get('[data-open-output="Open fill output"]').trigger('click');
			await flushPromises();

			expect(outputWindow.location.href).toBe('');
			expect(outputWindow.close).toHaveBeenCalledOnce();
			// Exactly once here too — same reporter, same blind spot (#278).
			expect(mockToast.add).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
				description: expect.stringContaining('Asset access for this Screen could not be obtained'),
			}));
		});

		/**
		 * The third answer, which this describe had no test for at all until #295 — a
		 * success and a refusal, and nothing for the browser blocking the tab.
		 *
		 * One reporter serves both open controls, so it is tempting to read the
		 * page-level blocked test as covering this. It does not: what is under test is
		 * the *item's* `onSelect` reaching that reporter, and a mode output wired to its
		 * own copy of the pre-#258 sentence would tell an operator to retry a tab their
		 * browser will block identically — with the page-level test still green.
		 */
		it('names the browser, not asset access, when the tab for a mode output is blocked', async () => {
			vi.stubGlobal('open', vi.fn(() => null));
			wrapper = await mountLoadedPage();

			await wrapper.get('[data-open-output="Open fill output"]').trigger('click');
			await flushPromises();

			expect(mockToast.add).toHaveBeenCalledOnce();
			const [reported] = mockToast.add.mock.calls[0] as [{ description: string }];
			expect(reported.description).toContain('pop-up');
			expect(reported.description).not.toContain('Asset access');
			// Nothing to hand a capability to, so none is minted.
			expect(capabilityRequests()).toHaveLength(0);
		});
	});
});
