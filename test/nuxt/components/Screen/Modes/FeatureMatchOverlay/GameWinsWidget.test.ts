import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

async function mountComponent(props: {
	boxes: boolean[];
	wins: number;
	displayMode?: 'boxes' | 'number';
}) {
	const componentPath = '../../../../../../../app/components/Screen/Modes/FeatureMatchOverlay/GameWinsWidget.vue';
	const { default: GameWinsWidget } = await import(componentPath);

	return mount(GameWinsWidget, {
		props: {
			...props,
			boxStyle: (won: boolean) => ({
				width: '10px',
				height: '10px',
				background: won ? '#fff' : 'transparent',
			}),
		},
	});
}

describe('featureMatchOverlayGameWinsWidget', () => {
	it('renders boxes by default', async () => {
		const wrapper = await mountComponent({ boxes: [true, false, false], wins: 1 });

		expect(wrapper.findAll('.game-win-box')).toHaveLength(3);
		expect(wrapper.find('.game-wins-number').exists()).toBe(false);
	});

	it('renders the current win count in number mode', async () => {
		const wrapper = await mountComponent({ boxes: [true, false, false], wins: 1, displayMode: 'number' });

		expect(wrapper.findAll('.game-win-box')).toHaveLength(0);
		expect(wrapper.get('.game-wins-number').text()).toBe('1');
		expect(wrapper.get('.game-wins-widget').classes()).toContain('game-wins-widget--number');
	});
});
