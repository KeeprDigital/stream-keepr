import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import NinePointPicker from '~/components/UI/NinePointPicker.vue';

enableAutoUnmount(afterEach);

// The real icon loads asynchronously and logs a failed fetch after the file
// tears down, which Vitest reports as an unhandled error.
const global = {
	stubs: { UIcon: true },
};

function buttons(wrapper: ReturnType<typeof mount>) {
	return wrapper.findAll('button');
}

describe('nine-point picker', () => {
	it('offers the nine points in reading order, named for assistive technology', () => {
		const wrapper = mount(NinePointPicker, {
			global,
			props: { modelValue: 'center' },
		});
		expect(buttons(wrapper).map(button => button.attributes('aria-label'))).toEqual([
			'Top left',
			'Top',
			'Top right',
			'Left',
			'Centre',
			'Right',
			'Bottom left',
			'Bottom',
			'Bottom right',
		]);
	});

	it('is one radio group whose only checked point is the current one', () => {
		const wrapper = mount(NinePointPicker, {
			global,
			props: { modelValue: 'bottom-right' },
			attrs: { 'aria-label': 'Graphic Anchor Point' },
		});
		expect(wrapper.get('[role="radiogroup"]').attributes('aria-label')).toBe('Graphic Anchor Point');
		expect(buttons(wrapper).every(button => button.attributes('role') === 'radio')).toBe(true);
		const checked = buttons(wrapper).filter(button => button.attributes('aria-checked') === 'true');
		expect(checked.map(button => button.attributes('aria-label'))).toEqual(['Bottom right']);
	});

	it('is one tab stop, on the current point', () => {
		const wrapper = mount(NinePointPicker, {
			global,
			props: { modelValue: 'top' },
		});
		const tabStops = buttons(wrapper).filter(button => button.attributes('tabindex') === '0');
		expect(tabStops.map(button => button.attributes('aria-label'))).toEqual(['Top']);
	});

	it('moves across the grid with the arrow keys, stopping at its edges', async () => {
		const wrapper = mount(NinePointPicker, {
			global,
			props: { modelValue: 'center' },
		});
		const centre = wrapper.get('[aria-label="Centre"]');
		await centre.trigger('keydown', { key: 'ArrowRight' });
		await centre.trigger('keydown', { key: 'ArrowUp' });
		await wrapper.setProps({ modelValue: 'top-right' });
		await wrapper.get('[aria-label="Top right"]').trigger('keydown', { key: 'ArrowRight' });
		expect(wrapper.emitted('update:modelValue')).toEqual([
			['right'],
			['top'],
		]);
	});

	it('emits the chosen point', async () => {
		const wrapper = mount(NinePointPicker, {
			global,
			props: { modelValue: 'center' },
		});
		await wrapper.get('[aria-label="Top right"]').trigger('click');
		expect(wrapper.emitted('update:modelValue')).toEqual([
			['top-right'],
		]);
	});

	it('offers a disabled point but never chooses it', async () => {
		const wrapper = mount(NinePointPicker, {
			global,
			props: {
				modelValue: 'top',
				disabledPoints: ['center'],
			},
		});
		const centre = wrapper.get('[aria-label="Centre"]');
		expect(centre.attributes('disabled')).toBeDefined();
		expect(buttons(wrapper).filter(button => button.attributes('disabled') !== undefined)).toHaveLength(1);
		await centre.trigger('click');
		expect(wrapper.emitted('update:modelValue')).toBeUndefined();
	});

	it('moves past a disabled point to the next one in the same direction', async () => {
		const wrapper = mount(NinePointPicker, {
			global,
			props: {
				modelValue: 'top',
				disabledPoints: ['center'],
			},
		});
		await wrapper.get('[aria-label="Top"]').trigger('keydown', { key: 'ArrowDown' });
		await wrapper.setProps({ modelValue: 'left' });
		await wrapper.get('[aria-label="Left"]').trigger('keydown', { key: 'ArrowRight' });
		expect(wrapper.emitted('update:modelValue')).toEqual([
			['bottom'],
			['right'],
		]);
	});

	it('stays put when only disabled points lie in that direction', async () => {
		const wrapper = mount(NinePointPicker, {
			global,
			props: {
				modelValue: 'top',
				disabledPoints: ['center', 'bottom'],
			},
		});
		await wrapper.get('[aria-label="Top"]').trigger('keydown', { key: 'ArrowDown' });
		expect(wrapper.emitted('update:modelValue')).toBeUndefined();
	});

	it('emits nothing while disabled', async () => {
		const wrapper = mount(NinePointPicker, {
			global,
			props: { modelValue: 'center', disabled: true },
		});
		await wrapper.get('[aria-label="Top right"]').trigger('click');
		expect(wrapper.emitted('update:modelValue')).toBeUndefined();
	});
});
