import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';
import BorderRadiusControl from '~/components/Screen/Modes/FeatureMatchOverlay/BorderRadiusControl.vue';

/**
 * A Feature Match Overlay border radius: rounded only, so not a Shape Geometry,
 * bounded to what a saved radius accepts: never negative, never past the pixel cap.
 */

enableAutoUnmount(afterEach);

describe('border radius control', () => {
	it('bounds every radius to what a saved radius accepts', () => {
		const wrapper = mount(BorderRadiusControl, {
			props: { borderRadius: 8 },
			global: {
				stubs: {
					UFormField: defineComponent({ template: '<div><slot /></div>' }),
					UInputNumber: defineComponent({
						name: 'UInputNumber',
						props: {
							modelValue: { type: Number, required: false },
							min: { type: Number, required: false },
							max: { type: Number, required: false },
						},
						template: '<input type="number" />',
					}),
				},
			},
		});

		const inputs = wrapper.findAllComponents({ name: 'UInputNumber' });
		expect(inputs).toHaveLength(5);
		for (const input of inputs) {
			expect(input.props('min')).toBe(0);
			expect(input.props('max')).toBe(10_000);
		}
	});
});
