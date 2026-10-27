import type { PropType } from 'vue';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, nextTick, reactive } from 'vue';
import EditorFocusModeToggle from '~/components/Graphics/EditorFocusModeToggle.vue';
import { useEditorFocusMode } from '~/modules/graphics/editorFocusMode';
import { getScreenModeConfigurationPolicy, getScreenModeSettingsComponent } from '~/modules/screen-mode';

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
	screens: [] as Array<{ id: number }>,
	screenPresence: new Map<number, { count: number; members: Array<{ clientId: string; data?: Record<string, unknown> }> }>(),
	subscribeToScreenPresence: vi.fn(),
	unsubscribeFromScreenPresence: vi.fn(),
	getConnectedCount: vi.fn(() => 0),
	getScreenById: vi.fn((_eventId: number, screenId: number) => new Promise((resolve) => {
		pendingLoads.push({ screenId, resolve });
	})),
});

const mockToast = {
	add: vi.fn(),
};

/** What the Screen Output Asset Capability endpoint issues, if anything. */
const mockCapabilityResponse = { value: null as string | null };
const { mockApiFetch } = vi.hoisted(() => ({
	mockApiFetch: vi.fn(),
}));

/** What the copy control reports through, and what it was handed. */
const mockCopyToClipboard = vi.fn();

mockNuxtImport('useRoute', () => () => route);
mockNuxtImport('useEventStore', () => () => mockEventStore);
mockNuxtImport('useScreenStore', () => () => mockScreenStore);
mockNuxtImport('useToast', () => () => mockToast);
mockNuxtImport('$fetch', () => mockApiFetch);
mockNuxtImport('useCopyToClipboard', () => () => ({ copyToClipboard: mockCopyToClipboard }));

/** The layout's slots, and whether the page asked it for Editor Focus Mode. */
const NuxtLayoutStub = defineComponent({
	props: {
		editorFocus: { type: Boolean, default: false },
	},
	template: '<div data-testid="layout" :data-focus="String(editorFocus)"><slot name="navbar-center" /><slot name="actions" /><slot /></div>',
});

/** A Screen-level settings card, named by its title. */
const ScreenSettingsCardStub = defineComponent({
	props: {
		title: { type: String, default: '' },
	},
	template: '<section :data-settings-card="title"><slot /></section>',
});

const UContainerStub = defineComponent({
	template: '<div><slot /></div>',
});

/** The Screen's Theme card, which loads its Event's Theme; here it only has to be on the page or not. */
const ThemeTokensSettingsStub = defineComponent({
	template: '<div data-settings-card="Theme" />',
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
	props: {
		text: { type: String, default: '' },
	},
	template: '<div :data-tooltip="text"><slot /></div>',
});

const UButtonStub = defineComponent({
	name: 'UButton',
	props: {
		label: { type: String, default: '' },
	},
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
		return {
			entries: computed(() => props.items.flat()),
		};
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
		currentMode: 'background',
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
				ScreenSettingsCard: ScreenSettingsCardStub,
				ScreenThemeTokensSettings: ThemeTokensSettingsStub,
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
		mockScreenStore.screenPresence = new Map([
			[
				1,
				{
					count: 2,
					members: [
						{
							clientId: 'a',
							data: { screenId: 1, cardData: 'degraded' },
						},
						{
							clientId: 'b',
							data: { screenId: 1, cardData: 'complete' },
						},
					],
				},
			],
		]);

		const page = await mountLoadedPage();

		expect(page.text()).toContain('Card data incomplete on 1 output');
	});

	it('says nothing while every reporting output is complete or silent', async () => {
		mockScreenStore.screenPresence = new Map([
			[
				1,
				{
					count: 2,
					members: [
						{
							clientId: 'a',
							data: { screenId: 1, cardData: 'complete' },
						},
						// An output that predates the field is silent about its card data,
						// not degraded.
						{
							clientId: 'b',
							data: { screenId: 1 },
						},
					],
				},
			],
		]);

		const page = await mountLoadedPage();

		expect(page.text()).not.toContain('Card data incomplete');
	});
});

/**
 * Wiring only: each hand-out control reaches `useScreenOutputAccessUrl`, whose own
 * suite owns fresh-per-hand-out capabilities, refusals and blocked pop-ups (#231).
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
		const outputWindow = {
			opener: {} as unknown,
			location: { href: '' },
			close: vi.fn(),
		};
		vi.stubGlobal('open', vi.fn(() => outputWindow));
		return outputWindow;
	}

	function accessUrl(capability: string, output = 'overlay') {
		return `${window.location.origin}/event/1/screen/screen-1?output=${output}#asset-capability=${capability}`;
	}

	it('copies a URL carrying asset access, obtained at the moment of the hand-out', async () => {
		wrapper = await mountLoadedPage();
		mockCapabilityResponse.value = 'rotated-capability';

		await wrapper.get('[aria-label="Copy output URL"]').trigger('click');
		await flushPromises();

		expect(mockCopyToClipboard).toHaveBeenCalledWith(accessUrl('rotated-capability'), expect.anything());
	});

	it('opens the default output in a tab it points only once asset access is in hand', async () => {
		const outputWindow = stubOutputWindow();
		wrapper = await mountLoadedPage();
		mockCapabilityResponse.value = 'rotated-capability';

		await wrapper.get('[data-open-output="Open output"]').trigger('click');
		await flushPromises();

		expect(window.open).toHaveBeenCalledWith('', '_blank');
		expect(outputWindow.opener).toBeNull();
		expect(outputWindow.location.href).toBe(accessUrl('rotated-capability'));
		expect(outputWindow.close).not.toHaveBeenCalled();
	});

	// A Screen Mode's own outputs are handed out by a second function on this page.
	describe('a Screen Mode’s own outputs', () => {
		beforeEach(() => {
			stubModePolicy({
				outputOptions: [
					{ label: 'Open fill output', icon: 'i-lucide-square', value: 'fill' },
				],
			});
		});

		it('opens the chosen output with asset access obtained at the hand-out', async () => {
			const outputWindow = stubOutputWindow();
			wrapper = await mountLoadedPage();
			mockCapabilityResponse.value = 'rotated-capability';

			await wrapper.get('[data-open-output="Open fill output"]').trigger('click');
			await flushPromises();

			expect(outputWindow.location.href).toBe(accessUrl('rotated-capability', 'fill'));
		});
	});
});

/**
 * Editor Focus Mode (#744). A graphics editor that offers the toggle gets the
 * page: the app sidebar goes (the layout's job), and so does every Screen-level
 * card above the editor. What must stay visible — the save failure, the way
 * back to Screens, and which Screen this is — stays.
 */
describe('screen config page — Editor Focus Mode', () => {
	const focusMode = useEditorFocusMode();
	let wrapper: Awaited<ReturnType<typeof mountPage>> | null = null;

	/** A mode's editor offering Focus Mode, as the graphics editors do. */
	const GraphicsEditorStub = defineComponent({
		components: { EditorFocusModeToggle },
		template: '<div data-testid="mode-editor"><EditorFocusModeToggle /></div>',
	});

	/** A mode's settings that offer no Focus Mode. */
	const PlainSettingsStub = defineComponent({
		template: '<div data-testid="mode-editor" />',
	});

	beforeEach(() => {
		pendingLoads = [];
		route.params.screenId = '1';
		mockScreenStore.screens = [];
		mockScreenStore.screenPresence = new Map();
		focusMode.enabled.value = false;
		stubModePolicy({ displayType: 'overlay', outputOptions: [] });
	});

	afterEach(() => {
		wrapper?.unmount();
		wrapper = null;
		focusMode.enabled.value = false;
		localStorage.clear();
		vi.mocked(getScreenModeSettingsComponent).mockImplementation(() => null);
	});

	async function mountLoadedPage(editor: unknown) {
		vi.mocked(getScreenModeSettingsComponent).mockImplementation(() => editor as never);
		wrapper = await mountPage();
		await flushPromises();
		resolveLoad(1, makeScreen(1));
		await flushPromises();
		return wrapper;
	}

	it('shows the Screen header and settings until the editor\'s toggle enters Focus Mode', async () => {
		const page = await mountLoadedPage(GraphicsEditorStub);

		expect(page.get('[data-testid="layout"]').attributes('data-focus')).toBe('false');
		expect(page.find('[data-testid="open-output-menu"]').exists()).toBe(true);
		expect(page.find('[data-settings-card="Theme"]').exists()).toBe(true);

		await page.get('[data-testid="editor-focus-mode-toggle"]').trigger('click');

		expect(page.get('[data-testid="layout"]').attributes('data-focus')).toBe('true');
		expect(page.find('[data-testid="open-output-menu"]').exists()).toBe(false);
		expect(page.find('[data-settings-card="Theme"]').exists()).toBe(false);
		expect(page.find('[data-testid="mode-editor"]').exists()).toBe(true);
		expect(page.get('[data-testid="focused-screen-name"]').text()).toBe('Screen 1');
		expect(page.text()).toContain('Back to Screens');
	});

	it('opens straight into Focus Mode when this browser left it on', async () => {
		focusMode.enabled.value = true;
		const page = await mountLoadedPage(GraphicsEditorStub);

		expect(page.get('[data-testid="layout"]').attributes('data-focus')).toBe('true');
		expect(page.find('[data-testid="open-output-menu"]').exists()).toBe(false);
	});

	it('exits Focus Mode from the same toggle', async () => {
		focusMode.enabled.value = true;
		const page = await mountLoadedPage(GraphicsEditorStub);

		await page.get('[data-testid="editor-focus-mode-toggle"]').trigger('click');

		expect(page.get('[data-testid="layout"]').attributes('data-focus')).toBe('false');
		expect(page.find('[data-testid="open-output-menu"]').exists()).toBe(true);
	});

	it('ignores the remembered choice for a mode whose settings offer no Focus Mode', async () => {
		focusMode.enabled.value = true;
		const page = await mountLoadedPage(PlainSettingsStub);

		expect(page.get('[data-testid="layout"]').attributes('data-focus')).toBe('false');
		expect(page.find('[data-testid="open-output-menu"]').exists()).toBe(true);
		expect(page.find('[data-testid="focused-screen-name"]').exists()).toBe(false);
	});
});
