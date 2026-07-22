import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import TemplateLines from '~/components/Screen/Modes/FeatureMatchOverlay/TemplateLines.vue';

describe('featureMatchOverlayTemplateLines', () => {
	it('renders deck color tokens as icons without duplicated raw color text', () => {
		const wrapper = mount(TemplateLines, {
			props: {
				lines: [[
					{ text: 'WUB', token: 'deckColors', deckColors: true },
					{ text: ' Esper Control', token: 'deck', deckColors: false },
				]],
				deckColors: 'WUB',
				output: 'key',
			},
		});

		expect(wrapper.findAll('.key-mana-circle')).toHaveLength(3);
		expect(wrapper.text()).toBe('Esper Control');
	});

	it('resolves registered font ids in token segment styles', () => {
		const wrapper = mount(TemplateLines, {
			props: {
				lines: [[
					{ text: 'Alice', token: 'name', deckColors: false, style: { fontFamily: 'mplantin' } },
				]],
				deckColors: '',
				output: 'overlay',
			},
		});

		expect(wrapper.get('span').attributes('style')).toContain('font-family: var(--font-mplantin)');
	});

	it('renders spacer segments as fixed-width inline elements', () => {
		const wrapper = mount(TemplateLines, {
			props: {
				lines: [[
					{ text: 'Alice', token: 'name', deckColors: false },
					{ text: '', deckColors: false, spacer: true, spacerWidth: '48px' },
					{ text: '7-1', token: 'record', deckColors: false },
				]],
				deckColors: '',
				output: 'overlay',
			},
		});

		expect(wrapper.get('.template-spacer').attributes('style')).toContain('width: 48px');
	});
});
