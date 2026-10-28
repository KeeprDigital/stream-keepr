import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, h, nextTick, reactive, ref } from 'vue';
import { createMockScreen } from '~~/test/helpers/fixtures';
import Renderer from '~/components/Screen/Renderer.vue';
import { SCREEN_MODE_READY_TIMEOUT_MS, useScreenModeReady } from '~/modules/screen-mode/readiness';

// The host policy itself is `resolveScreenModeHost`'s own test
// (test/unit/app/modules/screenModeHost.test.ts); here it only has to answer.
const { resolveScreenModeHost } = vi.hoisted(() => ({
	resolveScreenModeHost: vi.fn(),
}));

/** Whether each mode's display declares its data settled; unset means it has. */
const readiness = reactive<Record<string, boolean>>({});
/** Whether each mode's display still marks part of itself loading. */
const pending = reactive<Record<string, boolean>>({});

const displays = new Map<string, ReturnType<typeof defineComponent>>();

/** A mode's display: it declares readiness as `modeReady` says and marks itself pending as `modePending` says. */
function displayFor(mode: string) {
	if (!displays.has(mode)) {
		displays.set(mode, defineComponent({
			setup() {
				useScreenModeReady(() => readiness[mode] ?? true);
				return () => h('div', {
					'data-testid': 'display',
					'data-mode': mode,
					'data-render-pending': pending[mode] ? '' : undefined,
				});
			},
		}));
	}
	return displays.get(mode)!;
}

vi.mock('~/modules/screen-mode', async () => ({
	...await vi.importActual<typeof import('~/modules/screen-mode/readiness')>('~/modules/screen-mode/readiness'),
	screenBackgroundLayers: (await vi.importActual<typeof import('~/modules/screen-mode/modeTokens')>('~/modules/screen-mode/modeTokens')).screenBackgroundLayers,
	getScreenModeDefinition: (mode: string) => ({
		mode,
		displayComponent: displayFor(mode),
	}),
	resolveScreenModeHost,
	// Theme Tokens reaching a display are the rendering test's
	// (test/nuxt/components/Screen/Modes/themeTokenRendering.test.ts).
	screenModeThemeTokenStyle: () => ({}),
	screenModeThemeFontReferences: () => [],
}));

enableAutoUnmount(afterEach);

const overlayContainer = ref<HTMLElement | null>(null);
const screen = ref();
const themeTokens = ref<Record<string, unknown>>();
const eventCanvas = ref({ width: 1280, height: 720 });

mockNuxtImport('useScreenContext', () => () => ({
	screen,
	eventId: computed(() => 1),
	interactive: ref(false),
	overlayContainer,
	isPreview: ref(false),
	outputMode: ref('overlay'),
	themeTokens,
	eventCanvas,
}));

const colorLayer = {
	id: 'wash',
	type: 'color',
	color: '#101010',
	enabled: true,
	opacity: 1,
};

const themeLayer = { ...colorLayer, id: 'theme-wash', color: '#203040' };

/** The ids of the layers the host stack paints, or null when it paints none. */
function paintedLayerIds(wrapper: ReturnType<typeof mountRenderer>) {
	const stack = wrapper.find('[data-testid="mode-background-stack"]');
	return stack.exists()
		? stack.attributes('data-layer-ids')
		: null;
}

function mountRenderer() {
	return mount(Renderer, {
		global: {
			stubs: {
				ScreenBackgroundLayerStack: {
					props: ['layers'],
					template: '<div data-testid="mode-background-stack" :data-layer-count="layers.length" :data-layer-ids="layers.map(layer => layer.id).join()" />',
				},
			},
		},
	});
}

/** The rendering of `mode`, if the renderer holds one. */
function frame(wrapper: ReturnType<typeof mountRenderer>, mode: string) {
	return wrapper.find(`[data-screen-mode="${mode}"]`);
}

function onProgram(wrapper: ReturnType<typeof mountRenderer>, mode: string) {
	const rendering = frame(wrapper, mode);
	return rendering.exists() && !rendering.attributes('style')?.includes('visibility: hidden');
}

/** Lets a rendering that has become ready reach program. */
async function settle() {
	await flushPromises();
	await nextTick();
	await flushPromises();
}

function hostReturning(provideOverlayContainer: boolean) {
	resolveScreenModeHost.mockReturnValue({
		containerClass: 'host-container',
		containerStyle: { padding: '24px' },
		provideOverlayContainer,
	});
}

describe('screenRenderer', () => {
	beforeEach(() => {
		for (const key of Object.keys(readiness))
			delete readiness[key];
		for (const key of Object.keys(pending))
			delete pending[key];
		overlayContainer.value = null;
		screen.value = createMockScreen({ currentMode: 'card' });
		themeTokens.value = undefined;
		hostReturning(true);
	});

	it('renders the mode\'s display inside the container its host resolves for the Event Canvas and Theme', () => {
		screen.value = createMockScreen({
			currentMode: 'card',
			themeOverrides: {
				alignment: { horizontal: 'left', vertical: 'top' },
			},
		});
		themeTokens.value = { inset: 24 };

		const wrapper = mountRenderer();

		expect(resolveScreenModeHost).toHaveBeenCalledWith(expect.objectContaining({
			mode: 'card',
			canvas: { width: 1280, height: 720 },
			theme: { inset: 24 },
			overrides: {
				alignment: { horizontal: 'left', vertical: 'top' },
			},
		}));
		const container = wrapper.get('.host-container');
		expect(container.attributes('style')).toContain('padding: 24px;');
		expect(container.find('[data-testid="display"]').exists()).toBe(true);
	});

	it.each([
		['provides', true],
		['withholds', false],
	])('%s the overlay container as the host policy says', async (_, provides) => {
		hostReturning(provides);

		const wrapper = mountRenderer();
		await settle();

		expect(overlayContainer.value).toBe(provides
			? wrapper.get('.host-container').element
			: null);
	});

	it('paints a capable mode\'s own background layers behind its display', () => {
		screen.value = createMockScreen({
			currentMode: 'card',
			modeConfigs: {
				card: {
					backgroundLayers: [colorLayer],
				},
			} as never,
		});

		const wrapper = mountRenderer();
		const container = wrapper.get('.host-container');
		const stack = wrapper.get('[data-testid="mode-background-stack"]');

		expect(stack.attributes('data-layer-count')).toBe('1');
		// The stack precedes the display, and the container isolates so the
		// negative-z stack cannot escape beneath the Screen background.
		expect(container.element.firstElementChild).toBe(stack.element);
		expect(container.attributes('style')).toContain('isolation: isolate;');
	});

	it.each([
		[
			'a mode without background layers',
			createMockScreen({ currentMode: 'card' }),
		],
		[
			'the Background Screen, whose display owns its layers',
			createMockScreen({
				currentMode: 'background',
				modeConfigs: {
					background: {
						layers: [colorLayer],
					},
				} as never,
			}),
		],
	])('paints no host stack for %s', (_, mockScreen) => {
		screen.value = mockScreen;

		const wrapper = mountRenderer();

		expect(wrapper.find('[data-testid="mode-background-stack"]').exists()).toBe(false);
		expect(wrapper.get('.host-container').attributes('style')).not.toContain('isolation');
	});

	it('keeps a graphics host transparent under a Theme background', () => {
		themeTokens.value = {
			background: [themeLayer],
		};
		screen.value = createMockScreen({ currentMode: 'broadcast-graphics' });

		expect(paintedLayerIds(mountRenderer())).toBeNull();
	});

	it('restyles a live plain mode when its Theme\'s background changes', async () => {
		const wrapper = mountRenderer();
		expect(paintedLayerIds(wrapper)).toBeNull();

		themeTokens.value = {
			background: [themeLayer],
		};
		await nextTick();

		expect(paintedLayerIds(wrapper)).toBe('theme-wash');
	});

	it('paints the Screen\'s override of the Theme background', () => {
		themeTokens.value = {
			background: [themeLayer],
		};
		screen.value = createMockScreen({
			currentMode: 'standings',
			themeOverrides: {
				background: [
					{ ...colorLayer, id: 'override-wash' },
				],
			},
		});

		expect(paintedLayerIds(mountRenderer())).toBe('override-wash');
	});

	describe('rendering readiness', () => {
		afterEach(() => {
			vi.useRealTimers();
		});

		it('shows nothing on a first load until the mode is ready', async () => {
			readiness.card = false;
			const wrapper = mountRenderer();
			await settle();
			expect(frame(wrapper, 'card').attributes('data-screen-mode-ready')).toBe('false');
			expect(onProgram(wrapper, 'card')).toBe(false);
			expect(overlayContainer.value).toBeNull();

			readiness.card = true;
			await settle();

			expect(onProgram(wrapper, 'card')).toBe(true);
			expect(overlayContainer.value).toBe(frame(wrapper, 'card').element);
		});

		it.each([
			[
				'its display declares its data settled',
				{ ready: false, loading: false },
				() => { readiness.standings = true; },
			],
			[
				'nothing inside it is still loading',
				{ ready: true, loading: true },
				() => { pending.standings = false; },
			],
		])('keeps the mode on program until the incoming mode is ready: %s', async (_, incoming, settleIncoming) => {
			const wrapper = mountRenderer();
			await settle();
			readiness.standings = incoming.ready;
			pending.standings = incoming.loading;

			screen.value = createMockScreen({ currentMode: 'standings' });
			await settle();
			expect(onProgram(wrapper, 'card')).toBe(true);
			expect(frame(wrapper, 'standings').exists()).toBe(true);
			expect(onProgram(wrapper, 'standings')).toBe(false);

			settleIncoming();
			await settle();

			expect(frame(wrapper, 'card').exists()).toBe(false);
			expect(onProgram(wrapper, 'standings')).toBe(true);
			expect(overlayContainer.value).toBe(frame(wrapper, 'standings').element);
		});

		it('drops the incoming mode when the Screen goes back to the mode on program', async () => {
			const wrapper = mountRenderer();
			await settle();
			readiness.standings = false;
			screen.value = createMockScreen({ currentMode: 'standings' });
			await settle();

			screen.value = createMockScreen({ currentMode: 'card' });
			await settle();

			expect(frame(wrapper, 'standings').exists()).toBe(false);
			expect(onProgram(wrapper, 'card')).toBe(true);
		});

		it('shows a mode that never settles once the ready timeout passes', async () => {
			vi.useFakeTimers();
			vi.spyOn(console, 'warn').mockImplementation(() => {});
			const wrapper = mountRenderer();
			await vi.advanceTimersByTimeAsync(0);
			readiness.standings = false;
			screen.value = createMockScreen({ currentMode: 'standings' });
			await vi.advanceTimersByTimeAsync(SCREEN_MODE_READY_TIMEOUT_MS - 1);
			expect(onProgram(wrapper, 'card')).toBe(true);

			await vi.advanceTimersByTimeAsync(1);

			expect(frame(wrapper, 'card').exists()).toBe(false);
			expect(onProgram(wrapper, 'standings')).toBe(true);
		});
	});
});
