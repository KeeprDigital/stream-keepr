import type { FeatureMatchOverlayGraphicItemRender } from '~~/app/modules/feature-match-overlay/renderModel';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import FeatureMatchOverlayGraphicItem from '~~/app/components/Screen/Modes/FeatureMatchOverlay/Widget.vue';

function mountGraphicItem(render: FeatureMatchOverlayGraphicItemRender) {
	return mount(FeatureMatchOverlayGraphicItem, {
		props: { render, output: 'overlay' },
	});
}

describe('featureMatchOverlayGraphicItem', () => {
	it('renders text graphicItems through TemplateLines', () => {
		const wrapper = mountGraphicItem({
			type: 'text',
			lines: [[{ text: 'Alice', token: 'name', deckColors: false, style: undefined }]],
			deckColors: 'R',
		});

		expect(wrapper.text()).toContain('Alice');
	});

	it('renders image graphicItems with resolved src and style', () => {
		const wrapper = mountGraphicItem({
			type: 'image',
			src: 'https://example.com/logo.png',
			alt: 'Logo',
			imageStyle: { objectFit: 'contain' },
		});

		const image = wrapper.get('img');
		expect(image.attributes('src')).toBe('https://example.com/logo.png');
		expect(image.attributes('alt')).toBe('Logo');
	});

	it('renders clock graphicItems with the resolved display time', () => {
		const wrapper = mountGraphicItem({ type: 'clock', displayTime: '12:34' });

		expect(wrapper.text()).toBe('12:34');
	});

	it('renders player-life graphicItems with the resolved life total', () => {
		const wrapper = mountGraphicItem({
			type: 'player-life',
			lifeTotal: 17,
			animation: undefined,
			durationMs: undefined,
			accentColor: undefined,
		});

		expect(wrapper.text()).toContain('17');
	});

	it('renders game-wins graphicItems with precomputed box styles', () => {
		const wrapper = mountGraphicItem({
			type: 'game-wins',
			boxes: [true, false],
			wins: 1,
			displayMode: 'boxes',
			containerStyle: {},
			boxStyles: {
				won: { background: '#22c55e' },
				lost: { background: 'transparent' },
			},
		});

		const boxes = wrapper.findAll('.game-win-box');
		expect(boxes).toHaveLength(2);
		expect(boxes[0]!.attributes('style')).toContain('#22c55e');
		expect(boxes[1]!.attributes('style')).toContain('transparent');
	});
});
