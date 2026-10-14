import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';
import BorderRadiusControl from '~/components/Screen/Modes/FeatureMatchOverlay/BorderRadiusControl.vue';

/**
 * A Feature Match Overlay border radius: rounded only, so not a Shape Geometry,
 * and never negative, which a saved radius would not accept.
 */

enableAutoUnmount(afterEach);

describe('border radius control', () => {
	it('bounds every radius below at zero', () => {
		const wrapper = mount(BorderRadiusControl, {
			props: { borderRadius: 8 },
			global: {
				stubs: {
					UFormField: defineComponent({ template: '<div><slot /></div>' }),
					UInputNumber: defineComponent({
						name: 'UInputNumber',
						props: { modelValue: { type: Number, required: false }, min: { type: Number, required: false } },
						template: '<input type="number" />',
					}),
				},
			},
		});

		const inputs = wrapper.findAllComponents({ name: 'UInputNumber' });
		expect(inputs).toHaveLength(5);
		for (const input of inputs)
			expect(input.props('min')).toBe(0);
	});
});
