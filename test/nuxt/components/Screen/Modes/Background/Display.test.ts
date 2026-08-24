import type { GraphicAssetReference } from '~~/shared/types/graphicsAsset';
import type { BackgroundLayer, BackgroundModeConfig } from '~~/shared/types/screenConfig';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, ref } from 'vue';

const config = ref<BackgroundModeConfig>({ layers: [] });

mockNuxtImport('useScreenModeConfig', () => () => computed(() => config.value));

const contentUrl = vi.fn((reference: GraphicAssetReference) => `/resolved/${reference.assetId}/${reference.revisionId}`);

mockNuxtImport('useScreenGraphicAssetContentUrls', () => () => ({
	contentUrl,
	contentRefusal: () => undefined,
	contentUrlsSettled: computed(() => true),
}));

const MediaBackgroundStub = defineComponent({
	props: {
		media: { type: Object, required: true },
	},
	template: '<div data-testid="media-background" />',
});

const AnimationSurfaceStub = defineComponent({
	props: {
		effect: { type: String, required: true },
		params: { type: Object, required: false, default: undefined },
	},
	template: '<div data-testid="animation-surface" />',
});

function layer(overrides: Partial<BackgroundLayer> & Pick<BackgroundLayer, 'id' | 'type'>): BackgroundLayer {
	return {
		enabled: true,
		opacity: 1,
		...overrides,
	} as BackgroundLayer;
}

async function mountComponent() {
	const componentPath = '../../../../../../app/components/Screen/Modes/Background/Display.vue';
	const { default: Display } = await import(componentPath);

	return mount(Display, {
		global: {
			stubs: {
				ScreenMediaBackground: MediaBackgroundStub,
				ScreenAnimationEffectSurface: AnimationSurfaceStub,
			},
		},
	});
}

describe('screenModesBackgroundDisplay', () => {
	beforeEach(() => {
		config.value = { layers: [] };
		contentUrl.mockClear();
	});

	it('renders an empty stack as a black surface', async () => {
		const wrapper = await mountComponent();

		expect(wrapper.find('.background-screen').exists()).toBe(true);
		expect(wrapper.findAll('.background-screen__layer')).toHaveLength(0);
	});

	it('renders enabled layers in painter’s order, first at the bottom', async () => {
		config.value = {
			layers: [
				layer({ id: 'base', type: 'color', color: '#101010' }),
				layer({ id: 'grad', type: 'gradient', gradient: 'linear-gradient(#000, #123)' }),
			],
		};

		const wrapper = await mountComponent();
		const rendered = wrapper.findAll('.background-screen__layer');

		expect(rendered).toHaveLength(2);
		expect(rendered[0]!.attributes('data-layer-id')).toBe('base');
		expect(rendered[1]!.attributes('data-layer-id')).toBe('grad');
	});

	it('does not render a disabled layer', async () => {
		config.value = {
			layers: [
				layer({ id: 'base', type: 'color', color: '#101010', enabled: false }),
				layer({ id: 'grad', type: 'gradient', gradient: 'linear-gradient(#000, #123)' }),
			],
		};

		const wrapper = await mountComponent();

		expect(wrapper.findAll('.background-screen__layer')).toHaveLength(1);
		expect(wrapper.find('[data-layer-id="base"]').exists()).toBe(false);
	});

	it('applies each layer’s own opacity to that layer alone', async () => {
		config.value = {
			layers: [
				layer({ id: 'wash', type: 'color', color: '#101010', opacity: 0.35 }),
			],
		};

		const wrapper = await mountComponent();

		expect(wrapper.find('[data-layer-id="wash"]').attributes('style')).toContain('opacity: 0.35');
	});

	it('paints a colour layer and a gradient layer with their own values', async () => {
		config.value = {
			layers: [
				layer({ id: 'wash', type: 'color', color: 'rgb(16, 16, 16)' }),
				layer({ id: 'grad', type: 'gradient', gradient: 'linear-gradient(#000, #123)' }),
			],
		};

		const wrapper = await mountComponent();

		expect(wrapper.find('[data-layer-id="wash"]').attributes('style')).toContain('background-color: rgb(16, 16, 16)');
		expect(wrapper.find('[data-layer-id="grad"]').attributes('style')).toContain('linear-gradient');
	});

	it('renders a URL-sourced image layer directly and an asset-sourced one through the resolved content URL', async () => {
		config.value = {
			layers: [
				layer({ id: 'remote', type: 'image', source: { kind: 'url', url: '/plates/one.png' }, fit: 'contain' } as Partial<BackgroundLayer> & Pick<BackgroundLayer, 'id' | 'type'>),
				layer({ id: 'library', type: 'image', source: { kind: 'asset', assetId: 'asset-1', revisionId: 'revision-1' }, fit: 'cover' } as never),
			],
		};

		const wrapper = await mountComponent();
		const images = wrapper.findAll('.background-screen__layer img');

		expect(images).toHaveLength(2);
		expect(images[0]!.attributes('src')).toBe('/plates/one.png');
		expect(images[1]!.attributes('src')).toBe('/resolved/asset-1/revision-1');
	});

	it('renders a video layer through the shared media background at full opacity — the layer wrapper owns opacity', async () => {
		config.value = {
			layers: [
				layer({
					id: 'loop',
					type: 'video',
					opacity: 0.5,
					source: { kind: 'url', url: '/loops/rain.mp4' },
					fit: 'fill',
					playbackRate: 1.5,
					loop: false,
				} as never),
			],
		};

		const wrapper = await mountComponent();
		const media = wrapper.getComponent(MediaBackgroundStub).props('media');

		expect(media).toMatchObject({
			enabled: true,
			type: 'video',
			url: '/loops/rain.mp4',
			fit: 'fill',
			playbackRate: 1.5,
			loop: false,
			opacity: 1,
		});
		expect(wrapper.find('[data-layer-id="loop"]').attributes('style')).toContain('opacity: 0.5');
	});

	it('mounts an animation layer on the shared surface with its sparse params filled from the schema', async () => {
		config.value = {
			layers: [
				layer({ id: 'anim', type: 'animation', animation: { effect: 'fog', params: { speed: 2 } } } as never),
			],
		};

		const wrapper = await mountComponent();
		const surface = wrapper.getComponent(AnimationSurfaceStub);

		expect(surface.props('effect')).toBe('fog');
		expect(surface.props('params')).toMatchObject({ speed: 2, blurFactor: 0.55 });
	});

	it('renders nothing for an animation layer naming an effect this build does not ship', async () => {
		config.value = {
			layers: [
				layer({ id: 'anim', type: 'animation', animation: { effect: 'not-an-effect' } } as never),
			],
		};

		const wrapper = await mountComponent();

		expect(wrapper.find('[data-testid="animation-surface"]').exists()).toBe(false);
	});
});
