import type { FeatureMatchOverlayModeConfig, FeatureMatchOverlayOutput } from '~~/shared/types/screenConfig';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, ref } from 'vue';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';

const mockConfig = ref<FeatureMatchOverlayModeConfig>(structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG));
const mockOutputMode = ref<FeatureMatchOverlayOutput>('overlay');
const mockPreviewGuides = ref(false);
const mockScreen = ref({ screenConfig: { width: 1920, height: 1080 } });
const mockLoading = ref(false);
const mockError = ref<string | null>(null);
const mockContentUrlsSettled = ref(true);

mockNuxtImport('useScreenContext', () => () => ({
	outputMode: mockOutputMode,
	previewGuides: mockPreviewGuides,
	screen: mockScreen,
}));

mockNuxtImport('useFeatureMatchOverlayModeData', () => () => ({
	config: computed(() => mockConfig.value),
	match: ref(null),
	matchState: ref(null),
	sourceMatch: ref(null),
	round: ref(null),
	phase: ref(null),
	event: ref(null),
	loading: mockLoading,
	error: mockError,
}));

mockNuxtImport('useClockDisplay', () => () => ({
	displayTime: computed(() => '12:34'),
}));

mockNuxtImport('useScreenGraphicAssetContentUrls', () => () => ({
	contentUrl: (reference: { assetId: string; revisionId: string }) =>
		`/private-assets/${reference.assetId}/${reference.revisionId}`,
	contentUrlsSettled: mockContentUrlsSettled,
}));

async function mountComponent() {
	const componentPath = '../../../../../../../app/components/Screen/Modes/FeatureMatchOverlay/Display.vue';
	const { default: Display } = await import(componentPath);

	return mount(Display, {
		global: {
			stubs: {
				FeatureMatchOverlayFrameAnimation: true,
				FeatureMatchOverlayFrameMedia: true,
				FeatureMatchOverlayGameWinsWidget: true,
				FeatureMatchOverlayStatusWidget: true,
				FeatureMatchOverlayTemplateLines: true,
			},
		},
	});
}

function groupLayerConfig(): FeatureMatchOverlayModeConfig {
	const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
	config.layout.items = [
		{
			id: 'framed-group',
			type: 'widget-group',
			label: 'Framed Group',
			visible: true,
			x: 10,
			y: 20,
			width: 300,
			height: 80,
			zIndex: 5,
			overflow: 'clip',
			arrangement: { mode: 'canvas', padding: 0 },
			surfaceStyle: {
				backgroundColor: '#111111',
				backgroundOpacity: 0.5,
				backgroundGradient: 'linear-gradient(90deg, #b80054, #7f22f6)',
				borderVisible: true,
				borderColor: '#ff00aa',
				borderWidth: 4,
				borderRadius: 12,
				glowSize: 8,
				glowOpacity: 1,
			},
			defaultChildSurfaceStyle: {
				textColor: '#ffffff',
				fontSize: 20,
			},
			children: [
				{
					id: 'full-child',
					label: 'Full Child',
					visible: true,
					widget: { type: 'clock' },
					layout: { mode: 'canvas', x: 0, y: 0, width: 300, height: 80 },
				},
			],
		},
	];
	return config;
}

describe('featureMatchOverlayDisplay', () => {
	beforeEach(() => {
		mockConfig.value = groupLayerConfig();
		mockOutputMode.value = 'overlay';
		mockPreviewGuides.value = false;
		mockScreen.value = { screenConfig: { width: 1920, height: 1080 } };
		mockLoading.value = false;
		mockError.value = null;
		mockContentUrlsSettled.value = true;
		Object.defineProperty(document, 'fonts', {
			configurable: true,
			value: {
				add: vi.fn(),
				delete: vi.fn(),
				load: vi.fn().mockResolvedValue([]),
				check: vi.fn().mockReturnValue(true),
				ready: Promise.resolve(),
			},
		});
	});

	it('renders Widget Group appearance above clipped child widgets', async () => {
		const wrapper = await mountComponent();
		const group = wrapper.get('.feature-match-overlay-widget-group');
		const groupElement = group.element as HTMLElement;
		const children = Array.from(groupElement.children);

		expect(groupElement.style.overflow).toBe('visible');
		expect(groupElement.style.background).toBe('');
		expect(groupElement.style.borderTop).toBe('');
		expect(children[0]?.classList.contains('feature-match-overlay-widget-group__backdrop')).toBe(true);
		expect(children[1]?.classList.contains('feature-match-overlay-widget-group__children')).toBe(true);
		expect(children[2]?.classList.contains('feature-match-overlay-widget-group__frame')).toBe(true);

		const childLayer = wrapper.get('.feature-match-overlay-widget-group__children');
		const child = wrapper.get('.feature-match-overlay-widget-group__child');
		const backdrop = wrapper.get('.feature-match-overlay-widget-group__backdrop');
		const frame = wrapper.get('.feature-match-overlay-widget-group__frame');
		const childLayerElement = childLayer.element as HTMLElement;
		const childElement = child.element as HTMLElement;
		const backdropElement = backdrop.element as HTMLElement;
		const frameElement = frame.element as HTMLElement;

		expect(childLayerElement.style.overflow).toBe('hidden');
		expect(backdropElement.style.opacity).toBe('0.5');
		expect(childElement.style.background).toBe('transparent');
		expect(frameElement.style.borderTopWidth).toBe('4px');
		expect(frameElement.style.borderTopStyle).toBe('solid');
		expect(frameElement.style.boxShadow).toContain('0 0 8px');
		expect(frameElement.style.zIndex).toBe('2');
	});

	it('hides preview and output rendering until every exact font revision is ready', async () => {
		mockConfig.value.layout.items[0]!.surfaceStyle = {
			font: {
				kind: 'asset',
				reference: {
					assetId: 'font-asset' as never,
					revisionId: 'font-revision-2' as never,
				},
			},
		};
		let finishLoad!: () => void;
		const load = new Promise<void>((resolve) => {
			finishLoad = resolve;
		});
		class MockFontFace {
			constructor(
				public family: string,
				public source: string,
			) {}

			async load() {
				await load;
				return this;
			}
		}
		vi.stubGlobal('FontFace', MockFontFace);

		const wrapper = await mountComponent();
		const overlay = wrapper.get('.feature-match-overlay');
		expect(overlay.attributes('data-font-ready')).toBe('false');
		expect(overlay.attributes('data-export-ready')).toBe('false');
		expect((overlay.element as HTMLElement).style.visibility).toBe('hidden');

		finishLoad();
		await load;
		await vi.waitFor(() => {
			expect(overlay.attributes('data-font-ready')).toBe('true');
		});
		expect(overlay.attributes('data-export-ready')).toBe('true');
		expect((document.fonts.add as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
	});

	it('retries exact font loading when private content URLs finish resolving', async () => {
		mockConfig.value.layout.items[0]!.surfaceStyle = {
			font: {
				kind: 'asset',
				reference: {
					assetId: 'font-asset' as never,
					revisionId: 'font-revision-3' as never,
				},
			},
		};
		mockContentUrlsSettled.value = false;
		const load = vi.fn().mockResolvedValue(undefined);
		class MockFontFace {
			constructor(
				public family: string,
				public source: string,
			) {}

			load = load;
		}
		vi.stubGlobal('FontFace', MockFontFace);

		const wrapper = await mountComponent();
		expect(wrapper.get('.feature-match-overlay').attributes('data-font-ready')).toBe('false');
		expect(load).not.toHaveBeenCalled();

		mockContentUrlsSettled.value = true;
		await vi.waitFor(() => {
			expect(load).toHaveBeenCalled();
			expect(wrapper.get('.feature-match-overlay').attributes('data-font-ready')).toBe('true');
		});
	});

	it('blocks a VP9-alpha take outside a proven Chromium target', async () => {
		mockConfig.value.layout.items = [{
			id: 'restricted-video',
			type: 'media',
			label: 'Restricted VP9 alpha',
			visible: true,
			x: 0,
			y: 0,
			width: 640,
			height: 360,
			mediaKind: 'silent-video',
			asset: {
				assetId: 'video-asset' as never,
				revisionId: 'video-revision-1' as never,
			},
			fit: 'contain',
			opacity: 1,
			borderRadius: 0,
			videoCompatibility: 'chromium-transparency',
			videoTarget: 'chromium',
		}];

		const wrapper = await mountComponent();

		expect(wrapper.get('.feature-match-overlay').attributes('data-export-ready')).toBe('false');
	});
});
