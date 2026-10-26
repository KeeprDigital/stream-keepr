import type { ModeConfigTypeMap } from '~~/shared/types/screenConfig';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, ref } from 'vue';
import { createMockScreen } from '~~/test/helpers/fixtures';
import Settings from '~/components/Screen/ModeBackgroundLayersSettings.vue';

const config = ref<Partial<ModeConfigTypeMap['metagame']>>({});
const updateConfig = vi.fn();
mockNuxtImport('useModeConfigUpdate', () => () => ({
	config: computed(() => config.value),
	saving: computed(() => false),
	updateConfig,
	resetConfig: vi.fn(),
}));

const EditorStub = defineComponent({
	props: {
		layers: { type: Array, required: true },
		eventId: { type: Number, required: true },
	},
	emits: ['update:layers'],
	template: '<div data-testid="layers-editor" :data-layer-count="layers.length" @click="$emit(\'update:layers\', [{ id: \'added\' }])" />',
});

async function mountComponent() {
	return mount(Settings, {
		props: {
			screen: createMockScreen({ currentMode: 'metagame' }),
			eventId: 7,
			mode: 'metagame' as const,
		},
		global: {
			stubs: {
				ScreenSettingsCard: defineComponent({ template: '<section><slot /></section>' }),
				ScreenBackgroundLayersEditor: EditorStub,
			},
		},
	});
}

describe('screenModeBackgroundLayersSettings', () => {
	beforeEach(() => {
		config.value = {};
		updateConfig.mockClear();
	});

	it('writes the editor\'s stack onto the mode\'s backgroundLayers key', async () => {
		const wrapper = await mountComponent();

		await wrapper.get('[data-testid="layers-editor"]').trigger('click');

		expect(updateConfig).toHaveBeenCalledWith({
			backgroundLayers: [
				{ id: 'added' },
			],
		});
	});
});
