import { describe, expect, it } from 'vitest';
import { cleanupFeatureMatchOverlayTemplate, renderFeatureMatchOverlayTemplate, renderFeatureMatchOverlayTemplateLines } from '~/utils/featureMatchOverlayTokens';

describe('broadcast layout token rendering', () => {
	it('replaces known tokens', () => {
		expect(renderFeatureMatchOverlayTemplate('{name} {record}', { name: 'Ben Parker', record: '7-1' })).toBe('Ben Parker 7-1');
	});

	it('renders missing tokens as blank', () => {
		expect(renderFeatureMatchOverlayTemplate('{name} {pronouns}', { name: 'Ben Parker' })).toBe('Ben Parker');
	});

	it('cleans dangling separators around missing values', () => {
		expect(renderFeatureMatchOverlayTemplate('{deck} • {lgs}', { deck: 'Bant Rhythm' })).toBe('Bant Rhythm');
		expect(renderFeatureMatchOverlayTemplate('{deck} • {lgs}', { lgs: 'Good Games' })).toBe('Good Games');
	});

	it('preserves meaningful line breaks', () => {
		expect(renderFeatureMatchOverlayTemplate('{name}\n{deck} • {lgs}', { name: 'Jacob Harvey', deck: 'Dimir Demons' })).toBe('Jacob Harvey\nDimir Demons');
	});

	it('exposes cleanup directly for edge cases', () => {
		expect(cleanupFeatureMatchOverlayTemplate('Dimir Demons • ')).toBe('Dimir Demons');
	});

	it('renders styled token lines while dropping separators around missing values', () => {
		expect(renderFeatureMatchOverlayTemplateLines('{deck} • {lgs}', { deck: 'Bant Rhythm' })).toEqual([
			[{ text: 'Bant Rhythm', token: 'deck', deckColors: false, style: undefined }],
		]);
		expect(renderFeatureMatchOverlayTemplateLines('{deck} • {lgs}', { lgs: 'Good Games' })).toEqual([
			[{ text: 'Good Games', token: 'lgs', deckColors: false, style: undefined }],
		]);
	});

	it('preserves deck color token metadata for special rendering', () => {
		expect(renderFeatureMatchOverlayTemplateLines('{deckColors} {deck}', { deckColors: 'WUB', deck: 'Esper Control' })[0]).toEqual([
			{ text: 'WUB', token: 'deckColors', deckColors: true, style: undefined },
			{ text: ' ', deckColors: false, token: undefined, style: undefined },
			{ text: 'Esper Control', token: 'deck', deckColors: false, style: undefined },
		]);
	});

	it('renders explicit spacer tokens with configurable width', () => {
		expect(renderFeatureMatchOverlayTemplateLines('{name}{spacer}{record}', { name: 'Ben Parker', record: '7-1' }, undefined, { spacerWidth: 48 })[0]).toEqual([
			{ text: 'Ben Parker', token: 'name', deckColors: false, style: undefined },
			{ text: '', deckColors: false, spacer: true, spacerWidth: '48px', token: undefined, style: undefined },
			{ text: '7-1', token: 'record', deckColors: false, style: undefined },
		]);
	});

	it('converts legacy multi-space literal gaps into spacer segments', () => {
		expect(renderFeatureMatchOverlayTemplateLines('{record}     {deck}', { record: '7-1', deck: 'Esper Control' })[0]).toEqual([
			{ text: '7-1', token: 'record', deckColors: false, style: undefined },
			{ text: '', deckColors: false, spacer: true, spacerWidth: '5ch', token: undefined, style: undefined },
			{ text: 'Esper Control', token: 'deck', deckColors: false, style: undefined },
		]);
	});

	it('drops spacer tokens when adjacent values are missing', () => {
		expect(renderFeatureMatchOverlayTemplateLines('{name}{spacer}{pronouns}', { name: 'Ben Parker' })).toEqual([
			[{ text: 'Ben Parker', token: 'name', deckColors: false, style: undefined }],
		]);
	});

	it('renders camelCase broadcast metadata tokens', () => {
		expect(renderFeatureMatchOverlayTemplate('{eventName} • {stage} • {deckColors}', {
			eventName: 'Regional Championship',
			stage: 'Top 8',
			deckColors: 'WUB',
		})).toBe('Regional Championship • Top 8 • WUB');
	});
});
