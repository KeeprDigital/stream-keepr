import type { StoredThemeTokens } from '~~/shared/modules/theme';
import type { ModeConfigTypeMap } from '~~/shared/types/screenConfig';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, ref } from 'vue';
import { createMockScreen } from '~~/test/helpers/fixtures';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import { ScreenSettingsCardStub } from '~~/test/nuxt/helpers/screenThemeOverrides';
import Settings from '~/components/Screen/ModeBackgroundLayersSettings.vue';

// Background & Placement: a plain overlay mode's own Background Layer stack,
// and the Screen inset and alignment its host places it by. It starts closed
// unless it holds a layer or an override.

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

function mountComponent(themeOverrides: StoredThemeTokens = {}) {
	return mount(Settings, {
		props: {
			screen: createMockScreen({ currentMode: 'metagame', themeOverrides }) as never,
			eventId: 7,
			mode: 'metagame' as const,
		},
		global: {
			stubs: {
				...nuxtUiStubs,
				ScreenSettingsSection: ScreenSettingsCardStub,
				ScreenBackgroundLayersEditor: EditorStub,
			},
		},
	});
}

describe('background & Placement', () => {
	beforeEach(() => {
		config.value = {};
		updateConfig.mockClear();
	});

	it('writes the editor\'s stack onto the mode\'s backgroundLayers key', async () => {
		const wrapper = mountComponent();

		await wrapper.get('[data-testid="layers-editor"]').trigger('click');

		expect(updateConfig).toHaveBeenCalledWith({
			backgroundLayers: [
				{ id: 'added' },
			],
		});
	});

	it('holds the Screen inset and alignment, under Placement', () => {
		const wrapper = mountComponent();

		expect(wrapper.get('[data-settings-card]').attributes('data-settings-card')).toBe('Background & Placement');
		expect(wrapper.text()).toContain('Placement');
		expect(wrapper.findAll('[data-token]').map(row => row.attributes('data-token'))).toEqual(['inset', 'alignment']);
	});

	it.each([
		[
			'closed with no layer and no override',
			[],
			{},
			'false',
		],
		[
			'open with a layer',
			[
				{ id: 'plate' },
			],
			{},
			'true',
		],
		[
			'open with the inset overridden',
			[],
			{ inset: 40 },
			'true',
		],
		[
			'open with the alignment overridden',
			[],
			{
				alignment: { horizontal: 'left', vertical: 'top' },
			},
			'true',
		],
		[
			'closed with only another token overridden',
			[],
			{ divider: '#ff0000' },
			'false',
		],
	])('starts %s', (_case, layers, overrides, open) => {
		config.value = { backgroundLayers: layers as never };

		const wrapper = mountComponent(overrides);

		expect(wrapper.get('[data-settings-card]').attributes('data-default-open')).toBe(open);
	});
});
