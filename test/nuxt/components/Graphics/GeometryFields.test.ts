import type { GraphicAnchorPoint, GraphicRect } from '~~/shared/types/graphics';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import GeometryFields from '~/components/Graphics/GeometryFields.vue';

/**
 * The one geometry fields control, shared by the compositor Inspector and Source
 * Item bounds: what an author sees in each Geometry Unit, and the canonical pixels
 * each entry, resize, and align action emits.
 */

enableAutoUnmount(afterEach);

const UButtonStub = defineComponent({
	props: { label: { type: String, required: false } },
	emits: ['click'],
	template: '<button type="button" @click="$emit(\'click\')">{{ label }}</button>',
});

const UInputNumberStub = defineComponent({
	name: 'UInputNumber',
	props: { modelValue: { type: Number, required: false } },
	emits: ['update:modelValue'],
	template: '<input type="number" :value="modelValue" />',
});

const global = {
	stubs: {
		UFormField: defineComponent({ template: '<div><slot /></div>' }),
		UFieldGroup: defineComponent({ template: '<div><slot /></div>' }),
		UButton: UButtonStub,
		UInputNumber: UInputNumberStub,
		UINinePointPicker: defineComponent({ name: 'UINinePointPicker', template: '<div data-testid="anchor-picker" />' }),
	},
};

// A 400×100 item at (100, 200) on a 1920×1080 canvas.
const rect: GraphicRect = { x: 100, y: 200, width: 400, height: 100 };
const canvas = { width: 1920, height: 1080 };

function mountFields(props: { anchor?: GraphicAnchorPoint; stacked?: boolean; rect?: GraphicRect } = {}) {
	return mount(GeometryFields, {
		global,
		props: { rect: props.rect ?? rect, container: canvas, anchor: props.anchor ?? 'center', stacked: props.stacked },
	});
}

type Wrapper = ReturnType<typeof mountFields>;

function field(wrapper: Wrapper, ariaLabel: string) {
	return wrapper.findAllComponents({ name: 'UInputNumber' }).find(input => input.attributes('aria-label') === ariaLabel);
}

function shown(wrapper: Wrapper, ariaLabel: string) {
	return field(wrapper, ariaLabel)?.props('modelValue');
}

async function enter(wrapper: Wrapper, ariaLabel: string, value: number) {
	field(wrapper, ariaLabel)!.vm.$emit('update:modelValue', value);
	await flushPromises();
	return wrapper.emitted('update')?.at(-1)?.[0];
}

async function chooseUnit(wrapper: Wrapper, label: 'px' | '%' | '±16') {
	await wrapper.findAll('button').find(button => button.text() === label)!.trigger('click');
	await flushPromises();
}

async function align(wrapper: Wrapper, ariaLabel: string) {
	await wrapper.get(`button[aria-label="${ariaLabel}"]`).trigger('click');
	return wrapper.emitted('update')?.at(-1)?.[0];
}

beforeEach(() => {
	localStorage.clear();
});

describe('geometry fields', () => {
	it('shows the anchored coordinate and size in pixels by default', async () => {
		const wrapper = mountFields();
		await flushPromises();

		expect(shown(wrapper, 'Item x')).toBe(300);
		expect(shown(wrapper, 'Item y')).toBe(250);
		expect(shown(wrapper, 'Item width')).toBe(400);
		expect(shown(wrapper, 'Item height')).toBe(100);
	});

	it('shows a percentage of the container to two decimal places', async () => {
		const wrapper = mountFields();
		await chooseUnit(wrapper, '%');

		// 300 of 1920 is 15.625%, 400 of 1920 is 20.8333…%.
		expect(shown(wrapper, 'Item x')).toBe(15.63);
		expect(shown(wrapper, 'Item width')).toBe(20.83);
	});

	it('emits the stored top-left pixels an anchored percentage entry names', async () => {
		const wrapper = mountFields();
		await chooseUnit(wrapper, '%');

		// 50% of 1920 is 960 for the centre, so the 400-wide item starts at 760.
		expect(await enter(wrapper, 'Item x', 50)).toEqual({ x: 760 });
	});

	it('reads the centred ±16 grid back into pixels', async () => {
		const wrapper = mountFields();
		await chooseUnit(wrapper, '±16');

		expect(shown(wrapper, 'Item x')).toBe(-11);
		// 0 on the centred grid is the canvas centre: 540, less half the 100 height.
		expect(await enter(wrapper, 'Item y', 0)).toEqual({ y: 490 });
		// A size is not offset: 8 of 32 is a quarter of 1920, grown around the centre at 300.
		expect(await enter(wrapper, 'Item width', 8)).toEqual({ x: 60, y: 200, width: 480, height: 100 });
	});

	it('resizes around the anchor and never below one pixel', async () => {
		const wrapper = mountFields({ anchor: 'top-left' });

		expect(await enter(wrapper, 'Item width', 0)).toEqual({ x: 100, y: 200, width: 1, height: 100 });
		expect(await enter(wrapper, 'Item height', -20)).toEqual({ x: 100, y: 200, width: 400, height: 1 });
	});

	it('aligns the item\'s edge with the container\'s, not its anchor point', async () => {
		const wrapper = mountFields({ anchor: 'bottom-right' });

		expect(await align(wrapper, 'Hard left')).toEqual({ x: 0 });
		expect(await align(wrapper, 'Center horizontally')).toEqual({ x: 760 });
		expect(await align(wrapper, 'Hard right')).toEqual({ x: 1520 });
		expect(await align(wrapper, 'Hard top')).toEqual({ y: 0 });
		expect(await align(wrapper, 'Center vertically')).toEqual({ y: 490 });
		expect(await align(wrapper, 'Hard bottom')).toEqual({ y: 980 });
	});

	it('offers only width and height for an item its group positions', async () => {
		const wrapper = mountFields({ stacked: true });
		await flushPromises();

		expect(field(wrapper, 'Item x')).toBeUndefined();
		expect(field(wrapper, 'Item y')).toBeUndefined();
		expect(wrapper.find('[data-testid="anchor-picker"]').exists()).toBe(false);
		expect(wrapper.find('button[aria-label="Hard left"]').exists()).toBe(false);
		expect(shown(wrapper, 'Item width')).toBe(400);
	});

	describe('linked width and height', () => {
		async function link(wrapper: Wrapper) {
			await wrapper.get('button[aria-label="Link width and height"]').trigger('click');
			await flushPromises();
		}

		it('sets the height from the captured ratio when the width changes', async () => {
			const wrapper = mountFields();
			await link(wrapper);

			// 400×100 is 4:1, so 200 wide is 50 high, still centred on (300, 250).
			expect(await enter(wrapper, 'Item width', 200)).toEqual({ x: 200, y: 225, width: 200, height: 50 });
		});

		it('sets the width from the height in pixels, whatever the Geometry Unit', async () => {
			const wrapper = mountFields();
			await link(wrapper);
			await chooseUnit(wrapper, '%');

			// 50% of the 1080 canvas is 540 high, so 2160 wide (not 50% of 1920), around (300, 250).
			expect(await enter(wrapper, 'Item height', 50)).toEqual({ x: -780, y: -20, width: 2160, height: 540 });
		});

		it('keeps the ratio captured on linking, not the item\'s current one', async () => {
			const wrapper = mountFields();
			await link(wrapper);
			await wrapper.setProps({ rect: { ...rect, height: 200 } });

			expect(await enter(wrapper, 'Item width', 200)).toMatchObject({ width: 200, height: 50 });
		});

		it('never sets the other size below one pixel', async () => {
			const wrapper = mountFields({ anchor: 'top-left' });
			await link(wrapper);

			expect(await enter(wrapper, 'Item width', 2)).toEqual({ x: 100, y: 200, width: 2, height: 1 });
		});

		it('leaves the other size alone once unlinked', async () => {
			const wrapper = mountFields({ anchor: 'top-left' });
			await link(wrapper);
			await link(wrapper);

			expect(await enter(wrapper, 'Item width', 200)).toEqual({ x: 100, y: 200, width: 200, height: 100 });
		});

		it('is unlinked by default', async () => {
			const wrapper = mountFields({ anchor: 'top-left' });

			expect(wrapper.get('button[aria-label="Link width and height"]').attributes('aria-pressed')).toBe('false');
			expect(await enter(wrapper, 'Item height', 50)).toEqual({ x: 100, y: 200, width: 400, height: 50 });
		});

		it('is not offered for an item its group sizes', async () => {
			const wrapper = mountFields({ stacked: true });
			await flushPromises();

			expect(wrapper.find('button[aria-label="Link width and height"]').exists()).toBe(false);
		});
	});

	describe('the remembered Geometry Unit', () => {
		it('opens in the unit last chosen in any geometry fields control', async () => {
			const first = mountFields();
			await chooseUnit(first, '%');
			first.unmount();

			const next = mountFields();
			await flushPromises();

			expect(shown(next, 'Item x')).toBe(15.63);
		});

		it('follows a unit chosen in another open control', async () => {
			const inspector = mountFields();
			const source = mountFields();
			await chooseUnit(inspector, '±16');

			expect(shown(source, 'Item x')).toBe(-11);
		});

		it('falls back to pixels for a stored value that is not a Geometry Unit', async () => {
			localStorage.setItem('editor-geometryUnit', 'furlongs');
			const wrapper = mountFields();
			await flushPromises();

			expect(shown(wrapper, 'Item x')).toBe(300);
		});

		it('works in pixels when the browser refuses storage', async () => {
			const denied = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
				throw new DOMException('denied', 'SecurityError');
			});
			try {
				const wrapper = mountFields();
				await flushPromises();
				expect(shown(wrapper, 'Item x')).toBe(300);

				await chooseUnit(wrapper, '%');
				expect(shown(wrapper, 'Item x')).toBe(15.63);
			}
			finally {
				denied.mockRestore();
			}
		});
	});
});
