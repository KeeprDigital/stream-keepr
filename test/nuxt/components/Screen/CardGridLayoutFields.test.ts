import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { screenModeConfigFields } from '~~/shared/screenModeConfigs/fields';
import { cardLayoutShape } from '~~/shared/screenModeConfigs/subShapes';
import { screenModeConfigContract } from '~~/shared/screenModes';
import { nuxtUiStubs, UFormFieldBesideStub } from '~~/test/nuxt/helpers/nuxtUiStubs';
import CardGridLayoutFields from '~/components/Screen/CardGridLayoutFields.vue';

// A card grid's Card Layout, in one order: alignment, max card size, stack reveal,
// columns and gap; columns, max card size and gap are each Auto or a number (ADR-0054).

const topCards = screenModeConfigContract('top-cards').fields;

/** A board's layout block view: the Card Layout beside an alignment and a stack reveal. */
const board = {
	...screenModeConfigFields(cardLayoutShape(100, 'layout')),
	alignment: {
		key: 'alignment',
		label: 'Alignment',
		control: 'position',
		card: 'content',
		clearable: true,
		displayScale: 1,
	},
	stackReveal: {
		key: 'stackReveal',
		label: 'Stack reveal',
		control: 'number',
		card: 'content',
		clearable: true,
		min: 4,
		max: 240,
		displayScale: 1,
	},
} as const;

const layout = {
	columns: 4,
	maxCardSize: 144,
	cardGap: 8,
	alignment: 'center',
	stackReveal: 30,
} as const;

function mountFields(props: Record<string, unknown> = {}) {
	return mount(CardGridLayoutFields, {
		props: { layout, fields: board, ...props } as never,
		global: {
			stubs: { ...nuxtUiStubs, UFormField: UFormFieldBesideStub },
		},
	});
}

type Wrapper = ReturnType<typeof mountFields>;

function input(wrapper: Wrapper, key: string) {
	return wrapper.get(`[data-config-field="${key}"] input`);
}

describe('screenCardGridLayoutFields', () => {
	it.each([
		{
			name: 'a grid',
			props: {},
			keys: ['maxCardSize', 'columns', 'cardGap'],
		},
		{
			name: 'alignment where shown',
			props: {
				show: { alignment: true },
			},
			keys: [
				'alignment',
				'maxCardSize',
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
				'maxCardSize',
				'stackReveal',
				'columns',
				'cardGap',
			],
		},
		{
			name: 'a mode\'s flat grid fields, which hold no alignment',
			props: {
				fields: topCards,
				layout: {},
				show: { alignment: true },
			},
			keys: ['maxCardSize', 'columns', 'cardGap'],
		},
		// A stack is one column of overlapping cards, so it has no columns or gap.
		{
			name: 'a stack',
			props: {
				view: 'stack',
				show: { alignment: true, stackReveal: true },
			},
			keys: ['alignment', 'maxCardSize', 'stackReveal'],
		},
	])('renders $name', ({ props, keys }) => {
		expect(wrapperKeys(mountFields(props))).toEqual(keys);
	});

	// Auto is the absent value: an empty field under an "Auto" placeholder.
	it.each([
		{
			name: 'Auto',
			layout: {},
			shown: ['', '', ''],
		},
		{
			name: 'set',
			layout,
			shown: ['144', '4', '8'],
		},
	])('shows each $name value', ({ layout, shown }) => {
		const wrapper = mountFields({ layout });
		const inputs = ['maxCardSize', 'columns', 'cardGap'].map(key => input(wrapper, key));

		expect(inputs.map(field => (field.element as HTMLInputElement).value)).toEqual(shown);
		expect(inputs.map(field => field.attributes('placeholder'))).toEqual(['Auto', 'Auto', 'Auto']);
	});

	// Bounds follow the content: columns to the card count, a max card size to the
	// largest card the Event Canvas holds whole (1080 px tall is 775 px wide).
	it.each([
		{
			name: 'its fields alone',
			props: {},
			bounds: {
				maxCardSize: [48, 7680],
				columns: [1, 100],
				cardGap: [0, 100],
			},
		},
		{
			name: 'its card count and Event Canvas',
			props: {
				cardCount: 10,
				canvas: { width: 1920, height: 1080 },
			},
			bounds: {
				maxCardSize: [48, 775],
				columns: [1, 10],
				cardGap: [0, 100],
			},
		},
		{
			name: 'a canvas narrower than its tallest card',
			props: {
				canvas: { width: 400, height: 1080 },
			},
			bounds: {
				maxCardSize: [48, 400],
				columns: [1, 100],
				cardGap: [0, 100],
			},
		},
	])('bounds each number by $name', ({ props, bounds }) => {
		const wrapper = mountFields(props);

		expect(Object.fromEntries(Object.keys(bounds).map(key => [
			key,
			[
				Number(input(wrapper, key).attributes('min')),
				Number(input(wrapper, key).attributes('max')),
			],
		]))).toEqual(bounds);
	});

	it.each([
		{
			name: 'max card size',
			act: (w: Wrapper) => input(w, 'maxCardSize').setValue('200'),
			patch: { maxCardSize: 200 },
		},
		{
			name: 'max card size back to Auto',
			act: (w: Wrapper) => input(w, 'maxCardSize').setValue(''),
			patch: { maxCardSize: null },
		},
		{
			name: 'columns',
			act: (w: Wrapper) => input(w, 'columns').setValue('6'),
			patch: { columns: 6 },
		},
		{
			name: 'columns back to Auto',
			act: (w: Wrapper) => input(w, 'columns').setValue(''),
			patch: { columns: null },
		},
		{
			name: 'gap',
			act: (w: Wrapper) => input(w, 'cardGap').setValue('12'),
			patch: { cardGap: 12 },
		},
		{
			name: 'gap back to Auto',
			act: (w: Wrapper) => input(w, 'cardGap').setValue(''),
			patch: { cardGap: null },
		},
		{
			name: 'alignment',
			act: (w: Wrapper) => w.get('[data-point="top-left"]').trigger('click'),
			patch: { alignment: 'top-left' },
		},
		{
			name: 'stack reveal',
			act: (w: Wrapper) => input(w, 'stackReveal').setValue('40'),
			patch: { stackReveal: 40 },
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

function wrapperKeys(wrapper: Wrapper) {
	return wrapper.findAll('[data-config-field]').map(field => field.attributes('data-config-field'));
}
