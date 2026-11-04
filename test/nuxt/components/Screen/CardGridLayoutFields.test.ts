import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { DECK_MAINBOARD_LAYOUT_FIELDS, DECK_SIDEBOARD_LAYOUT_FIELDS } from '~~/shared/screenModeConfigs/deck';
import { screenModeConfigContract } from '~~/shared/screenModes';
import { nuxtUiStubs, UFormFieldBesideStub } from '~~/test/nuxt/helpers/nuxtUiStubs';
import CardGridLayoutFields from '~/components/Screen/CardGridLayoutFields.vue';

// A card grid's layout, in one order: sizing, alignment, a Fixed card's width, stack reveal,
// auto columns, columns while auto columns is off, and gap (ADR-0054).

const topCards = screenModeConfigContract('top-cards').fields;

const layout = {
	cardSizing: 'fixed',
	cardWidth: 144,
	cardGap: 8,
	autoColumns: false,
	columns: 4,
	alignment: 'center',
	stackReveal: 30,
} as const;

function mountFields(props: Record<string, unknown>) {
	return mount(CardGridLayoutFields, {
		props: { layout, fields: DECK_SIDEBOARD_LAYOUT_FIELDS, ...props } as never,
		global: {
			stubs: { ...nuxtUiStubs, UFormField: UFormFieldBesideStub },
		},
	});
}

function renderedKeys(wrapper: ReturnType<typeof mountFields>) {
	return wrapper.findAll('[data-config-field]').map(field => field.attributes('data-config-field'));
}

describe('screenCardGridLayoutFields', () => {
	it.each([
		{
			name: 'a Fixed grid with set columns',
			props: {},
			keys: [
				'cardSizing',
				'cardWidth',
				'autoColumns',
				'columns',
				'cardGap',
			],
		},
		{
			name: 'a Fit grid: no card width',
			props: {
				layout: { ...layout, cardSizing: 'fit' },
			},
			keys: [
				'cardSizing',
				'autoColumns',
				'columns',
				'cardGap',
			],
		},
		{
			name: 'auto columns: no column count',
			props: {
				layout: { ...layout, autoColumns: true },
			},
			keys: [
				'cardSizing',
				'cardWidth',
				'autoColumns',
				'cardGap',
			],
		},
		{
			name: 'alignment where shown',
			props: {
				show: { alignment: true },
			},
			keys: [
				'cardSizing',
				'alignment',
				'cardWidth',
				'autoColumns',
				'columns',
				'cardGap',
			],
		},
		{
			name: 'stack reveal where shown',
			props: {
				show: { stackReveal: true },
			},
			keys: [
				'cardSizing',
				'cardWidth',
				'stackReveal',
				'autoColumns',
				'columns',
				'cardGap',
			],
		},
		{
			name: 'a mode\'s flat grid fields, which hold no alignment',
			props: {
				fields: topCards,
				layout: { ...layout, alignment: undefined },
			},
			keys: [
				'cardSizing',
				'cardWidth',
				'autoColumns',
				'columns',
				'cardGap',
			],
		},
	])('renders $name', ({ props, keys }) => {
		expect(renderedKeys(mountFields(props))).toEqual(keys);
	});

	it.each([
		{ name: 'mainboard', fields: DECK_MAINBOARD_LAYOUT_FIELDS },
		{ name: 'Most Played Cards', fields: topCards },
	])('bounds each number by the $name fields', ({ fields }) => {
		const wrapper = mountFields({
			fields,
			layout: { ...layout, alignment: undefined },
		});
		const bounds = (key: string) => {
			const input = wrapper.get(`[data-config-field="${key}"] input`);
			return {
				min: Number(input.attributes('min')),
				max: Number(input.attributes('max')),
			};
		};

		expect(bounds('cardWidth')).toEqual({ min: fields.cardWidth.min, max: fields.cardWidth.max });
		expect(bounds('columns')).toEqual({ min: fields.columns.min, max: fields.columns.max });
		expect(bounds('cardGap')).toEqual({ min: fields.cardGap.min, max: fields.cardGap.max });
	});

	type Wrapper = ReturnType<typeof mountFields>;
	it.each([
		{
			name: 'sizing',
			act: (w: Wrapper) => w.get('[data-config-field="cardSizing"] select').setValue('fit'),
			patch: { cardSizing: 'fit' },
		},
		{
			name: 'card width',
			act: (w: Wrapper) => w.get('[data-config-field="cardWidth"] input').setValue('200'),
			patch: { cardWidth: 200 },
		},
		{
			name: 'alignment',
			act: (w: Wrapper) => w.get('[data-point="top-left"]').trigger('click'),
			patch: { alignment: 'top-left' },
		},
		{
			name: 'stack reveal',
			act: (w: Wrapper) => w.get('[data-config-field="stackReveal"] input').setValue('40'),
			patch: { stackReveal: 40 },
		},
		{
			name: 'auto columns',
			act: (w: Wrapper) => w.get('[role="switch"]').trigger('click'),
			patch: { autoColumns: true },
		},
		{
			name: 'columns',
			act: (w: Wrapper) => w.get('[data-config-field="columns"] input').setValue('6'),
			patch: { columns: 6 },
		},
		{
			name: 'gap',
			act: (w: Wrapper) => w.get('[data-config-field="cardGap"] input').setValue('12'),
			patch: { cardGap: 12 },
		},
	])('emits a $name edit as the patch naming it', async ({ act, patch }) => {
		const wrapper = mountFields({
			show: { alignment: true, stackReveal: true },
		});
		await act(wrapper);

		expect(wrapper.emitted('update')).toEqual([
			[patch],
		]);
	});

	it('names its alignment picker after its grid', () => {
		const wrapper = mountFields({
			show: { alignment: true },
			gridName: 'Mainboard',
		});

		expect(wrapper.get('[role="radiogroup"]').attributes('aria-label')).toBe('Mainboard alignment');
	});
});
