import type { ScreenModeConfigField } from '~~/shared/screenModeConfigs/fields';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { screenModeConfigContract } from '~~/shared/screenModes';
import { nuxtUiStubs, UFormFieldBesideStub } from '~~/test/nuxt/helpers/nuxtUiStubs';
import CardBadgeFields from '~/components/Screen/CardBadgeFields.vue';

// One card badge's settings: whether it shows, then its position (never the card's centre,
// which would cover its art) and its text size, each written under its contract field's key.

const topCards = screenModeConfigContract('top-cards').fields;
const deck = screenModeConfigContract('deck').fields;

interface Props {
	title: string;
	shown: boolean;
	shownField?: ScreenModeConfigField;
	position: string;
	positionField: ScreenModeConfigField;
	textSize?: number;
	sizeField?: ScreenModeConfigField;
}

const rank: Props = {
	title: 'Rank Badge',
	shown: true,
	shownField: topCards.showRankBadges,
	position: 'top-left',
	positionField: topCards.rankBadgePosition,
	textSize: 18,
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

function renderedKeys(wrapper: ReturnType<typeof mountFields>) {
	return wrapper.findAll('[data-config-field]').map(field => field.attributes('data-config-field'));
}

describe('screenCardBadgeFields', () => {
	it.each([
		{
			name: 'a shown badge: its toggle, position and size',
			props: rank,
			keys: ['showRankBadges', 'rankBadgePosition', 'rankBadgeTextSize'],
		},
		{
			name: 'a hidden badge: its toggle only',
			props: { ...rank, shown: false },
			keys: ['showRankBadges'],
		},
		{
			name: 'a badge with no text size: no size control',
			props: companion,
			keys: ['companionTagPosition'],
		},
	])('renders $name', ({ props, keys }) => {
		expect(renderedKeys(mountFields(props))).toEqual(keys);
	});

	it.each([
		{ name: 'shown', shown: true, positioned: true },
		{ name: 'hidden', shown: false, positioned: false },
	])('takes its show control from the slot, with position and size only while $name', ({ shown, positioned }) => {
		const wrapper = mountFields(
			{ ...rank, shownField: undefined, shown },
			{ shown: '<select data-testid="stat-badge" />' },
		);

		expect(wrapper.find('[data-testid="stat-badge"]').exists()).toBe(true);
		expect(renderedKeys(wrapper)).toEqual(positioned
			? ['rankBadgePosition', 'rankBadgeTextSize']
			: []);
	});

	it('offers every position but the centre', () => {
		const wrapper = mountFields(rank);

		expect(wrapper.get('[data-point="center"]').attributes('disabled')).toBeDefined();
		expect(wrapper.get('[data-point="top-right"]').attributes('disabled')).toBeUndefined();
		expect(wrapper.get('[role="radiogroup"]').attributes('aria-label')).toBe('Rank Badge position');
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
			name: 'resizes its text',
			act: (w: ReturnType<typeof mountFields>) => w.get('input[type="number"]').setValue('22'),
			patch: { rankBadgeTextSize: 22 },
		},
	])('$name, under its field\'s key', async ({ act, patch }) => {
		const wrapper = mountFields(rank);
		await act(wrapper);

		expect(wrapper.emitted('update')).toEqual([
			[patch],
		]);
	});

	it('bounds the text size by its field', () => {
		const input = mountFields(rank).get('input[type="number"]');

		expect({
			min: Number(input.attributes('min')),
			max: Number(input.attributes('max')),
		})
			.toEqual({ min: topCards.rankBadgeTextSize.min, max: topCards.rankBadgeTextSize.max });
	});

	it('renders the Look slot after its fields', () => {
		const html = mountFields(rank, { look: '<p data-testid="look">Look</p>' }).html();

		expect(html.indexOf('data-testid="look"')).toBeGreaterThan(html.indexOf('data-config-field="rankBadgeTextSize"'));
	});
});
