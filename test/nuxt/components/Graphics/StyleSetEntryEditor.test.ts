import type { DOMWrapper, VueWrapper } from '@vue/test-utils';
import type { GraphicStyleSetEntry } from '~~/shared/types/graphicStyleSet';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';
import { squareShapeGeometry } from '~~/shared/modules/graphics';

/**
 * The value controls for one Graphic Style Set entry.
 *
 * The rules under test are the ones that make an entry worth having. Every colour is
 * a *picker of palette entries* rather than a colour input, so a brand change reaches
 * every preset that links to it. A single-field edit keeps its siblings, because the
 * editor writes whole entry values. A Graphic Fill's kind replaces the value rather
 * than merging into it, because it is a discriminated union. And an observer can read
 * every preset and write none of them.
 */

enableAutoUnmount(afterEach);

const UFormFieldStub = defineComponent({
	props: { label: { type: String, default: '' } },
	template: '<label><span>{{ label }}</span><slot /></label>',
});
const UInputStub = defineComponent({
	name: 'UInput',
	props: {
		modelValue: { type: [String, Number], default: '' },
		type: { type: String, default: 'text' },
		disabled: { type: Boolean, default: false },
	},
	emits: ['update:modelValue'],
	template: `<input :type="type" :value="modelValue" :disabled="disabled" @input="$emit('update:modelValue', $event.target.value)" />`,
});
const UInputNumberStub = defineComponent({
	name: 'UInputNumber',
	props: {
		modelValue: { type: Number, default: undefined },
		disabled: { type: Boolean, default: false },
	},
	emits: ['update:modelValue'],
	template: `<input type="number" :value="modelValue" :disabled="disabled" @input="$emit('update:modelValue', Number($event.target.value))" />`,
});
const USelectStub = defineComponent({
	name: 'USelect',
	props: {
		modelValue: { type: [String, Number, Boolean], default: undefined },
		items: { type: Array as () => { label: string; value: string }[], default: () => [] },
		disabled: { type: Boolean, default: false },
	},
	emits: ['update:modelValue'],
	template: `<select :value="modelValue" :disabled="disabled" @change="$emit('update:modelValue', $event.target.value)">
		<option v-for="item in items" :key="item.value" :value="item.value">{{ item.label }}</option>
	</select>`,
});
const USwitchStub = defineComponent({
	name: 'USwitch',
	props: {
		modelValue: { type: Boolean, default: false },
		disabled: { type: Boolean, default: false },
	},
	emits: ['update:modelValue'],
	template: `<input type="checkbox" :checked="modelValue" :disabled="disabled" @change="$emit('update:modelValue', $event.target.checked)" />`,
});

/** The draft the pickers offer from: two palette colours, a fill, and a geometry. */
const DRAFT: GraphicStyleSetEntry[] = [
	{ id: 'brand', kind: 'palette', name: 'Brand', schemaVersion: 1, value: { color: '#ff0044' } },
	{ id: 'ink', kind: 'palette', name: 'Ink', schemaVersion: 1, value: { color: '#101014' } },
	{
		id: 'panel-fill',
		kind: 'fill',
		name: 'Panel fill',
		schemaVersion: 1,
		value: { type: 'solid', colorEntryId: 'ink' },
	},
	{
		id: 'cut-corner',
		kind: 'shape-geometry',
		name: 'Cut corner',
		schemaVersion: 1,
		value: squareShapeGeometry(),
	},
];

const TYPOGRAPHY: GraphicStyleSetEntry = {
	id: 'heading',
	kind: 'typography',
	name: 'Heading',
	schemaVersion: 1,
	value: {
		fontId: 'inter',
		fontSize: 64,
		fontWeight: 800,
		fontStyle: 'normal',
		textTransform: 'uppercase',
		letterSpacing: 2,
		lineHeight: 1,
		colorEntryId: 'brand',
	},
};

async function mountEditor(entry: GraphicStyleSetEntry, props: Record<string, unknown> = {}) {
	const componentPath = '../../../../app/components/Graphics/StyleSetEntryEditor.vue';
	const { default: StyleSetEntryEditor } = await import(componentPath);

	return mount(StyleSetEntryEditor, {
		props: { entry, entries: DRAFT, writable: true, ...props },
		global: {
			stubs: {
				UFormField: UFormFieldStub,
				UInput: UInputStub,
				UInputNumber: UInputNumberStub,
				USelect: USelectStub,
				USwitch: USwitchStub,
			},
		},
	});
}

/** The controls under one label, named as the author reads them. */
function fieldsNamed(wrapper: VueWrapper, label: string): DOMWrapper<HTMLLabelElement>[] {
	return wrapper.findAll<HTMLLabelElement>('label').filter(field => field.get('span').text() === label);
}

function fieldNamed(wrapper: VueWrapper, label: string): DOMWrapper<HTMLLabelElement> {
	const [field] = fieldsNamed(wrapper, label);
	if (!field)
		throw new Error(`no control is labelled “${label}”`);
	return field;
}

/** The last value the editor emitted, which is the whole entry value. */
function emittedValue(wrapper: VueWrapper): Record<string, unknown> {
	const emitted = wrapper.emitted('update:value');
	if (!emitted?.length)
		throw new Error('the editor emitted no value');
	return emitted.at(-1)![0] as Record<string, unknown>;
}

describe('graphicsStyleSetEntryEditor', () => {
	it('gives a palette entry the only colour input there is', async () => {
		const wrapper = await mountEditor(DRAFT[0]!);

		const color = wrapper.get<HTMLInputElement>('[data-testid="style-entry-palette-color"]');
		expect(color.element.type).toBe('color');
		expect(color.element.value).toBe('#ff0044');

		await color.setValue('#00ff88');

		expect(emittedValue(wrapper)).toEqual({ color: '#00ff88' });
	});

	it('makes a typography preset\'s colour a choice between palette entries', async () => {
		const wrapper = await mountEditor(TYPOGRAPHY);

		// A preset that stored a colour would make a brand change a find-and-replace
		// across every preset that happened to use it.
		expect(wrapper.find('input[type="color"]').exists()).toBe(false);
		const picker = wrapper.get('[data-testid="style-entry-typography-color"]');
		expect(picker.findAll('option').map(option => option.text())).toEqual(['Brand', 'Ink']);

		await picker.setValue('ink');

		expect(emittedValue(wrapper).colorEntryId).toBe('ink');
	});

	it('keeps every sibling field when one is edited', async () => {
		const wrapper = await mountEditor(TYPOGRAPHY);

		await fieldNamed(wrapper, 'Size').get('input').setValue(32);

		// The editor writes whole entry values, so a control that dropped its siblings
		// would silently reset the rest of the preset.
		expect(emittedValue(wrapper)).toEqual({ ...TYPOGRAPHY.value, fontSize: 32 });
	});

	it('replaces a Graphic Fill outright when its kind changes', async () => {
		const solid: GraphicStyleSetEntry = {
			id: 'accent-fill',
			kind: 'fill',
			name: 'Accent fill',
			schemaVersion: 1,
			value: { type: 'solid', colorEntryId: 'brand' },
		};
		const wrapper = await mountEditor(solid);

		await wrapper.get('[data-testid="style-entry-fill-kind"]').setValue('linear-gradient');

		// A Graphic Fill is a discriminated union: a merge would leave `colorEntryId`
		// behind on a gradient, which the write schema refuses.
		expect(emittedValue(wrapper)).toEqual({
			type: 'linear-gradient',
			angle: 90,
			stops: [
				{ colorEntryId: 'brand', position: 0, opacity: 1 },
				{ colorEntryId: 'brand', position: 1, opacity: 1 },
			],
		});
	});

	it('offers a Graphic Surface Style the Graphic Fill presets, and no colour of its own', async () => {
		const surface: GraphicStyleSetEntry = {
			id: 'panel',
			kind: 'surface-style',
			name: 'Panel',
			schemaVersion: 1,
			value: { fillOpacity: 0.9 },
		};
		const wrapper = await mountEditor(surface);

		const fill = wrapper.get('[data-testid="style-entry-surface-fill"]');
		expect(fill.findAll('option').map(option => option.text())).toEqual(['Panel fill']);

		await fill.setValue('panel-fill');

		expect(emittedValue(wrapper)).toEqual({ fillOpacity: 0.9, fillEntryId: 'panel-fill' });
	});

	it('gives a Graphic Surface Style a whole outline when one is switched on, and none when off', async () => {
		const surface: GraphicStyleSetEntry = {
			id: 'panel',
			kind: 'surface-style',
			name: 'Panel',
			schemaVersion: 1,
			value: { fillOpacity: 0.9 },
		};
		const wrapper = await mountEditor(surface);

		await wrapper.get('[data-testid="style-entry-surface-outline"]').setValue(true);

		// Switched on means a treatment an author can see, referencing a palette entry
		// rather than a colour.
		expect(emittedValue(wrapper).outline).toEqual({ colorEntryId: 'brand', width: 2 });

		const outlined = await mountEditor({
			...surface,
			value: { fillOpacity: 0.9, outline: { colorEntryId: 'brand', width: 2 } },
		} as GraphicStyleSetEntry);
		await outlined.get('[data-testid="style-entry-surface-outline"]').setValue(false);

		expect(emittedValue(outlined).outline).toBeUndefined();
	});

	it('will not size a square corner of a Shape Geometry preset', async () => {
		const geometry: GraphicStyleSetEntry = {
			id: 'cut-corner',
			kind: 'shape-geometry',
			name: 'Cut corner',
			schemaVersion: 1,
			value: { ...squareShapeGeometry(), topRight: { treatment: 'cut', size: 24 } },
		};
		const wrapper = await mountEditor(geometry);

		const sizes = fieldsNamed(wrapper, 'Size').map(field => field.get<HTMLInputElement>('input').element);
		// Corner order is the vocabulary's: top-left is square, top-right is cut.
		expect(sizes[0]!.disabled).toBe(true);
		expect(sizes[1]!.disabled).toBe(false);
		expect(sizes[1]!.value).toBe('24');
	});

	it('will not ask for a repeat count while a Graphic Animation Recipe repeats indefinitely', async () => {
		const recipe: GraphicStyleSetEntry = {
			id: 'pulse',
			kind: 'animation-recipe',
			name: 'Pulse',
			schemaVersion: 1,
			value: { duration: 800, easing: 'ease-in-out', repeat: 'indefinite' },
		};
		const wrapper = await mountEditor(recipe);

		expect(wrapper.get<HTMLInputElement>('[data-testid="style-entry-animation-repeat"]').element.disabled)
			.toBe(true);

		await wrapper.get('[data-testid="style-entry-animation-repeat-indefinite"]').setValue(false);

		// Turning it off leaves a count rather than nothing, which is a recipe the write
		// schema accepts.
		expect(emittedValue(wrapper).repeat).toBe(1);
	});

	it('gives an observer every preset to read and none to write', async () => {
		const wrapper = await mountEditor(TYPOGRAPHY, { writable: false });

		expect(wrapper.get('[data-testid="style-entry-value-typography"]').exists()).toBe(true);
		const controls = wrapper.findAll<HTMLInputElement | HTMLSelectElement>('input, select');
		expect(controls.length).toBeGreaterThan(0);
		for (const control of controls)
			expect(control.element.disabled).toBe(true);
	});
});
