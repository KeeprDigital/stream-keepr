import { describe, expect, it } from 'vitest';
import { cardParser } from '~~/shared/utils/card/parsers';

const front = { small: 'https://example.com/small.jpg', normal: 'https://example.com/normal.jpg' };
const back = { small: 'https://example.com/back-small.jpg', normal: 'https://example.com/back-normal.jpg' };

function scryfallCard(overrides: Record<string, unknown> = {}) {
	return {
		id: 'card-123',
		name: 'Test Card',
		set_name: 'Test Set',
		layout: 'normal',
		image_uris: front,
		...overrides,
	} as any;
}

const twoFaces = {
	image_uris: undefined,
	card_faces: [
		{ image_uris: front },
		{ image_uris: back },
	],
};

const flat = {
	flipable: false,
	turnable: false,
	rotateable: false,
	counterRotateable: false,
};
const upright = {
	flipped: false,
	rotated: false,
	counterRotated: false,
	turnedOver: false,
};

describe('cardParser', () => {
	it('carries the card identity whatever its layout', () => {
		expect(cardParser(scryfallCard({ layout: 'some_future_layout' }))).toMatchObject({
			id: 'card-123',
			name: 'Test Card',
			set: 'Test Set',
			layout: 'some_future_layout',
		});
	});

	it.each([
		'normal',
		'saga',
		'adventure',
		'token',
		'leveler',
		'class',
		'case',
		'prepare',
		'mutate',
		'prototype',
		'battle',
		'planar',
		'scheme',
		'vanguard',
		'emblem',
		'augment',
		'host',
	])('shows a single-faced %s card upright with no back', (layout) => {
		const result = cardParser(scryfallCard({ layout }));

		expect(result.imageData).toEqual({ front, back: null });
		expect(result.orientationData).toEqual(flat);
		expect(result.displayData).toEqual(upright);
	});

	it.each([
		['modal_dfc', {}],
		['double_faced_token', {}],
		['reversible_card', {}],
		['art_series', {}],
		[
			'transform',
			{ type_line: 'Creature — Werewolf' },
		],
	])('makes a double-faced %s card turnable, reading each face', (layout, extra) => {
		const result = cardParser(scryfallCard({
			layout,
			...twoFaces,
			...extra,
		}));

		expect(result.imageData).toEqual({ front, back });
		expect(result.orientationData).toEqual({ ...flat, turnable: true });
		expect(result.displayData.rotated).toBe(false);
	});

	it('shows a transforming Battle rotated', () => {
		expect(cardParser(scryfallCard({ layout: 'transform', type_line: 'Battle — Siege', ...twoFaces })).displayData.rotated).toBe(true);
	});

	it('makes a flip card flipable', () => {
		const result = cardParser(scryfallCard({ layout: 'flip' }));

		expect(result.imageData).toEqual({ front, back: null });
		expect(result.orientationData).toEqual({ ...flat, flipable: true });
	});

	it.each([
		[
			'shows a split card rotated',
			[],
			{ rotated: true, counterRotateable: false },
		],
		[
			'makes an Aftermath split card counter-rotateable instead',
			['Aftermath'],
			{ rotated: false, counterRotateable: true },
		],
	])('%s', (_name, keywords, expected) => {
		const result = cardParser(scryfallCard({ layout: 'split', keywords }));

		expect(result.imageData).toEqual({ front, back: null });
		expect(result.displayData.rotated).toBe(expected.rotated);
		expect(result.orientationData.counterRotateable).toBe(expected.counterRotateable);
	});

	it('names a meld card\'s two parts and its result', () => {
		const result = cardParser(scryfallCard({
			layout: 'meld',
			all_parts: [
				{ id: 'p1', component: 'meld_part', name: 'Bruna' },
				{ id: 'p2', component: 'meld_part', name: 'Gisela' },
				{ id: 'r1', component: 'meld_result', name: 'Brisela' },
			],
		}));

		expect(result.imageData).toEqual({ front, back: null });
		expect(result.meldData).toEqual({ meldPartOne: 'Bruna', meldPartTwo: 'Gisela', meldResult: 'Brisela' });
	});

	it('names no meld parts when Scryfall lists none', () => {
		expect(cardParser(scryfallCard({ layout: 'meld', all_parts: undefined })).meldData)
			.toEqual({ meldPartOne: null, meldPartTwo: null, meldResult: null });
	});

	it('shows no images for a layout it does not know', () => {
		expect(cardParser(scryfallCard({ layout: 'some_future_layout', image_uris: undefined })).imageData)
			.toEqual({ front: null, back: null });
	});
});
