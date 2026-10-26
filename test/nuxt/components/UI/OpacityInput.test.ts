import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import OpacityInput from '~/components/UI/OpacityInput.vue';

enableAutoUnmount(afterEach);

// The real icon loads asynchronously and logs a failed fetch after the file
// tears down, which Vitest reports as an unhandled error.
const global = {
	stubs: { UIcon: true },
};

describe('opacity input', () => {
	it('bounds an opacity to 0–1 in steps of 0.05', () => {
		const wrapper = mount(OpacityInput, {
			global,
			props: { modelValue: 0.5 },
		});
		const input = wrapper.getComponent({ name: 'UInputNumber' });
		expect(input.props()).toMatchObject({
			modelValue: 0.5,
			min: 0,
			max: 1,
			step: 0.05,
		});
	});

	it('passes the edited value through, cleared included, for the owner to resolve', async () => {
		const wrapper = mount(OpacityInput, {
			global,
			props: { modelValue: 0.5 },
		});
		const input = wrapper.getComponent({ name: 'UInputNumber' });
		input.vm.$emit('update:modelValue', 0.25);
		input.vm.$emit('update:modelValue', null);
		expect(wrapper.emitted('update:modelValue')).toEqual([
			[0.25],
			[null],
		]);
	});

	it('carries the owner\'s attributes to the input', () => {
		const wrapper = mount(OpacityInput, {
			global,
			props: { modelValue: 1 },
			attrs: { 'aria-label': 'Media opacity', 'data-testid': 'media-opacity', 'size': 'xs' },
		});
		const input = wrapper.getComponent({ name: 'UInputNumber' });
		expect(input.props('size')).toBe('xs');
		expect(wrapper.find('[data-testid="media-opacity"]').exists()).toBe(true);
	});
});
