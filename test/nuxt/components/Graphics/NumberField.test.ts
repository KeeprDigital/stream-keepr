import type { NumberScrubGesture } from '~/modules/graphics/numberScrub';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import NumberField from '~/components/Graphics/NumberField.vue';
import { NUMBER_SCRUB_GESTURE } from '~/modules/graphics/numberScrub';
import { nuxtUiStubs } from '../../helpers/nuxtUiStubs';

// A graphics inspector's number field: its label drags the value (E29), its input stays the
// keyboard's way in, and a read-only panel's field does neither.

enableAutoUnmount(afterEach);

beforeAll(() => {
	// happy-dom has no pointer capture; the field only asks for it.
	HTMLElement.prototype.setPointerCapture ??= () => {};
});

interface MountOptions {
	props?: Record<string, unknown>;
	disabledFieldset?: boolean;
	gesture?: NumberScrubGesture;
}

function mountField({ props = {}, disabledFieldset = false, gesture }: MountOptions = {}) {
	const Host = defineComponent({
		setup: (_, { attrs }) => () => h('fieldset', { disabled: disabledFieldset }, [
			h(NumberField, attrs as InstanceType<typeof NumberField>['$props']),
		]),
	});
	return mount(Host, {
		attrs: {
			'label': 'Width',
			'modelValue': 10,
			'aria-label': 'Item width',
			...props,
		},
		global: {
			stubs: nuxtUiStubs,
			provide: gesture
				? { [NUMBER_SCRUB_GESTURE as symbol]: gesture }
				: {},
		},
	});
}

type Wrapper = ReturnType<typeof mountField>;

function handle(wrapper: Wrapper) {
	return wrapper.get('[data-number-scrub]');
}

function emitted(wrapper: Wrapper) {
	return wrapper.findComponent(NumberField).emitted('update:modelValue')?.map(([value]) => value) ?? [];
}

async function drag(wrapper: Wrapper, moves: number[], keys: PointerEventInit = {}) {
	await handle(wrapper).trigger('pointerdown', {
		button: 0,
		pointerId: 1,
		clientX: 0,
		...keys,
	});
	for (const clientX of moves)
		await handle(wrapper).trigger('pointermove', { pointerId: 1, clientX, ...keys });
}

async function release(wrapper: Wrapper) {
	await handle(wrapper).trigger('pointerup', { pointerId: 1 });
}

describe('graphics number field', () => {
	it.each([
		{
			case: 'right raises it a step per 2px',
			moves: [4, 6],
			keys: {},
			props: {},
			values: [12, 13],
		},
		{
			case: 'left lowers it',
			moves: [-4],
			keys: {},
			props: {},
			values: [8],
		},
		{
			case: 'Shift moves ten steps',
			moves: [2],
			keys: { shiftKey: true },
			props: {},
			values: [20],
		},
		{
			case: 'Alt moves a tenth of a step',
			moves: [2],
			keys: { altKey: true },
			props: {},
			values: [10.1],
		},
		{
			case: 'in the field\'s own step',
			moves: [2],
			keys: {},
			props: { step: 0.5 },
			values: [10.5],
		},
		{
			case: 'held at the field\'s maximum',
			moves: [2, 20],
			keys: {},
			props: { max: 11 },
			values: [11],
		},
	])('dragging the label $case', async ({ moves, keys, props, values }) => {
		const wrapper = mountField({ props });
		await drag(wrapper, moves, keys);
		expect(emitted(wrapper)).toEqual(values);
	});

	it('shows that it is scrubbing until the pointer lets go', async () => {
		const wrapper = mountField();
		await drag(wrapper, [2]);
		expect(handle(wrapper).attributes('data-scrubbing')).toBe('true');
		await release(wrapper);
		expect(handle(wrapper).attributes('data-scrubbing')).toBeUndefined();
	});

	it.each([
		{
			case: 'its own disabled',
			options: {
				props: { disabled: true },
			},
		},
		{
			case: 'a disabled fieldset around it',
			options: { disabledFieldset: true },
		},
	])('changes nothing under $case', async ({ options }) => {
		const wrapper = mountField(options);
		await drag(wrapper, [10]);
		expect(emitted(wrapper)).toEqual([]);
		expect(handle(wrapper).attributes('data-scrubbing')).toBeUndefined();
	});

	it('opens its editor\'s gesture at the first change and closes it when the pointer lets go', async () => {
		const gesture = {
			begin: vi.fn(),
			end: vi.fn(),
		};
		const wrapper = mountField({ gesture });
		await drag(wrapper, [1]);
		await release(wrapper);
		expect([gesture.begin.mock.calls.length, gesture.end.mock.calls.length]).toEqual([0, 0]);
		await drag(wrapper, [4, 8]);
		await release(wrapper);
		expect([gesture.begin.mock.calls.length, gesture.end.mock.calls.length]).toEqual([1, 1]);
	});

	it('keeps a drag from activating the label, but not a plain click', async () => {
		const wrapper = mountField();
		await drag(wrapper, [6]);
		await release(wrapper);
		const afterDrag = new MouseEvent('click', { bubbles: true, cancelable: true });
		handle(wrapper).element.dispatchEvent(afterDrag);

		await drag(wrapper, []);
		await release(wrapper);
		const plainClick = new MouseEvent('click', { bubbles: true, cancelable: true });
		handle(wrapper).element.dispatchEvent(plainClick);

		expect([afterDrag.defaultPrevented, plainClick.defaultPrevented]).toEqual([true, false]);
	});

	it('leaves the input as the keyboard\'s way in, and the label out of the tab order', () => {
		const wrapper = mountField();
		expect(handle(wrapper).attributes('tabindex')).toBeUndefined();
		expect(wrapper.find('input[aria-label="Item width"]').exists()).toBe(true);
	});
});
