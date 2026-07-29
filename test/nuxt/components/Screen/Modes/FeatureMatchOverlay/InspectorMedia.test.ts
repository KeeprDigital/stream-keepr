import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';

const SectionStub = defineComponent({ template: '<section><slot /></section>' });
const PickerStub = defineComponent({
	emits: ['update:modelValue', 'select'],
	setup(_, { emit }) {
		const reference = { assetId: 'video-asset', revisionId: 'video-revision-4' };
		const asset = {
			kind: 'silent-video',
			facts: { kind: 'silent-video', targetCompatibility: 'all-supported' },
		};
		return {
			select: () => {
				emit('update:modelValue', reference);
				emit('select', asset, reference);
			},
		};
	},
	template: '<button data-testid="select-media" type="button" @click="select">Select</button>',
});

describe('media Graphic Item inspector', () => {
	it('commits the exact selected revision together with inspected media facts', async () => {
		const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
		const item = {
			id: 'media-item',
			type: 'media' as const,
			label: 'Media',
			visible: true,
			x: 0,
			y: 0,
			width: 640,
			height: 360,
			mediaKind: 'image' as const,
			fit: 'contain' as const,
			focalPosition: { horizontal: 0.5, vertical: 0.5 },
			opacity: 1,
			videoTarget: 'chromium' as const,
		};
		config.layout.items = [item];
		const updateConfig = vi.fn();
		const componentPath = '../../../../../../../app/components/Screen/Modes/FeatureMatchOverlay/InspectorMedia.vue';
		const { default: InspectorMedia } = await import(componentPath);
		const wrapper = mount(InspectorMedia, {
			props: {
				config,
				updateConfig,
				screenWidth: 1920,
				screenHeight: 1080,
				eventId: 7,
				item,
			},
			global: {
				stubs: {
					FeatureMatchOverlayControlSection: SectionStub,
					FeatureMatchOverlayGeometryFields: true,
					FeatureMatchOverlayBoxStyleFields: true,
					FeatureMatchOverlayOrderSection: true,
					GraphicsAssetFocusPicker: PickerStub,
					UFormField: SectionStub,
					UInput: true,
					UInputNumber: true,
					USelect: true,
					UButton: true,
					ScreenSettingsToggle: true,
				},
			},
		});

		await wrapper.get('[data-testid="select-media"]').trigger('click');

		const submittedItem = updateConfig.mock.calls.at(-1)?.[0].layout.items[0];
		expect(submittedItem).toMatchObject({
			type: 'media',
			asset: { assetId: 'video-asset', revisionId: 'video-revision-4' },
			mediaKind: 'silent-video',
			videoCompatibility: 'all-supported',
			videoTarget: 'chromium',
		});
	});
});
