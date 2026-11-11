import type { ScreenModeConfigField } from '~~/shared/screenModeConfigs/fields';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { screenModeConfigContract } from '~~/shared/screenModes';
import { nuxtUiStubs, UFormFieldBesideStub } from '~~/test/nuxt/helpers/nuxtUiStubs';
import CardBadgeFields from '~/components/Screen/CardBadgeFields.vue';

// One card badge's row: whether it shows, then its position (never the card's centre,
// which would cover its art) and its size, Auto or px, each written under its contract field's key.

const topCards = screenModeConfigContract('top-cards').fields;
const deck = screenModeConfigContract('deck').fields;

interface Props {
	title: string;
	shown: boolean;
	shownField?: ScreenModeConfigField;
	position: string;
	positionField: ScreenModeConfigField;
	size?: number;
	sizeField?: ScreenModeConfigField;
}

const rank: Props = {
	title: 'Rank Badge',
	shown: true,
	shownField: topCards.showRankBadges,
	position: 'top-left',
	positionField: topCards.rankBadgePosition,
	size: 18,
	sizeField: topCards.rankBadgeTextSize,
};

const companion: Props = {
	title: 'Companion Badge',
	shown: true,
	position: 'top',
	positionField: deck.companionTagPosition,
};

function mountFields(props: Props, slots: Record<string, string> = {}) {
	return mount(CardBadgeFields, {
		props: props as never,
		slots,
		global: {
			stubs: { ...nuxtUiStubs, UFormField: UFormFieldBesideStub },
		},
	});
}

/** The row's controls, in order, by the field each writes and its accessible name. */
function rowControls(wrapper: ReturnType<typeof mountFields>) {
	const row = wrapper.get('[role="group"]');
	return {
		row: row.attributes('aria-label'),
		controls: row.findAll('[data-config-field]').map(field => [
			field.attributes('data-config-field'),
			field.attributes('aria-label'),
		]),
	};
}

describe('screenCardBadgeFields', () => {
	it.each([
		{
			name: 'a shown badge: its toggle, position and size',
			props: rank,
			controls: [
				['showRankBadges', 'Show rank badges'],
				['rankBadgePosition', 'Badge position'],
				['rankBadgeTextSize', 'Badge size'],
			],
		},
		{
			name: 'a hidden badge: its toggle only',
			props: { ...rank, shown: false },
			controls: [
				['showRankBadges', 'Show rank badges'],
			],
		},
		{
			name: 'a badge with no size: no size control',
			props: companion,
			controls: [
				['companionTagPosition', 'Badge Position'],
			],
		},
	])('lays out $name in one row named for the badge', ({ props, controls }) => {
		expect(rowControls(mountFields(props))).toEqual({ row: props.title, controls });
	});

	it.each([
		{
			name: 'shown',
			shown: true,
			keys: ['rankBadgePosition', 'rankBadgeTextSize'],
		},
		{ name: 'hidden', shown: false, keys: [] },
	])('takes its show control from the slot, with position and size only while $name', ({ shown, keys }) => {
		const wrapper = mountFields(
			{ ...rank, shownField: undefined, shown },
			{ shown: '<select data-testid="stat-badge" />' },
		);

		expect(wrapper.find('[role="group"] [data-testid="stat-badge"]').exists()).toBe(true);
		expect(rowControls(wrapper).controls.map(([key]) => key)).toEqual(keys);
	});

	it('offers every position but the centre', () => {
		const wrapper = mountFields(rank);

		expect(wrapper.get('[data-point="center"]').attributes('disabled')).toBeDefined();
		expect(wrapper.get('[data-point="top-right"]').attributes('disabled')).toBeUndefined();
	});

	it.each([
		{ name: 'a set size', size: 18, shows: '18' },
		{ name: 'Auto', size: undefined, shows: '' },
	])('shows $name in the size field, with Auto its placeholder', ({ size, shows }) => {
		const input = mountFields({ ...rank, size }).get('input[type="number"]');

		expect([
			(input.element as HTMLInputElement).value,
			input.attributes('placeholder'),
		]).toEqual([shows, 'Auto']);
	});

	it.each([
		{
			name: 'hides the badge',
			act: (w: ReturnType<typeof mountFields>) => w.get('[role="switch"]').trigger('click'),
			patch: { showRankBadges: false },
		},
		{
			name: 'moves the badge',
			act: (w: ReturnType<typeof mountFields>) => w.get('[data-point="bottom-right"]').trigger('click'),
			patch: { rankBadgePosition: 'bottom-right' },
		},
		{
			name: 'sets its size',
			act: (w: ReturnType<typeof mountFields>) => w.get('input[type="number"]').setValue('22'),
			patch: { rankBadgeTextSize: 22 },
		},
		{
			name: 'returns its size to Auto when emptied',
			act: (w: ReturnType<typeof mountFields>) => w.get('input[type="number"]').setValue(''),
			patch: { rankBadgeTextSize: null },
		},
	])('$name, under its field\'s key', async ({ act, patch }) => {
		const wrapper = mountFields(rank);
		await act(wrapper);

		expect(wrapper.emitted('update')).toEqual([
			[patch],
		]);
	});

	it('bounds the size by its field', () => {
		const input = mountFields(rank).get('input[type="number"]');

		expect({
			min: Number(input.attributes('min')),
			max: Number(input.attributes('max')),
		})
			.toEqual({ min: topCards.rankBadgeTextSize.min, max: topCards.rankBadgeTextSize.max });
	});
});
