import type { BackgroundLayer, MetagameModeConfig } from '~~/shared/types/screenConfig';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, ref } from 'vue';
import { createMockScreen } from '../../../helpers/fixtures';

const config = ref<Partial<MetagameModeConfig>>({});
const updateConfig = vi.fn();
const useModeConfigUpdateMock = vi.fn(() => ({
	config: computed(() => config.value),
	saving: computed(() => false),
	updateConfig,
	resetConfig: vi.fn(),
}));

mockNuxtImport('useModeConfigUpdate', () => (...args: unknown[]) => useModeConfigUpdateMock(...args as []));

const EditorStub = defineComponent({
	props: {
		layers: { type: Array, required: true },
		eventId: { type: Number, required: true },
	},
	emits: ['update:layers'],
	template: '<div data-testid="layers-editor" :data-layer-count="layers.length" @click="$emit(\'update:layers\', [{ id: \'added\' }])" />',
});

async function mountComponent() {
	const componentPath = '../../../../app/components/Screen/ModeBackgroundLayersSettings.vue';
	const { default: Settings } = await import(componentPath);

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
		useModeConfigUpdateMock.mockClear();
	});

	it('binds the configuration composable to the given mode', async () => {
		await mountComponent();

		expect(useModeConfigUpdateMock).toHaveBeenCalledWith(
			expect.any(Function),
			expect.any(Function),
			'metagame',
		);
	});

	it('hands the mode\'s own stack to the editor, absent as empty', async () => {
		const wrapper = await mountComponent();
		expect(wrapper.get('[data-testid="layers-editor"]').attributes('data-layer-count')).toBe('0');

		config.value = {
			backgroundLayers: [
				{ id: 'wash', type: 'color', color: '#101010', enabled: true, opacity: 1 },
			] satisfies BackgroundLayer[],
		};
		const populated = await mountComponent();
		expect(populated.get('[data-testid="layers-editor"]').attributes('data-layer-count')).toBe('1');
	});

	it('writes the editor\'s stack onto the mode\'s backgroundLayers key', async () => {
		const wrapper = await mountComponent();

		await wrapper.get('[data-testid="layers-editor"]').trigger('click');

		expect(updateConfig).toHaveBeenCalledWith({ backgroundLayers: [{ id: 'added' }] });
	});
});
