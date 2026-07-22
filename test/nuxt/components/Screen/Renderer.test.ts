import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, nextTick, ref } from 'vue';
import { createMockScreen } from '~~/test/helpers/fixtures';

const getScreenModeDefinition = vi.fn();
const resolveScreenModeHost = vi.fn();

vi.mock('~/modules/screen-mode', () => ({
	getScreenModeDefinition,
	resolveScreenModeHost,
}));

const overlayContainer = ref<HTMLElement | null>(null);
const preferredDark = ref(false);
const isPreview = ref(false);
const outputMode = ref<'overlay' | 'fill' | 'key'>('overlay');
const screen = ref(createMockScreen({
	currentMode: 'card',
	screenConfig: null,
}) as any);

vi.mock('@vueuse/core', async (importOriginal) => {
	const mod = await importOriginal<typeof import('@vueuse/core')>();
	return {
		...mod,
		usePreferredDark: () => preferredDark,
	};
});

mockNuxtImport('useScreenContext', () => () => ({
	screen,
	eventId: computed(() => 1),
	interactive: ref(false),
	overlayContainer,
	isPreview,
	outputMode,
}));

const DisplayStub = defineComponent({
	template: '<div data-testid="display-stub" />',
});

async function mountComponent() {
	const componentPath = '../../../../app/components/Screen/Renderer.vue';
	const { default: Renderer } = await import(componentPath);

	return mount(Renderer);
}

describe('screenRenderer', () => {
	beforeEach(() => {
		overlayContainer.value = null;
		preferredDark.value = false;
		isPreview.value = false;
		outputMode.value = 'overlay';
		getScreenModeDefinition.mockReset();
		resolveScreenModeHost.mockReset();
		getScreenModeDefinition.mockImplementation(mode => ({
			mode,
			displayType: mode === 'feature-match' ? 'control' : 'overlay',
			displayComponent: DisplayStub,
		}));
		resolveScreenModeHost.mockImplementation(({ mode, screenConfig }) => {
			if (mode === 'feature-match') {
				const paddingX = screenConfig.paddingX ?? 0;
				const paddingY = screenConfig.paddingY ?? 0;

				return {
					kind: 'control',
					containerClass: 'screen-control-renderer w-full h-full overflow-hidden',
					containerStyle: {
						padding: `${paddingY}px ${paddingX}px`,
					},
					wrapperClass: [],
					wrapperStyle: {},
					provideOverlayContainer: false,
				};
			}

			const paddingX = mode === 'feature-match-overlay' ? 0 : (screenConfig.paddingX ?? 0);
			const paddingY = mode === 'feature-match-overlay' ? 0 : (screenConfig.paddingY ?? 0);
			const width = screenConfig.width ?? (mode === 'feature-match-overlay' ? 1920 : undefined);
			const height = screenConfig.height ?? (mode === 'feature-match-overlay' ? 1080 : undefined);
			const containerStyle: Record<string, string> = {
				width: width ? `${width}px` : '100%',
				height: height ? `${height}px` : '100%',
				flexShrink: '0',
				padding: `${paddingY}px ${paddingX}px`,
				justifyItems: screenConfig.horizontalAlign === 'right' ? 'end' : 'center',
				alignItems: screenConfig.verticalAlign === 'bottom' ? 'end' : 'center',
			};

			if (screenConfig.background && mode !== 'feature-match-overlay')
				containerStyle.background = screenConfig.background;

			return {
				kind: 'overlay',
				containerClass: 'screen-renderer',
				containerStyle,
				wrapperClass: [],
				wrapperStyle: {},
				provideOverlayContainer: true,
			};
		});
		screen.value = createMockScreen({
			currentMode: 'card',
			screenConfig: null,
		}) as any;
	});

	it('renders overlay screens at exact configured dimensions', async () => {
		screen.value = createMockScreen({
			currentMode: 'card',
			screenConfig: {
				width: 1920,
				height: 1080,
				paddingX: 48,
				paddingY: 24,
				horizontalAlign: 'right',
				verticalAlign: 'bottom',
				background: '#111111',
			},
		}) as any;

		const wrapper = await mountComponent();
		const renderer = wrapper.get('.screen-renderer');

		expect(getScreenModeDefinition).toHaveBeenCalledWith('card');
		expect(resolveScreenModeHost).toHaveBeenCalledWith(expect.objectContaining({
			mode: 'card',
			screenConfig: screen.value.screenConfig,
		}));
		expect(renderer.attributes('style')).toContain('width: 1920px;');
		expect(renderer.attributes('style')).toContain('height: 1080px;');
		expect(renderer.attributes('style')).toContain('flex-shrink: 0;');
		expect(renderer.attributes('style')).toContain('padding: 24px 48px;');
		expect(renderer.attributes('style')).toContain('justify-items: end;');
		expect(renderer.attributes('style')).toContain('align-items: end;');
		expect(renderer.attributes('style')).toContain('background: #111111;');
		expect(overlayContainer.value).toBe(renderer.element);
	});

	it('fills available space when width and height are unset', async () => {
		const wrapper = await mountComponent();
		const renderer = wrapper.get('.screen-renderer');

		expect(renderer.attributes('style')).toContain('width: 100%;');
		expect(renderer.attributes('style')).toContain('height: 100%;');
		expect(renderer.attributes('style')).toContain('padding: 0px;');
		expect(renderer.attributes('style')).toContain('justify-items: center;');
		expect(renderer.attributes('style')).toContain('align-items: center;');
	});

	it('applies screen-level padding to control screens', async () => {
		screen.value = createMockScreen({
			currentMode: 'feature-match',
			screenConfig: {
				paddingX: 32,
				paddingY: 16,
			},
		}) as any;

		const wrapper = await mountComponent();
		const renderer = wrapper.get('.screen-control-renderer');

		expect(renderer.attributes('style')).toContain('padding: 16px 32px;');
		expect(overlayContainer.value).toBeNull();
	});

	it('uses broadcast layout host defaults without renderer-owned broadcast policy', async () => {
		screen.value = createMockScreen({
			currentMode: 'feature-match-overlay',
			screenConfig: {
				paddingX: 48,
				paddingY: 24,
				background: '#111111',
			},
		}) as any;

		const wrapper = await mountComponent();
		const renderer = wrapper.get('.screen-renderer');

		expect(resolveScreenModeHost).toHaveBeenCalledWith(expect.objectContaining({
			mode: 'feature-match-overlay',
			screenConfig: screen.value.screenConfig,
		}));
		expect(renderer.attributes('style')).toContain('width: 1920px;');
		expect(renderer.attributes('style')).toContain('height: 1080px;');
		expect(renderer.attributes('style')).toContain('padding: 0px;');
		expect(renderer.attributes('style')).not.toContain('background: #111111;');
	});

	it('paints an editor-only checkerboard behind transparent overlay previews', async () => {
		isPreview.value = true;
		outputMode.value = 'overlay';
		screen.value = createMockScreen({
			currentMode: 'feature-match-overlay',
			screenConfig: {
				width: 1920,
				height: 1080,
			},
		}) as any;

		const wrapper = await mountComponent();

		expect(wrapper.get('.screen-renderer-wrapper').classes()).toContain('transparent-checkerboard-backdrop');

		outputMode.value = 'fill';
		await nextTick();

		expect(wrapper.get('.screen-renderer-wrapper').classes()).not.toContain('transparent-checkerboard-backdrop');
	});
});
