import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, nextTick, ref } from 'vue';
import { createMockScreen } from '~~/test/helpers/fixtures';
import Renderer from '~/components/Screen/Renderer.vue';

// The host policy itself is `resolveScreenModeHost`'s own test
// (test/nuxt/app/modules/screenModeHost.test.ts); here it only has to answer.
const { resolveScreenModeHost } = vi.hoisted(() => ({
	resolveScreenModeHost: vi.fn(),
}));

vi.mock('~/modules/screen-mode', async () => ({
	screenBackgroundLayers: (await vi.importActual<typeof import('~/modules/screen-mode/modeTokens')>('~/modules/screen-mode/modeTokens')).screenBackgroundLayers,
	getScreenModeDefinition: (mode: string) => ({
		mode,
		displayComponent: { template: '<div data-testid="display" />' },
	}),
	resolveScreenModeHost,
	// Theme Tokens reaching a display are the rendering test's
	// (test/nuxt/components/Screen/Modes/themeTokenRendering.test.ts).
	screenModeThemeTokenStyle: () => ({}),
	screenModeThemeFontReferences: () => [],
}));

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

function hostReturning(provideOverlayContainer: boolean) {
	resolveScreenModeHost.mockReturnValue({
		containerClass: 'host-container',
		containerStyle: { padding: '24px 48px' },
		wrapperClass: ['host-wrapper'],
		wrapperStyle: {},
		provideOverlayContainer,
	});
}

describe('screenRenderer', () => {
	beforeEach(() => {
		overlayContainer.value = null;
		screen.value = createMockScreen({ currentMode: 'card', screenConfig: null });
		themeTokens.value = undefined;
		hostReturning(true);
	});

	it('renders the mode\'s display inside the container its host resolves for the Event Canvas', () => {
		screen.value = createMockScreen({
			currentMode: 'card',
			screenConfig: { paddingX: 48, paddingY: 24 },
		});

		const wrapper = mountRenderer();

		expect(resolveScreenModeHost).toHaveBeenCalledWith(expect.objectContaining({
			mode: 'card',
			canvas: { width: 1280, height: 720 },
			screenConfig: { paddingX: 48, paddingY: 24 },
		}));
		const container = wrapper.get('.host-container');
		expect(container.attributes('style')).toContain('padding: 24px 48px;');
		expect(container.find('[data-testid="display"]').exists()).toBe(true);
	});

	it.each([
		['provides', true],
		['withholds', false],
	])('%s the overlay container as the host policy says', (_, provides) => {
		hostReturning(provides);

		const wrapper = mountRenderer();

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
});
