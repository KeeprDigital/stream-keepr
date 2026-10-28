import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import CardFitBox from '~/components/Mtg/CardFitBox.vue';
import CardGrid from '~/components/Screen/CardGrid.vue';

enableAutoUnmount(afterEach);

describe('screenCardGrid', () => {
	// Fit gives every row an equal share of the height; Fixed sizes tracks to the cards.
	it.each([
		{
			sizing: 'fit',
			columns: 4,
			rows: 3,
			templateColumns: 'repeat(4, minmax(0, 1fr))',
			templateRows: 'repeat(3, minmax(0, 1fr))',
		},
		{
			sizing: 'fixed',
			columns: 5,
			rows: undefined,
			templateColumns: 'repeat(5, max-content)',
			templateRows: '',
		},
		{
			sizing: 'fixed',
			columns: 'auto-fill',
			rows: undefined,
			templateColumns: 'repeat(auto-fill, 160px)',
			templateRows: '',
		},
	] as const)('lays out a $sizing grid of $columns columns', ({ sizing, columns, rows, templateColumns, templateRows }) => {
		const wrapper = mount(CardGrid, {
			props: {
				sizing,
				columns,
				rows,
				cardWidth: '160px',
				gap: '12px',
			},
			slots: { default: '<div data-testid="card" />' },
		});

		expect(wrapper.attributes('data-card-sizing')).toBe(sizing);
		expect(wrapper.attributes('data-columns')).toBe(String(columns));
		expect(wrapper.attributes('data-rows')).toBe(rows === undefined
			? undefined
			: String(rows));
		const style = (wrapper.element as HTMLElement).style;
		expect(style.gridTemplateColumns).toBe(templateColumns);
		expect(style.gridTemplateRows).toBe(templateRows);
		expect(style.gap).toBe('12px');
		expect(wrapper.find('[data-testid="card"]').exists()).toBe(true);
	});
});

describe('mtgCardFitBox', () => {
	it('holds the card it fits', () => {
		const wrapper = mount(CardFitBox, {
			slots: { default: '<div data-testid="card" />' },
		});

		expect(wrapper.get('[data-card-fit]').find('[data-testid="card"]').exists()).toBe(true);
	});
});
