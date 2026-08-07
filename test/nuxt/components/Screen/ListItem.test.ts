import type { PropType } from 'vue';
import type { Screen } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent } from 'vue';

// The mode registry pulls in every mode's Display/Settings component through
// defineAsyncComponent, and none of it bears on the hand-out controls under test.
vi.mock('~/modules/screen-mode', () => ({
	getScreenModeDisplayType: vi.fn(() => 'overlay'),
	getScreenModeIcon: vi.fn(() => 'i-lucide-monitor'),
	getScreenModeLabel: vi.fn((mode: string) => mode),
	getScreenModeSelectOptions: vi.fn(() => []),
}));

enableAutoUnmount(afterEach);

/** What the Screen Output Asset Capability endpoint issues, if anything. */
const mockCapabilityResponse = { value: null as string | null };
const { mockApiFetch } = vi.hoisted(() => ({ mockApiFetch: vi.fn() }));

/** What the hand-out controls report through, and what they were handed. */
const mockCopyToClipboard = vi.fn();
const mockToastAdd = vi.fn();

mockNuxtImport('$fetch', () => mockApiFetch);
mockNuxtImport('useCopyToClipboard', () => () => ({ copyToClipboard: mockCopyToClipboard }));
mockNuxtImport('useToast', () => () => ({ add: mockToastAdd }));
mockNuxtImport('navigateTo', () => vi.fn());

const CardStub = defineComponent({ template: '<div><slot /></div>' });
const NuxtLinkStub = defineComponent({ template: '<a><slot /></a>' });
const UBadgeStub = defineComponent({ template: '<span><slot /></span>' });
const UIconStub = defineComponent({ template: '<i />' });
const ScreenTypeBadgeStub = defineComponent({ template: '<span />' });
const UButtonStub = defineComponent({
	name: 'UButton',
	props: { label: { type: String, default: '' } },
	emits: ['click'],
	template: '<button type="button" @click="$emit(\'click\')">{{ label }}<slot /></button>',
});

/**
 * The menu's items as buttons, carrying each item's own `label` and `description`.
 *
 * Both hand-outs on this card reach `useScreenOutputAccessUrl` through an item's
 * `onSelect`, and the sentence saying what a hand-out carries lives in the item's
 * `description` — which is where this surface can put it, the trigger beside it being
 * a general Screen-actions menu rather than a hand-out menu (#266). The stub declares
 * only fields `DropdownMenuItem` really has and the real content component really
 * renders, so it cannot pass on something the real menu would drop.
 */
const UDropdownMenuStub = defineComponent({
	props: {
		items: {
			type: Array as PropType<Array<Array<{ label: string; description?: string; onSelect: (event: Event) => void }>>>,
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
			:data-menu-description="entry.description"
			@click="entry.onSelect($event)"
		>{{ entry.label }}</button>
		<slot />
	</div>`,
});

const screen = {
	id: 4,
	eventId: 2,
	name: 'Stage Left',
	slug: 'stage-left',
	currentMode: 'idle',
	modeConfigs: null,
	screenConfig: null,
	stateVersion: 1,
	createdAt: new Date('2026-01-01'),
	updatedAt: new Date('2026-01-01'),
} as unknown as Screen;

async function mountComponent() {
	const componentPath = '../../../../app/components/Screen/ListItem.vue';
	const { default: ScreenListItem } = await import(componentPath);

	const wrapper = mount(ScreenListItem, {
		props: {
			screen,
			eventId: 2,
			connectedCount: 0,
			isUpdating: false,
		},
		global: {
			stubs: {
				NuxtLink: NuxtLinkStub,
				UCard: CardStub,
				UBadge: UBadgeStub,
				UIcon: UIconStub,
				UButton: UButtonStub,
				UDropdownMenu: UDropdownMenuStub,
				ScreenTypeBadge: ScreenTypeBadgeStub,
			},
		},
	});
	await flushPromises();
	return wrapper;
}

/**
 * The third surface that hands out a Screen Output, and until #269 the only one no
 * test reached at all: `Screen/List.vue` is stubbed in the screens index suite, so
 * nothing mounted this card and nothing read a word it says.
 *
 * What it hands out is not what it displays. The card prints the Screen's bare
 * address, and these two controls produce the Overlay Output URL carrying the Screen
 * Output Asset Capability — the bare one loads, renders, and silently omits every
 * image, video and library font (#231).
 */
describe('screen list item — handing out this Screen’s output', () => {
	beforeEach(() => {
		mockCapabilityResponse.value = 'list-capability';
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
	});

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

	function accessUrl(capability: string) {
		return `${window.location.origin}/event/2/screen/stage-left?output=overlay#asset-capability=${capability}`;
	}

	/**
	 * The capability is rotated between mount and the click, and the copied URL has to
	 * carry the new one.
	 *
	 * Asserting only that some capability appears would pass against a value cached when
	 * the card mounted — and this card is rendered once per Screen on a list an operator
	 * leaves open, so a mount-time capability is the stalest one anywhere in the app.
	 */
	it('copies a URL carrying asset access, obtained at the moment of the hand-out', async () => {
		const wrapper = await mountComponent();
		mockCapabilityResponse.value = 'rotated-capability';

		await wrapper.get('[data-menu-item="Copy output URL"]').trigger('click');
		await flushPromises();

		expect(mockApiFetch).toHaveBeenCalledWith('/api/events/2/screens/4/asset-capability');
		// Named for the output rather than the Screen, matching the control that produced
		// it and the two surfaces that hand out the same thing (#234, #266).
		expect(mockCopyToClipboard).toHaveBeenCalledWith(
			accessUrl('rotated-capability'),
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
	 * then on. The pin above catches a capability cached at mount and misses one cached
	 * on first use, which is the same defect one click later — #250's review found
	 * exactly that gap on the settings page, where the reviewer's cache-on-first-use
	 * mutant survived the whole suite.
	 */
	it('obtains asset access again for a second copy, rather than reusing the first', async () => {
		const wrapper = await mountComponent();
		// Nothing on this card asks for a capability before a hand-out does.
		expect(capabilityRequests()).toHaveLength(0);

		await wrapper.get('[data-menu-item="Copy output URL"]').trigger('click');
		await flushPromises();
		mockCapabilityResponse.value = 'rotated-capability';
		await wrapper.get('[data-menu-item="Copy output URL"]').trigger('click');
		await flushPromises();

		expect(capabilityRequests()).toHaveLength(2);
		// The first hand-out carried the old capability, so the second cannot pass by
		// having been rotated all along.
		expect(mockCopyToClipboard).toHaveBeenNthCalledWith(1, accessUrl('list-capability'), expect.anything());
		expect(mockCopyToClipboard).toHaveBeenNthCalledWith(2, accessUrl('rotated-capability'), expect.anything());
	});

	/**
	 * The empty string is what the clipboard helper reports as having nothing to copy,
	 * and the words it reports with have to name the reason — an operator told only
	 * "copy failed" reaches for the address printed on this very card, which is the
	 * media-losing URL the refusal exists to withhold (#231, #257).
	 */
	it('copies nothing at all when asset access cannot be obtained, and names why', async () => {
		mockCapabilityResponse.value = null;
		const wrapper = await mountComponent();

		await wrapper.get('[data-menu-item="Copy output URL"]').trigger('click');
		await flushPromises();

		expect(mockCopyToClipboard).toHaveBeenCalledWith('', expect.objectContaining({
			nothingToCopyTitle: 'Nothing copied',
			nothingToCopyDescription: expect.stringContaining('Asset access for this Screen could not be obtained'),
		}));
	});

	/** Rotated between mount and the click here too, for the same reason. */
	it('opens the output in a tab it points only once asset access is in hand', async () => {
		const outputWindow = stubOutputWindow();
		const wrapper = await mountComponent();
		mockCapabilityResponse.value = 'rotated-capability';

		await wrapper.get('[data-menu-item="Open output"]').trigger('click');
		await flushPromises();

		expect(window.open).toHaveBeenCalledWith('', '_blank');
		expect(outputWindow.opener).toBeNull();
		expect(outputWindow.location.href).toBe(accessUrl('rotated-capability'));
		expect(outputWindow.close).not.toHaveBeenCalled();
		// Nothing went wrong, so nothing is said about it.
		expect(mockToastAdd).not.toHaveBeenCalled();
	});

	/** The same second hand-out, for the same reason: opening twice must ask twice. */
	it('obtains asset access again for a second open, rather than reusing the first', async () => {
		const opened = stubOutputWindows();
		const wrapper = await mountComponent();

		await wrapper.get('[data-menu-item="Open output"]').trigger('click');
		await flushPromises();
		mockCapabilityResponse.value = 'rotated-capability';
		await wrapper.get('[data-menu-item="Open output"]').trigger('click');
		await flushPromises();

		expect(capabilityRequests()).toHaveLength(2);
		expect(opened).toHaveLength(2);
		expect(opened[0]!.location.href).toBe(accessUrl('list-capability'));
		expect(opened[1]!.location.href).toBe(accessUrl('rotated-capability'));
	});

	/**
	 * The defect #269 was filed for: this card discarded the answer entirely, so a
	 * refused open opened a tab, closed it again, and said nothing.
	 */
	it('opens no output, and says why, when asset access cannot be obtained', async () => {
		mockCapabilityResponse.value = null;
		const outputWindow = stubOutputWindow();
		const wrapper = await mountComponent();

		await wrapper.get('[data-menu-item="Open output"]').trigger('click');
		await flushPromises();

		expect(outputWindow.location.href).toBe('');
		expect(outputWindow.close).toHaveBeenCalledOnce();
		// The tab opened and closed again, so nothing visibly happened. Left unsaid it
		// reads as a popup blocker rather than as the media-losing hand-out it refused.
		//
		// Exactly once, because `toHaveBeenCalledWith` asks only whether *some* call
		// matched: a handler firing both sentences passes it, and hands the operator two
		// contradictory instructions (#278).
		expect(mockToastAdd).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
			title: 'Output not opened',
			description: expect.stringContaining('Asset access for this Screen could not be obtained'),
		}));
	});

	/**
	 * And the popup blocker it would otherwise be mistaken for gets its own words.
	 *
	 * The two failures are opposite instructions — retry, or change a browser setting —
	 * so reporting both as an asset access refusal tells the operator to try again at a
	 * tab their browser will block identically (#258).
	 */
	it('names the browser, not asset access, when the output window is blocked', async () => {
		vi.stubGlobal('open', vi.fn(() => null));
		const wrapper = await mountComponent();

		await wrapper.get('[data-menu-item="Open output"]').trigger('click');
		await flushPromises();

		// Counted before it is read. Reading the last call cannot see a spurious earlier
		// one, and with no toast at all the destructure throws `undefined is not iterable`
		// rather than saying what was expected (#278).
		expect(mockToastAdd).toHaveBeenCalledOnce();
		const [reported] = mockToastAdd.mock.calls[0] as [{ title: string; description: string }];
		expect(reported.title).toBe('Output not opened');
		expect(reported.description).toContain('pop-up');
		expect(reported.description).not.toContain('Asset access');
		// Nothing to hand a capability to, so none is minted.
		expect(capabilityRequests()).toHaveLength(0);
	});

	/**
	 * The #234/#266 precedent, brought to the third surface.
	 *
	 * "Copy URL" sat inches from the bare address this card prints, which is the one
	 * URL here that resolves no media, and "Open in New Tab" named the tab rather than
	 * the thing arriving in it. An operator choosing between these and the address they
	 * can read has to be able to see which of them carries asset access.
	 */
	it('names both hand-out controls by what they hand out, and says what each carries', async () => {
		const wrapper = await mountComponent();

		const copy = wrapper.get('[data-menu-item="Copy output URL"]');
		const open = wrapper.get('[data-menu-item="Open output"]');
		expect(copy.text()).toBe('Copy output URL');
		expect(open.text()).toBe('Open output');
		expect(copy.attributes('data-menu-description')).toContain('asset access');
		expect(open.attributes('data-menu-description')).toContain('asset access');
	});

	/**
	 * The address on the card is not the hand-out, and saying so is the point of both
	 * controls being named for the output instead of for it.
	 */
	it('prints the Screen’s bare address, which carries no asset access', async () => {
		const wrapper = await mountComponent();

		expect(wrapper.text()).toContain(`${window.location.origin}/event/2/screen/stage-left`);
		expect(wrapper.text()).not.toContain('asset-capability=');
	});
});
