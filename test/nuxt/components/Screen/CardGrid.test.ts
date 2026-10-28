import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import CardGrid from '~/components/Screen/CardGrid.vue';

enableAutoUnmount(afterEach);

type CardGridProps = InstanceType<typeof CardGrid>['$props'];

function mountGrid(props: Omit<CardGridProps, 'cardWidth' | 'gap'>) {
	return mount(CardGrid, {
		props: {
			cardWidth: '160px',
			gap: '12px',
			...props,
		},
		slots: { default: '<div data-testid="card" />' },
	});
}

describe('screenCardGrid', () => {
	// Fixed sizes its tracks to the cards; auto-fill fits as many card widths as there is room for.
	it.each([
		{ columns: 5, templateColumns: 'repeat(5, max-content)' },
		{ columns: 'auto-fill', templateColumns: 'repeat(auto-fill, 160px)' },
	] as const)('lays a Fixed grid out in $columns columns', ({ columns, templateColumns }) => {
		const wrapper = mountGrid({ sizing: 'fixed', columns });

		expect(wrapper.attributes('data-card-sizing')).toBe('fixed');
		expect(wrapper.attributes('data-columns')).toBe(String(columns));
		const style = (wrapper.element as HTMLElement).style;
		expect(style.gridTemplateColumns).toBe(templateColumns);
		expect(style.gap).toBe('12px');
		expect(wrapper.find('[data-testid="card"]').exists()).toBe(true);
	});

	// Every Fit column is one card wide, so the cards sit a gap apart both ways.
	it('lays a Fit grid out in columns as wide as the card width its host works out', () => {
		const wrapper = mountGrid({
			sizing: 'fit',
			columns: 4,
			rows: 3,
			fitCardWidth: '150px',
		});

		expect(wrapper.attributes('data-card-sizing')).toBe('fit');
		expect(wrapper.attributes('data-columns')).toBe('4');
		expect(wrapper.attributes('data-rows')).toBe('3');
		const grid = wrapper.get('.grid').element as HTMLElement;
		expect(grid.style.gridTemplateColumns).toBe('repeat(4, 150px)');
		expect(grid.style.gap).toBe('12px');
	});

	// A Fit grid sits at its alignment both ways; a Fixed one across, overflowing its end, never clipping its first column.
	it.each([
		{
			sizing: 'fit',
			alignment: 'bottom-left',
			property: 'placeContent',
			placed: 'end start',
		},
		{
			sizing: 'fit',
			alignment: 'center',
			property: 'placeContent',
			placed: 'center center',
		},
		{
			sizing: 'fixed',
			alignment: 'top-right',
			property: 'justifyContent',
			placed: 'safe end',
		},
		{
			sizing: 'fixed',
			alignment: 'center',
			property: 'justifyContent',
			placed: 'safe center',
		},
	] as const)('places a $sizing grid at $alignment', ({ sizing, alignment, property, placed }) => {
		const wrapper = mountGrid({ sizing, columns: 4, alignment });

		expect((wrapper.element as HTMLElement).style[property]).toBe(placed);
	});
});
