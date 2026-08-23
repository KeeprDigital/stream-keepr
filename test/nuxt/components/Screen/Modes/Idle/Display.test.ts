import type { IdleModeConfig } from '~~/shared/types/screenConfig';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { computed, defineComponent, ref } from 'vue';
import { DEFAULT_SCREEN_MEDIA_BACKGROUND_CONFIG } from '~~/shared/types/screenConfig';

const config = ref<IdleModeConfig>({});

mockNuxtImport('useScreenModeConfig', () => () => computed(() => config.value));

const MediaBackgroundStub = defineComponent({
	props: {
		media: { type: Object, required: true },
	},
	template: '<div data-testid="media-background" />',
});

async function mountComponent() {
	const componentPath = '../../../../../../app/components/Screen/Modes/Idle/Display.vue';
	const { default: Display } = await import(componentPath);

	return mount(Display, {
		global: {
			stubs: {
				ScreenMediaBackground: MediaBackgroundStub,
			},
		},
	});
}

describe('screenModesIdleDisplay', () => {
	beforeEach(() => {
		config.value = {};
	});

	it('always renders the idle surface with a media background', async () => {
		const wrapper = await mountComponent();

		expect(wrapper.find('.idle-state').exists()).toBe(true);
		expect(wrapper.find('[data-testid="media-background"]').exists()).toBe(true);
	});

	it('feeds the media background the defaults when the mode has no config', async () => {
		const wrapper = await mountComponent();

		expect(wrapper.getComponent(MediaBackgroundStub).props('media')).toEqual(DEFAULT_SCREEN_MEDIA_BACKGROUND_CONFIG);
	});

	it('merges a partial media background config over the defaults', async () => {
		config.value = {
			mediaBackground: {
				...DEFAULT_SCREEN_MEDIA_BACKGROUND_CONFIG,
				enabled: true,
				url: 'https://example.test/background.mp4',
			},
		};

		const wrapper = await mountComponent();

		expect(wrapper.getComponent(MediaBackgroundStub).props('media')).toEqual({
			...DEFAULT_SCREEN_MEDIA_BACKGROUND_CONFIG,
			enabled: true,
			url: 'https://example.test/background.mp4',
		});
	});
});
