import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, ref } from 'vue';
import { createMockScreen } from '~~/test/helpers/fixtures';
import Renderer from '~/components/Screen/Renderer.vue';

// The host policy itself is `resolveScreenModeHost`'s own test
// (test/nuxt/app/modules/screenModeHost.test.ts); here it only has to answer.
const { resolveScreenModeHost } = vi.hoisted(() => ({
	resolveScreenModeHost: vi.fn(),
}));

vi.mock('~/modules/screen-mode', () => ({
	getScreenModeDefinition: (mode: string) => ({
		mode,
		displayComponent: { template: '<div data-testid="display" />' },
	}),
	resolveScreenModeHost,
	// Theme Tokens reaching a display are the rendering test's
	// (test/nuxt/components/Screen/Modes/themeTokenRendering.test.ts).
	screenModeThemeTokenStyle: () => ({}),
}));

const overlayContainer = ref<HTMLElement | null>(null);
const screen = ref();

mockNuxtImport('useScreenContext', () => () => ({
	screen,
	eventId: computed(() => 1),
	interactive: ref(false),
	overlayContainer,
	isPreview: ref(false),
	outputMode: ref('overlay'),
}));

const colorLayer = {
	id: 'wash',
	type: 'color',
	color: '#101010',
	enabled: true,
	opacity: 1,
};

function mountRenderer() {
	return mount(Renderer, {
		global: {
			stubs: {
				ScreenBackgroundLayerStack: {
					props: ['layers'],
					template: '<div data-testid="mode-background-stack" :data-layer-count="layers.length" />',
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
		hostReturning(true);
	});

	it('renders the mode\'s display inside the container its host policy resolves', () => {
		screen.value = createMockScreen({
			currentMode: 'card',
			screenConfig: { width: 1920, height: 1080 },
		});

		const wrapper = mountRenderer();

		expect(resolveScreenModeHost).toHaveBeenCalledWith(expect.objectContaining({
			mode: 'card',
			screenConfig: { width: 1920, height: 1080 },
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
});
