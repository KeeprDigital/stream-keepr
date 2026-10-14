import type { FeatureMatchSourceFramingStyle } from '~~/shared/types/screenConfig';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';
import SourceFramingStyleFields from '~/components/Screen/Modes/FeatureMatchOverlay/SourceFramingStyleFields.vue';

/**
 * A Source Item's border and glow go through the shared border and glow fields
 * with every Feature Match Overlay option: per side, a glow position, a glow only
 * around a visible border, and hex colours.
 */

enableAutoUnmount(afterEach);

const global = {
	stubs: {
		FeatureMatchOverlayBackgroundFields: true,
		FeatureMatchOverlayBorderRadiusControl: true,
		UFormField: defineComponent({ template: '<div><slot /></div>' }),
		USwitch: defineComponent({
			name: 'USwitch',
			props: { modelValue: { type: Boolean, required: false } },
			emits: ['update:modelValue'],
			template: '<button type="button" role="switch" :aria-checked="String(modelValue)" @click="$emit(\'update:modelValue\', !modelValue)" />',
		}),
		UButton: defineComponent({ template: '<button type="button"><slot /></button>' }),
		UInputNumber: defineComponent({ name: 'UInputNumber', template: '<input />' }),
		UIOpacityInput: true,
		USelect: defineComponent({ name: 'USelect', emits: ['update:modelValue'], template: '<select />' }),
		UIColorPicker: defineComponent({
			name: 'UIColorPicker',
			props: { modelValue: { type: String, required: false }, hexOnly: { type: Boolean, required: false } },
			template: '<button type="button" />',
		}),
	},
};

function mountFields(framingStyle: FeatureMatchSourceFramingStyle) {
	return mount(SourceFramingStyleFields, { global, props: { framingStyle } });
}

describe('source framing style fields', () => {
	it('offers the glow only around a visible border', async () => {
		const off = mountFields({ borderVisible: false, glowSize: 8 });
		expect(off.find('[role="switch"][aria-label="Glow"]').exists()).toBe(false);

		await off.get('[role="switch"][aria-label="Border"]').trigger('click');
		expect(off.emitted('update')?.at(-1)?.[0]).toEqual({ borderVisible: true });
	});

	it('edits per-side borders, a glow position, and hex colours', async () => {
		const wrapper = mountFields({ borderVisible: true, borderColor: '#0077a3', glowSize: 8 });

		expect(wrapper.findAll('button').some(button => button.text() === 'Top')).toBe(true);
		expect(wrapper.findAllComponents({ name: 'UIColorPicker' }).every(picker => picker.props('hexOnly'))).toBe(true);

		const position = wrapper.findAllComponents({ name: 'USelect' }).find(select => select.attributes('aria-label') === 'Glow position')!;
		position.vm.$emit('update:modelValue', 'outside');
		await flushPromises();
		expect(wrapper.emitted('update')?.at(-1)?.[0]).toEqual({ glowPosition: 'outside' });
	});
});
