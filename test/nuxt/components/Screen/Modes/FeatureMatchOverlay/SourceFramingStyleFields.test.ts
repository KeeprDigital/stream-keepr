import type { FeatureMatchSourceFramingStyle } from '~~/shared/types/screenConfig';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';
import SourceFramingStyleFields from '~/components/Screen/Modes/FeatureMatchOverlay/SourceFramingStyleFields.vue';

// A Source Item edits its shape: radii, which border sides show and where its glow
// falls. Its fill, border and glow are the Theme's `source-surface` (#831).

enableAutoUnmount(afterEach);

const global = {
	stubs: {
		FeatureMatchOverlayBorderRadiusControl: true,
		UFormField: defineComponent({ template: '<div><slot /></div>' }),
		USwitch: defineComponent({
			name: 'USwitch',
			props: {
				modelValue: { type: Boolean, required: false },
			},
			emits: ['update:modelValue'],
			template: '<button type="button" role="switch" :aria-checked="String(modelValue)" @click="$emit(\'update:modelValue\', !modelValue)" />',
		}),
		UButton: defineComponent({ template: '<button type="button"><slot /></button>' }),
		UInputNumber: defineComponent({ name: 'UInputNumber', template: '<input />' }),
		UIOpacityInput: true,
		USelect: defineComponent({
			name: 'USelect',
			emits: ['update:modelValue'],
			template: '<select />',
		}),
		UIColorPicker: defineComponent({
			name: 'UIColorPicker',
			props: {
				modelValue: { type: String, required: false },
				hexOnly: { type: Boolean, required: false },
			},
			template: '<button type="button" />',
		}),
	},
};

function mountFields(framingStyle: FeatureMatchSourceFramingStyle) {
	return mount(SourceFramingStyleFields, {
		global,
		props: { framingStyle },
	});
}

describe('source framing style fields', () => {
	it('offers no colour, border or glow of the Source Item\'s own', () => {
		const wrapper = mountFields({});

		expect(wrapper.findComponent({ name: 'UIColorPicker' }).exists()).toBe(false);
		expect(wrapper.find('[role="switch"]').exists()).toBe(false);
	});

	it('switches a border side and chooses where the glow falls', async () => {
		const wrapper = mountFields({ borderTopVisible: false });

		const top = wrapper.get('button[title="Top border"]');
		expect(top.attributes('aria-pressed')).toBe('false');
		await top.trigger('click');
		expect(wrapper.emitted('update')?.at(-1)?.[0]).toEqual({ borderTopVisible: true });

		const position = wrapper.findAllComponents({ name: 'USelect' }).find(select => select.attributes('aria-label') === 'Glow position')!;
		position.vm.$emit('update:modelValue', 'outside');
		await flushPromises();
		expect(wrapper.emitted('update')?.at(-1)?.[0]).toEqual({ glowPosition: 'outside' });
	});
});
