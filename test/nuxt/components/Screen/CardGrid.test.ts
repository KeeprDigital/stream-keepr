import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import CardGrid from '~/components/Screen/CardGrid.vue';

enableAutoUnmount(afterEach);

describe('screenCardGrid', () => {
	// Its host solves the Card Layout; the grid lays out exactly what it is given, at its alignment both ways.
	it.each([
		{ alignment: 'bottom-left', placed: 'end start' },
		{ alignment: 'center', placed: 'center center' },
		{ alignment: 'top-right', placed: 'start end' },
	] as const)('lays out the columns, card width and gap its host solved, at $alignment', ({ alignment, placed }) => {
		const wrapper = mount(CardGrid, {
			props: {
				columns: 4,
				rows: 3,
				cardWidth: '150px',
				gap: '9px',
				alignment,
			},
			slots: { default: '<div data-testid="card" />' },
		});

		expect(wrapper.attributes('data-columns')).toBe('4');
		expect(wrapper.attributes('data-rows')).toBe('3');
		expect((wrapper.element as HTMLElement).style.placeContent).toBe(placed);
		const grid = wrapper.get('.grid').element as HTMLElement;
		expect(grid.style.gridTemplateColumns).toBe('repeat(4, 150px)');
		expect(grid.style.gap).toBe('9px');
		expect(wrapper.find('[data-testid="card"]').exists()).toBe(true);
	});
});
