import type { VueWrapper } from '@vue/test-utils';
import type { GraphicFill } from '~~/shared/types/graphics';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent, h } from 'vue';
import FillFields from '~/components/Graphics/FillFields.vue';

/**
 * The one Graphic Fill fields control, for a Graphic Item's own fill and a Graphic
 * Style Set fill entry: the same fields and the same edits for both, which differ
 * only in the colour picker. An item takes the default hex picker; a Style Set
 * entry passes a palette entry picker into the `color` slot, so its colours are
 * palette entry ids. Every behaviour below runs once for each use.
 */

enableAutoUnmount(afterEach);

const UFormFieldStub = defineComponent({
	props: { label: { type: String, required: false } },
	template: '<div><span>{{ label }}</span><slot /></div>',
});

function numberStub(name: string) {
	return defineComponent({
		name,
		props: {
			modelValue: { type: Number, required: false },
			min: { type: Number, required: false },
			max: { type: Number, required: false },
			disabled: { type: Boolean, required: false },
		},
		emits: ['update:modelValue'],
		template: '<input type="number" :value="modelValue" :disabled="disabled" />',
	});
}

const global = {
	stubs: {
		UFormField: UFormFieldStub,
		UInputNumber: numberStub('UInputNumber'),
		UIOpacityInput: numberStub('UIOpacityInput'),
		UButton: defineComponent({
			props: { disabled: { type: Boolean, required: false } },
			emits: ['click'],
			template: '<button type="button" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
		}),
		USelect: defineComponent({
			name: 'USelect',
			props: { modelValue: { type: String, required: false }, disabled: { type: Boolean, required: false } },
			emits: ['update:modelValue'],
			template: '<select :disabled="disabled" />',
		}),
		UIColorPicker: defineComponent({
			name: 'UIColorPicker',
			props: { modelValue: { type: String, required: false }, disabled: { type: Boolean, required: false } },
			emits: ['update:modelValue'],
			template: '<button type="button" :disabled="disabled" />',
		}),
	},
};

interface ColorSlotProps {
	value: string;
	label: string;
	disabled: boolean;
	update: (value: string) => void;
}

/** A palette entry picker, as the Style Set editor passes one in. */
function paletteSlot({ value, label, disabled, update }: ColorSlotProps) {
	return h('select', {
		'data-palette-picker': '',
		'aria-label': label,
		'value': value,
		disabled,
		'onChange': (event: Event) => update((event.target as HTMLSelectElement).value),
	}, ['brand', 'ink'].map(id => h('option', { value: id }, id)));
}

type Wrapper = VueWrapper<InstanceType<typeof FillFields>>;

interface Use {
	name: string;
	/** Two colours in the use's own vocabulary. */
	colors: [string, string];
	mount: (fill: GraphicFill, props?: Record<string, unknown>) => Wrapper;
	/** The colour a field shows, by its accessible name. */
	colorOf: (wrapper: Wrapper, label: string) => string | undefined;
	pickColor: (wrapper: Wrapper, label: string, color: string) => Promise<void>;
	colorDisabled: (wrapper: Wrapper, label: string) => boolean;
}

const uses: Use[] = [
	{
		name: 'a Graphic Item\'s fill, with the hex picker',
		colors: ['#123456', '#abcdef'],
		mount: (fill, props = {}) => mount(FillFields, { global, props: { fill, ...props } }) as Wrapper,
		colorOf: (wrapper, label) => picker(wrapper, label)?.props('modelValue'),
		pickColor: async (wrapper, label, color) => {
			picker(wrapper, label)!.vm.$emit('update:modelValue', color);
			await flushPromises();
		},
		colorDisabled: (wrapper, label) => picker(wrapper, label)!.props('disabled') === true,
	},
	{
		name: 'a Graphic Style Set fill entry, with a palette entry picker',
		colors: ['brand', 'ink'],
		mount: (fill, props = {}) => mount(FillFields, {
			global,
			props: { fill, ...props },
			slots: { color: paletteSlot },
		}) as Wrapper,
		colorOf: (wrapper, label) => (palette(wrapper, label)?.element as HTMLSelectElement | undefined)?.value,
		pickColor: async (wrapper, label, color) => {
			await palette(wrapper, label)!.setValue(color);
		},
		colorDisabled: (wrapper, label) => palette(wrapper, label)!.attributes('disabled') !== undefined,
	},
];

function picker(wrapper: Wrapper, label: string) {
	return wrapper.findAllComponents({ name: 'UIColorPicker' }).find(entry => entry.attributes('aria-label') === label);
}

function palette(wrapper: Wrapper, label: string) {
	return wrapper.findAll('[data-palette-picker]').find(entry => entry.attributes('aria-label') === label);
}

function numberField(wrapper: Wrapper, name: string, label: string) {
	return wrapper.findAllComponents({ name }).find(entry => entry.attributes('aria-label') === label);
}

function lastEdit(wrapper: Wrapper) {
	return wrapper.emitted('edit')?.at(-1)?.[0];
}

function gradientOf([first, second]: [string, string], count = 2): GraphicFill {
	return {
		type: 'linear-gradient',
		angle: 90,
		stops: Array.from({ length: count }, (_, index) => ({
			color: index === 0 ? first : second,
			position: index / (count - 1),
			opacity: 1,
		})),
	};
}

describe.each(uses)('graphic fill fields for $name', (use) => {
	it('edits a solid fill\'s colour', async () => {
		const wrapper = use.mount({ type: 'solid', color: use.colors[0] });

		expect(use.colorOf(wrapper, 'Fill colour')).toBe(use.colors[0]);
		expect(wrapper.find('[data-testid="graphic-fill-stop"]').exists()).toBe(false);

		await use.pickColor(wrapper, 'Fill colour', use.colors[1]);

		expect(lastEdit(wrapper)).toEqual({ kind: 'solid-fill', color: use.colors[1] });
	});

	it('switches the fill\'s kind', async () => {
		const wrapper = use.mount({ type: 'solid', color: use.colors[0] });

		wrapper.getComponent<typeof FillFields>('[data-testid="graphic-fill-kind"]').vm.$emit('update:modelValue', 'linear-gradient');
		await flushPromises();

		expect(lastEdit(wrapper)).toEqual({ kind: 'fill-kind', fillKind: 'linear-gradient' });
	});

	it('edits each gradient stop\'s colour, position, and opacity', async () => {
		const wrapper = use.mount(gradientOf(use.colors, 3));

		expect(wrapper.findAll('[data-testid="graphic-fill-stop"]')).toHaveLength(3);
		expect(use.colorOf(wrapper, 'Stop 1 colour')).toBe(use.colors[0]);
		expect(use.colorOf(wrapper, 'Stop 3 colour')).toBe(use.colors[1]);

		await use.pickColor(wrapper, 'Stop 2 colour', use.colors[0]);
		expect(lastEdit(wrapper)).toEqual({ kind: 'gradient-stop', index: 1, patch: { color: use.colors[0] } });

		numberField(wrapper, 'UInputNumber', 'Stop 3 position')!.vm.$emit('update:modelValue', 0.8);
		await flushPromises();
		expect(lastEdit(wrapper)).toEqual({ kind: 'gradient-stop', index: 2, patch: { position: 0.8 } });

		numberField(wrapper, 'UIOpacityInput', 'Stop 1 opacity')!.vm.$emit('update:modelValue', null);
		await flushPromises();
		expect(lastEdit(wrapper)).toEqual({ kind: 'gradient-stop', index: 0, patch: { opacity: 1 } });
	});

	it('bounds and edits the gradient angle', async () => {
		const wrapper = use.mount(gradientOf(use.colors));
		const angle = numberField(wrapper, 'UInputNumber', 'Gradient angle')!;

		expect([angle.props('min'), angle.props('max')]).toEqual([-360, 360]);

		angle.vm.$emit('update:modelValue', 135);
		await flushPromises();
		expect(lastEdit(wrapper)).toEqual({ kind: 'gradient-angle', angle: 135 });
	});

	it('adds and removes stops within two to four', async () => {
		const two = use.mount(gradientOf(use.colors, 2));
		expect(two.get('[data-testid="graphic-fill-remove-stop"]').attributes('disabled')).toBeDefined();
		await two.get('[data-testid="graphic-fill-add-stop"]').trigger('click');
		expect(lastEdit(two)).toEqual({ kind: 'stop-count', delta: 1 });

		const four = use.mount(gradientOf(use.colors, 4));
		expect(four.get('[data-testid="graphic-fill-add-stop"]').attributes('disabled')).toBeDefined();
		await four.get('[data-testid="graphic-fill-remove-stop"]').trigger('click');
		expect(lastEdit(four)).toEqual({ kind: 'stop-count', delta: -1 });
	});

	it('names its fields after the surface where one form shows several, and keys its test ids to it', () => {
		const wrapper = use.mount(gradientOf(use.colors), { ariaLabelPrefix: 'Win box', testIdPrefix: 'game-wins-box-graphic-fill' });

		expect(use.colorOf(wrapper, 'Win box stop 1 colour')).toBe(use.colors[0]);
		expect(numberField(wrapper, 'UInputNumber', 'Win box gradient angle')).toBeDefined();
		expect(wrapper.findAll('[data-testid="game-wins-box-graphic-fill-stop"]')).toHaveLength(2);
	});

	it('offers nothing to change while disabled', () => {
		const wrapper = use.mount(gradientOf(use.colors), { disabled: true });

		expect(use.colorDisabled(wrapper, 'Stop 1 colour')).toBe(true);
		expect(numberField(wrapper, 'UInputNumber', 'Gradient angle')!.props('disabled')).toBe(true);
		expect(wrapper.get('[data-testid="graphic-fill-add-stop"]').attributes('disabled')).toBeDefined();
	});
});
