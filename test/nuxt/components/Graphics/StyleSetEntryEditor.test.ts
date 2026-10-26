import type { DOMWrapper, VueWrapper } from '@vue/test-utils';
import type { GraphicStyleSetEntry } from '~~/shared/types/graphicStyleSet';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';
import { squareShapeGeometry } from '~~/shared/modules/graphics';
import StyleSetEntryEditor from '~/components/Graphics/StyleSetEntryEditor.vue';

// The value controls for one Graphic Style Set entry.

enableAutoUnmount(afterEach);

const UFormFieldStub = defineComponent({
	props: {
		label: { type: String, default: '' },
	},
	template: '<label><span>{{ label }}</span><slot /></label>',
});
const UInputStub = defineComponent({
	name: 'UInput',
	props: {
		modelValue: {
			type: [String, Number],
			default: '',
		},
		type: { type: String, default: 'text' },
		disabled: { type: Boolean, default: false },
	},
	emits: ['update:modelValue'],
	template: `<input :type="type" :value="modelValue" :disabled="disabled" @input="$emit('update:modelValue', $event.target.value)" />`,
});
const UIColorPickerStub = defineComponent({
	name: 'UIColorPicker',
	props: {
		modelValue: { type: String, default: '' },
		hexOnly: { type: Boolean, default: false },
		disabled: { type: Boolean, default: false },
	},
	emits: ['update:modelValue'],
	template: `<input data-color-picker :data-hex-only="hexOnly" :value="modelValue" :disabled="disabled" @input="$emit('update:modelValue', $event.target.value)" />`,
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
		modelValue: {
			type: [String, Number, Boolean],
			default: undefined,
		},
		items: {
			type: Array as () => { label: string; value: string }[],
			default: () => [],
		},
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

/** The draft the pickers offer from: two Palette Entries, a fill, and a geometry. */
const DRAFT: GraphicStyleSetEntry[] = [
	{
		id: 'brand',
		kind: 'palette',
		name: 'Brand',
		schemaVersion: 1,
		value: { color: '#ff0044' },
	},
	{
		id: 'ink',
		kind: 'palette',
		name: 'Ink',
		schemaVersion: 1,
		value: { color: '#101014' },
	},
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
		// An application font, never a Graphics Asset Library one: an entry travels in a
		// `.skstyle` with no asset envelope, so it takes only the arm that needs no bytes.
		font: { kind: 'application', fontId: 'inter' },
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
	return mount(StyleSetEntryEditor, {
		props: {
			entry,
			entries: DRAFT,
			writable: true,
			...props,
		},
		global: {
			stubs: {
				UFormField: UFormFieldStub,
				UInput: UInputStub,
				UIColorPicker: UIColorPickerStub,
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
	afterEach(() => {
		localStorage.clear();
	});

	it('gives a palette entry the only colour input there is', async () => {
		const wrapper = await mountEditor(DRAFT[0]!);

		// The shared colour picker, hex-only: a Palette Entry always holds a concrete colour.
		const color = wrapper.get<HTMLInputElement>('[data-testid="style-entry-palette-color"]');
		expect(color.attributes('data-color-picker')).toBeDefined();
		expect(color.attributes('data-hex-only')).toBe('true');
		expect(color.element.value).toBe('#ff0044');

		await color.setValue('#00ff88');

		expect(emittedValue(wrapper)).toEqual({ color: '#00ff88' });
	});

	it('makes a typography entry\'s colour a choice between palette entries', async () => {
		const wrapper = await mountEditor(TYPOGRAPHY);

		// An entry that stored a colour would make a brand change a find-and-replace
		// across every entry that happened to use it.
		expect(wrapper.find('input[type="color"]').exists()).toBe(false);
		const picker = wrapper.get('[data-testid="style-entry-typography-color"]');
		expect(picker.findAll('option').map(option => option.text())).toEqual(['Brand', 'Ink']);

		await picker.setValue('ink');

		expect(emittedValue(wrapper).colorEntryId).toBe('ink');
	});

	it('offers a typography entry application fonts only, through the shared font control', async () => {
		const wrapper = await mountEditor(TYPOGRAPHY);

		// ADR-0001: an entry travels in a `.skstyle` with no asset bytes, so there is no
		// source to choose and no library to pick from.
		expect(wrapper.find('[data-testid="style-entry-typography-font-source"]').exists()).toBe(false);
		const font = wrapper.get('[data-testid="style-entry-typography-font"]');

		await font.setValue('mplantin');

		expect(emittedValue(wrapper)).toEqual({
			...TYPOGRAPHY.value,
			font: { kind: 'application', fontId: 'mplantin' },
		});
	});

	it('keeps every sibling field when one is edited', async () => {
		const wrapper = await mountEditor(TYPOGRAPHY);

		await fieldNamed(wrapper, 'Size').get('input').setValue(32);

		// The editor writes whole entry values, so a control that dropped its siblings
		// would silently reset the rest of the entry.
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

	it('grows a Graphic Fill entry\'s gradient to four stops, each a palette entry', async () => {
		const gradient: GraphicStyleSetEntry = {
			id: 'accent-fill',
			kind: 'fill',
			name: 'Accent fill',
			schemaVersion: 1,
			value: {
				type: 'linear-gradient',
				angle: 90,
				stops: [
					{ colorEntryId: 'brand', position: 0, opacity: 1 },
					{ colorEntryId: 'ink', position: 1, opacity: 1 },
					{ colorEntryId: 'ink', position: 1, opacity: 1 },
				],
			},
		};
		const wrapper = await mountEditor(gradient);

		// The same fill fields an item has: every stop's colour is a palette entry
		// picker, and no colour input is offered at all.
		expect(wrapper.findAll('[data-testid="style-entry-fill-stop"]')).toHaveLength(3);
		expect(wrapper.find('[data-color-picker]').exists()).toBe(false);
		expect(wrapper.get('[aria-label="Stop 3 colour"]').findAll('option').map(option => option.text())).toEqual(['Brand', 'Ink']);

		await wrapper.get('[data-testid="style-entry-fill-add-stop"]').trigger('click');

		expect(emittedValue(wrapper)).toEqual({
			...gradient.value,
			stops: [
				{ colorEntryId: 'brand', position: 0, opacity: 1 },
				{ colorEntryId: 'ink', position: 1, opacity: 1 },
				{ colorEntryId: 'ink', position: 1, opacity: 1 },
				{ colorEntryId: 'ink', position: 1, opacity: 1 },
			],
		});

		await wrapper.get('[aria-label="Stop 1 colour"]').setValue('ink');
		expect((emittedValue(wrapper).stops as Array<{ colorEntryId: string }>)[0]?.colorEntryId).toBe('ink');
	});

	it('removes a Graphic Fill entry\'s stop down to two', async () => {
		const gradient: GraphicStyleSetEntry = {
			id: 'accent-fill',
			kind: 'fill',
			name: 'Accent fill',
			schemaVersion: 1,
			value: {
				type: 'linear-gradient',
				angle: 90,
				stops: [
					{ colorEntryId: 'brand', position: 0, opacity: 1 },
					{ colorEntryId: 'ink', position: 1, opacity: 1 },
				],
			},
		};
		const wrapper = await mountEditor(gradient);

		// A Style Set document stored with two stops opens as it always did, and two
		// is the floor.
		expect(wrapper.get('[data-testid="style-entry-fill-remove-stop"]').attributes('disabled')).toBeDefined();
		expect(wrapper.get('[data-testid="style-entry-fill-add-stop"]').attributes('disabled')).toBeUndefined();
	});

	it('offers a Graphic Surface Style the Graphic Fill entries, and no colour of its own', async () => {
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
			value: {
				fillOpacity: 0.9,
				outline: { colorEntryId: 'brand', width: 2 },
			},
		} as GraphicStyleSetEntry);
		await outlined.get('[data-testid="style-entry-surface-outline"]').setValue(false);

		expect(emittedValue(outlined).outline).toBeUndefined();
	});

	it('initialises a Shape Geometry entry from a built-in preset, sized as a new Shape Graphic Item', async () => {
		const geometry: GraphicStyleSetEntry = {
			id: 'cut-corner',
			kind: 'shape-geometry',
			name: 'Cut corner',
			schemaVersion: 1,
			value: {
				...squareShapeGeometry(),
				leftSlant: 12,
			},
		};
		const wrapper = await mountEditor(geometry);

		await wrapper.get('[data-testid="shape-geometry-preset-corner-cut"]').trigger('click');

		// A new Shape Graphic Item on a 1080p canvas is 768×108; 30% of the shorter
		// side, rounded, is 32. The preset replaces the slant too.
		expect(emittedValue(wrapper)).toEqual({
			...squareShapeGeometry(),
			topRight: { treatment: 'cut', size: 32 },
			bottomLeft: { treatment: 'cut', size: 32 },
		});
	});

	it('edits a media treatment entry with the same media fields a Media Graphic Item has', async () => {
		const treatment: GraphicStyleSetEntry = {
			id: 'hero-media',
			kind: 'media-treatment',
			name: 'Hero media',
			schemaVersion: 1,
			value: {
				fit: 'contain',
				focalPosition: { horizontal: 0.5, vertical: 0.5 },
				opacity: 0.6,
				playbackRate: 2,
				loop: false,
			},
		};
		const wrapper = await mountEditor(treatment);

		const fit = wrapper.get('[data-testid="media-fit"]');
		expect(fit.findAll('option').map(option => option.text())).toEqual(['Cover', 'Contain', 'Fill']);
		await fit.setValue('fill');
		expect(emittedValue(wrapper)).toEqual({ ...treatment.value, fit: 'fill' });

		// A cleared opacity or playback rate goes back to its default rather than to zero.
		const number = (testId: string) => wrapper.findAllComponents({ name: 'UInputNumber' })
			.find(input => input.attributes('data-testid') === testId)!;
		number('media-opacity').vm.$emit('update:modelValue', null);
		expect(emittedValue(wrapper).opacity).toBe(1);
		number('media-playback-rate').vm.$emit('update:modelValue', null);
		expect(emittedValue(wrapper).playbackRate).toBe(1);
	});

	it('gives an observer every entry to read and none to write', async () => {
		const wrapper = await mountEditor(TYPOGRAPHY, { writable: false });

		expect(wrapper.find('[data-testid="style-entry-value-typography"]').exists()).toBe(true);
		const controls = wrapper.findAll('input, select');
		expect(controls.length).toBeGreaterThan(0);
		for (const control of controls)
			expect((control.element as HTMLInputElement | HTMLSelectElement).disabled).toBe(true);
	});
});
