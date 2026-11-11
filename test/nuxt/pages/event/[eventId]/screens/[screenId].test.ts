import type { VueWrapper } from '@vue/test-utils';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick, reactive } from 'vue';
import { UButtonStub, UDropdownMenuStub, UModalStub, UTooltipStub } from '~~/test/nuxt/helpers/nuxtUiStubs';
import { ScreenSettingsCardStub } from '~~/test/nuxt/helpers/screenThemeOverrides';
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
	useEventScreenModeSelectOptions: vi.fn(() => ({ value: [] })),
	getScreenModeSettingsComponent: vi.fn(() => null),
}));

const route = reactive({
	params: { eventId: '1', screenId: '1' } as Record<string, string>,
});

const mockEventStore = reactive({
	event: { id: 1 } as { id: number; themeId?: string },
	eventTheme: null,
	holdEventTheme: vi.fn(),
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
	sendScreenCommand: vi.fn(async () => {}),
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

const UContainerStub = defineComponent({
	template: '<div><slot /></div>',
});

/** The Screen-wide look, which loads its Event's Theme; here it only has to be on the page or not. */
const ThemeTokensSettingsStub = defineComponent({
	template: '<div data-settings-card="Screen-wide look" />',
});

/** The empty state's title, so a test can tell "not found" from the Screen's own cards. */
const EmptyStateStub = defineComponent({
	props: {
		title: { type: String, default: '' },
	},
	template: '<div data-empty-state>{{ title }}</div>',
});

const CardStub = defineComponent({
	template: '<div><slot /></div>',
});

/** Renders its default slot, which the default stub does not — the hand-out controls live in one. */
const SlotStub = defineComponent({
	template: '<div><slot /></div>',
});

/** Opens the header menu behind `trigger` and chooses the item labelled `label`. */
async function chooseMenuItem(page: VueWrapper, trigger: string, label: string) {
	await page.get(trigger).trigger('click');
	const item = page.findAll('[role="menuitem"]').find(entry => entry.text() === label);
	if (!item)
		throw new Error(`No menu item "${label}" behind ${trigger}`);
	await item.trigger('click');
	await flushPromises();
}

const OPEN_MENU = '[data-hand-out="open"]';
const MORE_MENU = '[data-testid="screen-actions-menu"]';

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

async function mountPage(stubOverrides: Record<string, unknown> = {}) {
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
				UModal: UModalStub,
				UAlert: true,
				ScreenSettingsSection: ScreenSettingsCardStub,
				ScreenThemeTokensSettings: ThemeTokensSettingsStub,
				...stubOverrides,
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

		// Screen 2 never loaded, so the page holds no watch on it to let go: the
		// watch is counted, and letting go of another surface's would end it.
		route.params.screenId = '3';
		await nextTick();
		expect(mockScreenStore.unsubscribeFromScreenPresence).not.toHaveBeenCalledWith(2);
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

	// A Screen deleted elsewhere leaves the store's list, and the page stops
	// offering its settings rather than editing what no longer exists.
	it('shows the Screen as not found once it is deleted from under the page', async () => {
		mockScreenStore.screens = [
			makeScreen(1),
		];
		wrapper = await mountPage({ UIEmptyState: EmptyStateStub });
		await flushPromises();
		resolveLoad(1, makeScreen(1));
		await flushPromises();
		expect(wrapper.text()).toContain('Screen 1');

		mockScreenStore.screens = [];
		await nextTick();

		expect(wrapper.get('[data-empty-state]').text()).toBe('Screen not found');
		expect(wrapper.text()).not.toContain('Screen 1');
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
 * Wiring only: the shared hand-out owns its controls and their words, and
 * `useScreenOutputAccessUrl` fresh-per-hand-out capabilities (#231, #1104).
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

	describe('a Screen Mode’s own outputs', () => {
		beforeEach(() => {
			stubModePolicy({ outputs: ['fill'] });
		});

		it('opens the chosen output with asset access obtained at the hand-out', async () => {
			const outputWindow = stubOutputWindow();
			wrapper = await mountLoadedPage();
			mockCapabilityResponse.value = 'rotated-capability';

			await chooseMenuItem(wrapper, OPEN_MENU, 'Open fill output');

			expect(outputWindow.location.href).toBe(accessUrl('rotated-capability', 'fill'));
		});
	});
});

/**
 * The header keeps what an operator reaches for at the top level and puts the rare
 * and destructive actions in one menu, where Rotate and Reset still confirm (#1063).
 */
describe('screen config page — the Screen header', () => {
	let wrapper: Awaited<ReturnType<typeof mountPage>> | null = null;

	const resetConfig = vi.fn();
	const modeSettings = { resetBlocked: false };

	/** A mode's settings, exposing what the header's Reset reaches. */
	const ModeSettingsStub = defineComponent({
		setup(_, { expose }) {
			expose({ resetConfig, resetBlocked: modeSettings.resetBlocked, saving: false });
			return {};
		},
		template: '<div data-testid="mode-editor" />',
	});

	beforeEach(() => {
		pendingLoads = [];
		route.params.screenId = '1';
		mockScreenStore.screens = [];
		mockScreenStore.sendScreenCommand.mockClear();
		modeSettings.resetBlocked = false;
		resetConfig.mockClear();
		stubModePolicy({ displayType: 'overlay', outputs: [] });
		vi.mocked(getScreenModeSettingsComponent).mockImplementation(() => ModeSettingsStub as never);
		mockApiFetch.mockReset();
		mockApiFetch.mockResolvedValue({ assetCapability: 'rotated-capability' });
	});

	afterEach(() => {
		wrapper?.unmount();
		wrapper = null;
		vi.mocked(getScreenModeSettingsComponent).mockImplementation(() => null);
	});

	async function mountLoadedPage() {
		wrapper = await mountPage();
		await flushPromises();
		resolveLoad(1, makeScreen(1));
		await flushPromises();
		return wrapper;
	}

	function rotations() {
		return mockApiFetch.mock.calls.filter(([path, options]) =>
			path === '/api/events/1/screens/1/asset-capability' && options?.method === 'POST');
	}

	function dialogButton(page: VueWrapper, label: string) {
		const button = page.findAll('[role="dialog"] button').find(entry => entry.text() === label);
		if (!button)
			throw new Error(`No "${label}" button in an open dialog`);
		return button;
	}

	it('offers the output hand-out, Refresh and one menu at the top level, in that order', async () => {
		const page = await mountLoadedPage();

		expect(page.findAll('[data-header-action]').map(action => action.attributes('data-header-action'))).toEqual([
			'hand-out',
			'refresh',
			'more',
		]);
	});

	it('holds Identify, Debug, Rotate Asset Access and Reset mode settings in the one menu', async () => {
		const page = await mountLoadedPage();

		await page.get(MORE_MENU).trigger('click');

		expect(page.findAll('[role="menuitem"]').map(item => item.text())).toEqual([
			'Identify',
			'Debug',
			'Rotate Asset Access',
			'Reset mode settings',
		]);
	});

	it('refreshes the Screen\'s outputs on one click', async () => {
		const page = await mountLoadedPage();

		await page.get('[data-header-action="refresh"]').trigger('click');
		await flushPromises();

		expect(mockScreenStore.sendScreenCommand).toHaveBeenCalledExactlyOnceWith(1, 'refresh');
	});

	it.each([
		{ item: 'Identify', command: 'identify' },
		{ item: 'Debug', command: 'debug' },
	])('sends $command when $item is chosen from the menu', async ({ item, command }) => {
		const page = await mountLoadedPage();

		await chooseMenuItem(page, MORE_MENU, item);

		expect(mockScreenStore.sendScreenCommand).toHaveBeenCalledExactlyOnceWith(1, command);
	});

	// Choosing a destructive item only asks; the write waits for the dialog's own button.
	describe.each([
		{
			item: 'Rotate Asset Access',
			confirm: 'Rotate Access',
			writes: () => rotations().length,
		},
		{
			item: 'Reset mode settings',
			confirm: 'Reset',
			writes: () => resetConfig.mock.calls.length,
		},
	])('$item', ({ item, confirm, writes }) => {
		it('asks before it writes, and writes once confirmed', async () => {
			const page = await mountLoadedPage();

			await chooseMenuItem(page, MORE_MENU, item);

			expect(page.get('[role="dialog"]').attributes('aria-label')).toBe(item);
			expect(writes()).toBe(0);

			await dialogButton(page, confirm).trigger('click');
			await flushPromises();

			expect(writes()).toBe(1);
			expect(page.find('[role="dialog"]').exists()).toBe(false);
		});

		it('writes nothing when cancelled', async () => {
			const page = await mountLoadedPage();

			await chooseMenuItem(page, MORE_MENU, item);
			await dialogButton(page, 'Cancel').trigger('click');
			await flushPromises();

			expect(page.find('[role="dialog"]').exists()).toBe(false);
			expect(writes()).toBe(0);
		});
	});

	it('keeps the rotation dialog open when the rotation fails, so it can be retried', async () => {
		mockApiFetch.mockRejectedValue(new Error('offline'));
		const page = await mountLoadedPage();

		await chooseMenuItem(page, MORE_MENU, 'Rotate Asset Access');
		await dialogButton(page, 'Rotate Access').trigger('click');
		await flushPromises();

		expect(page.find('[role="dialog"]').exists()).toBe(true);
	});

	// A graphics host's reset is an authoring write: without the lease it is not offered.
	it('disables Reset mode settings, with the reason, while the mode\'s settings block it', async () => {
		modeSettings.resetBlocked = true;
		const page = await mountLoadedPage();

		await page.get(MORE_MENU).trigger('click');
		const reset = page.findAll('[role="menuitem"]').find(entry => entry.text() === 'Reset mode settings')!;

		expect(reset.attributes('disabled')).toBeDefined();
		expect(reset.attributes('aria-description')).toBe('Another session is editing this Screen\'s graphics');
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
		stubModePolicy({ displayType: 'overlay', outputs: [] });
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
		expect(page.find('[data-testid="output-hand-out"]').exists()).toBe(true);
		expect(page.find('[data-settings-card="Screen-wide look"]').exists()).toBe(true);

		await page.get('[data-testid="editor-focus-mode-toggle"]').trigger('click');

		expect(page.get('[data-testid="layout"]').attributes('data-focus')).toBe('true');
		expect(page.find('[data-testid="output-hand-out"]').exists()).toBe(false);
		expect(page.find('[data-settings-card="Screen-wide look"]').exists()).toBe(false);
		expect(page.find('[data-testid="mode-editor"]').exists()).toBe(true);
		expect(page.get('[data-testid="focused-screen-name"]').text()).toBe('Screen 1');
		expect(page.text()).toContain('Back to Screens');
	});

	it('opens straight into Focus Mode when this browser left it on', async () => {
		focusMode.enabled.value = true;
		const page = await mountLoadedPage(GraphicsEditorStub);

		expect(page.get('[data-testid="layout"]').attributes('data-focus')).toBe('true');
		expect(page.find('[data-testid="output-hand-out"]').exists()).toBe(false);
	});

	it('exits Focus Mode from the same toggle', async () => {
		focusMode.enabled.value = true;
		const page = await mountLoadedPage(GraphicsEditorStub);

		await page.get('[data-testid="editor-focus-mode-toggle"]').trigger('click');

		expect(page.get('[data-testid="layout"]').attributes('data-focus')).toBe('false');
		expect(page.find('[data-testid="output-hand-out"]').exists()).toBe(true);
	});

	it('ignores the remembered choice for a mode whose settings offer no Focus Mode', async () => {
		focusMode.enabled.value = true;
		const page = await mountLoadedPage(PlainSettingsStub);

		expect(page.get('[data-testid="layout"]').attributes('data-focus')).toBe('false');
		expect(page.find('[data-testid="output-hand-out"]').exists()).toBe(true);
		expect(page.find('[data-testid="focused-screen-name"]').exists()).toBe(false);
	});
});

/**
 * A plain overlay mode's page ends with Background & Placement, then the
 * Screen-wide look, each closed unless it holds a layer or an override (#970).
 */
describe('screen config page — Background & Placement, then the Screen-wide look', () => {
	let wrapper: Awaited<ReturnType<typeof mountPage>> | null = null;

	const ModeSettingsStub = defineComponent({
		template: '<section data-settings-card="Mode settings" />',
	});

	beforeEach(() => {
		pendingLoads = [];
		route.params.screenId = '1';
		mockScreenStore.screenPresence = new Map();
		stubModePolicy({ displayType: 'overlay', outputs: [] });
		vi.mocked(getScreenModeSettingsComponent).mockImplementation(() => ModeSettingsStub as never);
	});

	afterEach(() => {
		wrapper?.unmount();
		wrapper = null;
		vi.mocked(getScreenModeSettingsComponent).mockImplementation(() => null);
		mockEventStore.event = { id: 1 };
	});

	// Each card's own open rule is tested at its home; this shows the page wires the Screen to both,
	// and holds the one Screen Theme Override instance both read the Event's Theme through.
	it('orders the cards after the mode\'s settings, each opening on what it holds, over one read of the Event\'s Theme', async () => {
		mockEventStore.event = { id: 1, themeId: 'brand' };
		mockApiFetch.mockReset();
		mockApiFetch.mockResolvedValue({
			id: 'brand',
			name: 'Brand',
			tokens: {},
			revision: 1,
		});
		const themeOverrides = { inset: 40 };
		const screen = {
			...makeScreen(1),
			currentMode: 'standings',
			modeConfigs: {},
			themeOverrides,
		};
		mockScreenStore.screens = [screen];
		wrapper = await mountPage({ ScreenThemeTokensSettings: false });
		await flushPromises();
		resolveLoad(1, screen);
		await flushPromises();

		const cards = wrapper.findAll('[data-settings-card]');
		expect(cards.map(card => card.attributes('data-settings-card'))).toEqual([
			'Mode settings',
			'Background & Placement',
			'Screen-wide look',
		]);
		expect(cards.slice(1).map(card => card.attributes('data-default-open'))).toEqual(['true', 'false']);
		expect(wrapper.findAll('[data-token="inset"]')).toHaveLength(1);
		expect(wrapper.findAll('[data-token="alignment"]')).toHaveLength(1);
		expect(mockApiFetch.mock.calls.filter(([path]) => path === '/api/themes/brand')).toHaveLength(1);
	});
});
