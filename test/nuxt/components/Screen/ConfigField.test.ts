import type { ScreenModeConfigField } from '~~/shared/screenModeConfigs/fields';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';
import { screenModeConfigContract } from '~~/shared/screenModes';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import ConfigField from '~/components/Screen/ConfigField.vue';

// A Screen Mode config field rendered from its contract metadata (ADR-0037): its control,
// label and bounds come from the field, and it emits in stored units.

const pairings = screenModeConfigContract('pairings').fields;
const deck = screenModeConfigContract('deck').fields;
const metagame = screenModeConfigContract('metagame').fields;

const UIColorPickerStub = defineComponent({
	props: {
		modelValue: { type: String, required: false },
		placeholder: { type: String, required: false },
	},
	emits: ['update:modelValue'],
	template: '<input data-color-picker :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value || undefined)" />',
});

function mountField(props: { field: ScreenModeConfigField; modelValue?: unknown; [key: string]: unknown }) {
	return mount(ConfigField, {
		props: props as never,
		global: {
			stubs: {
				...nuxtUiStubs,
				UIColorPicker: UIColorPickerStub,
			},
		},
	});
}

const colorField: ScreenModeConfigField = {
	key: 'accent',
	label: 'Accent',
	control: 'color',
	displayScale: 1,
};

describe('screenConfigField', () => {
	it.each([
		{
			kind: 'number',
			field: pairings.rowsPerPage,
			value: 8,
			control: 'input[type="number"]',
		},
		{
			kind: 'toggle',
			field: pairings.showHeader,
			value: true,
			control: '[role="switch"]',
		},
		{
			kind: 'select',
			field: metagame.viewMode,
			value: 'archetype',
			control: 'select',
		},
		{
			kind: 'text',
			field: pairings.headerText,
			value: 'Round 4',
			control: 'input[type="text"]',
		},
		{
			kind: 'color',
			field: colorField,
			value: '#112233',
			control: 'input[data-color-picker]',
		},
	])('renders a $kind field as its control, labelled by the field and keyed by it', ({ field, value, control }) => {
		const wrapper = mountField({ field, modelValue: value });

		expect(wrapper.attributes('data-config-field')).toBe(field.key);
		expect(wrapper.text()).toContain(field.label);
		expect(wrapper.find(control).exists()).toBe(true);
	});

	it.each([
		{
			name: 'its own bounds',
			max: undefined,
			expected: { min: '1', max: '100' },
		},
		{
			name: 'a lower max override',
			max: 12,
			expected: { min: '1', max: '12' },
		},
		{
			name: 'an override past its bound, held to the bound',
			max: 500,
			expected: { min: '1', max: '100' },
		},
	])('bounds a number field by $name', ({ max, expected }) => {
		const input = mountField({ field: pairings.rowsPerPage, modelValue: 8, max }).get('input');

		expect({
			min: input.attributes('min'),
			max: input.attributes('max'),
		}).toEqual(expected);
	});

	it.each([
		{
			name: 'a number in stored units',
			field: pairings.rowsPerPage,
			modelValue: 8,
			shown: '8',
			typed: '12',
			emitted: 12,
		},
		{
			name: 'a displayScale field in displayed units',
			field: pairings.autoPageIntervalMs,
			modelValue: 10000,
			shown: '10',
			typed: '4.5',
			emitted: 4500,
		},
		{
			name: 'an emptied nullable number as null',
			field: deck.quantityBadgeSize,
			modelValue: 16,
			shown: '16',
			typed: '',
			emitted: null,
			nullable: true,
		},
	])('shows and emits $name', async ({ field, modelValue, shown, typed, emitted, nullable }) => {
		const wrapper = mountField({ field, modelValue, nullable });
		const input = wrapper.get('input');

		expect((input.element as HTMLInputElement).value).toBe(shown);
		await input.setValue(typed);
		expect(wrapper.emitted('update:modelValue')).toEqual([
			[emitted],
		]);
	});

	it('shows a displayScale field\'s bounds in displayed units', () => {
		const input = mountField({ field: pairings.autoPageIntervalMs, modelValue: 10000 }).get('input');

		expect({
			min: input.attributes('min'),
			max: input.attributes('max'),
		}).toEqual({ min: '3', max: '60' });
	});

	it.each([
		{
			name: 'an emptied number that is not nullable',
			field: pairings.rowsPerPage,
			modelValue: 8,
			typed: '',
		},
	])('emits nothing for $name', async ({ field, modelValue, typed }) => {
		const wrapper = mountField({ field, modelValue });
		await wrapper.get('input').setValue(typed);

		expect(wrapper.emitted('update:modelValue')).toBeUndefined();
	});

	it.each([
		{
			name: 'cleared nullable text as null',
			modelValue: 'Round 4',
			typed: '',
			nullable: true,
			emitted: null,
		},
		{
			name: 'cleared text as empty when not nullable',
			modelValue: 'Round 4',
			typed: '',
			nullable: false,
			emitted: '',
		},
		{
			name: 'typed text as itself',
			modelValue: undefined,
			typed: 'Top 8',
			nullable: true,
			emitted: 'Top 8',
		},
	])('emits $name', async ({ modelValue, typed, nullable, emitted }) => {
		const wrapper = mountField({
			field: pairings.headerText,
			modelValue,
			nullable,
			placeholder: 'Auto',
		});
		const input = wrapper.get('input');

		expect(input.attributes('placeholder')).toBe('Auto');
		await input.setValue(typed);
		expect(wrapper.emitted('update:modelValue')).toEqual([
			[emitted],
		]);
	});

	it('toggles a toggle field', async () => {
		const wrapper = mountField({ field: pairings.showHeader, modelValue: true });
		await wrapper.get('[role="switch"]').trigger('click');

		expect(wrapper.emitted('update:modelValue')).toEqual([
			[false],
		]);
	});

	it.each([
		{
			name: 'ungated',
			enabled: undefined,
			state: { checked: 'true', disabled: false, description: 'Show the title.' },
			emitted: [
				[false],
			],
		},
		{
			name: 'gated on',
			enabled: true,
			state: { checked: 'true', disabled: false, description: 'Show the title.' },
			emitted: [
				[false],
			],
		},
		{
			name: 'gated off: shown off, its gate explained, and never written',
			enabled: false,
			state: { checked: 'false', disabled: true, description: 'Enable headers in event settings.' },
			emitted: undefined,
		},
	])('a toggle field $name', async ({ enabled, state, emitted }) => {
		const wrapper = mountField({
			field: pairings.showHeader,
			modelValue: true,
			description: 'Show the title.',
			enabled,
			disabledDescription: 'Enable headers in event settings.',
		});
		const toggle = wrapper.get('[role="switch"]');

		expect({
			checked: toggle.attributes('aria-checked'),
			disabled: toggle.attributes('disabled') !== undefined,
			description: wrapper.find('p').text(),
		}).toEqual(state);
		await toggle.trigger('click');
		expect(wrapper.emitted('update:modelValue')).toEqual(emitted);
	});

	it.each([
		{
			name: 'its field\'s values, unlabelled',
			items: undefined,
			labels: ['archetype', 'cards', 'chart'],
		},
		{
			name: 'the labels it is given',
			items: [
				{ label: 'Archetypes', value: 'archetype' },
				{ label: 'Cards', value: 'cards' },
				{ label: 'Chart', value: 'chart' },
			],
			labels: ['Archetypes', 'Cards', 'Chart'],
		},
	])('offers a select field\'s options as $name, and emits the chosen value', async ({ items, labels }) => {
		const wrapper = mountField({ field: metagame.viewMode, modelValue: 'archetype', items });
		const select = wrapper.get('select');

		expect(select.findAll('option').map(option => option.text())).toEqual(labels);
		await select.setValue('chart');
		expect(wrapper.emitted('update:modelValue')).toEqual([
			['chart'],
		]);
	});

	it('emits null for a select\'s own null option', async () => {
		const wrapper = mountField({
			field: metagame.viewMode,
			modelValue: 'cards',
			items: [
				{ label: 'Default', value: null },
				{ label: 'Cards', value: 'cards' },
			],
		});
		await wrapper.get('select').setValue('null');

		expect(wrapper.emitted('update:modelValue')).toEqual([
			[null],
		]);
	});

	it('refuses select items naming a value outside its field\'s values', () => {
		expect(() => mountField({
			field: metagame.viewMode,
			modelValue: 'archetype',
			items: [
				{ label: 'Pie', value: 'pie' },
			],
		})).toThrow(/pie/);
	});

	it.each([
		{
			name: 'a picked colour',
			typed: '#445566',
			nullable: false,
			emitted: [
				['#445566'],
			],
		},
		{
			name: 'a cleared nullable colour as null',
			typed: '',
			nullable: true,
			emitted: [
				[null],
			],
		},
		{
			name: 'nothing for a cleared colour that is not nullable',
			typed: '',
			nullable: false,
			emitted: undefined,
		},
	])('emits $name', async ({ typed, nullable, emitted }) => {
		const wrapper = mountField({ field: colorField, modelValue: '#112233', nullable });
		await wrapper.get('input').setValue(typed);

		expect(wrapper.emitted('update:modelValue')).toEqual(emitted);
	});
});
