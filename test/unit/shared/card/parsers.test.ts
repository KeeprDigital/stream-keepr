import { describe, expect, it } from 'vitest';
import { cardParser } from '~~/shared/utils/card/parsers';

// ──────────────── Helpers ────────────────

const mockImageUris = {
	small: 'https://example.com/small.jpg',
	normal: 'https://example.com/normal.jpg',
	large: 'https://example.com/large.jpg',
	png: 'https://example.com/png.png',
	art_crop: 'https://example.com/art_crop.jpg',
	border_crop: 'https://example.com/border_crop.jpg',
};

const mockBackImageUris = {
	small: 'https://example.com/back-small.jpg',
	normal: 'https://example.com/back-normal.jpg',
	large: 'https://example.com/back-large.jpg',
	png: 'https://example.com/back-png.png',
	art_crop: 'https://example.com/back-art_crop.jpg',
	border_crop: 'https://example.com/back-border_crop.jpg',
};

function createScryfallCard(overrides: Record<string, unknown> = {}) {
	return {
		id: 'card-123',
		name: 'Test Card',
		set_name: 'Test Set',
		layout: 'normal',
		image_uris: mockImageUris,
		...overrides,
	} as any;
}

// ──────────────── normal layout ────────────────

describe('cardParser', () => {
	describe('normal layout', () => {
		it('sets front image from image_uris', () => {
			const card = createScryfallCard({ layout: 'normal' });
			const result = cardParser(card);
			expect(result.imageData.front).toEqual(mockImageUris);
		});

		it('leaves back image null', () => {
			const card = createScryfallCard({ layout: 'normal' });
			const result = cardParser(card);
			expect(result.imageData.back).toBeNull();
		});

		it('sets all orientation flags to false', () => {
			const card = createScryfallCard({ layout: 'normal' });
			const result = cardParser(card);
			expect(result.orientationData).toEqual({
				flipable: false,
				turnable: false,
				rotateable: false,
				counterRotateable: false,
			});
		});

		it('populates id, name, set, and layout', () => {
			const card = createScryfallCard();
			const result = cardParser(card);
			expect(result.id).toBe('card-123');
			expect(result.name).toBe('Test Card');
			expect(result.set).toBe('Test Set');
			expect(result.layout).toBe('normal');
		});
	});

	// ──────────────── saga/adventure/token fall-through ────────────────

	describe('saga/adventure/token fall-through', () => {
		it.each([
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
		])('handles %s layout same as normal', (layout) => {
			const card = createScryfallCard({ layout });
			const result = cardParser(card);
			expect(result.imageData.front).toEqual(mockImageUris);
			expect(result.imageData.back).toBeNull();
			expect(result.orientationData.turnable).toBe(false);
			expect(result.orientationData.flipable).toBe(false);
		});
	});

	// ──────────────── modal_dfc ────────────────

	describe('modal_dfc layout', () => {
		it('sets front from card_faces[0] and back from card_faces[1]', () => {
			const card = createScryfallCard({
				layout: 'modal_dfc',
				image_uris: undefined,
				card_faces: [
					{ image_uris: mockImageUris },
					{ image_uris: mockBackImageUris },
				],
			});
			const result = cardParser(card);
			expect(result.imageData.front).toEqual(mockImageUris);
			expect(result.imageData.back).toEqual(mockBackImageUris);
		});

		it('sets turnable to true', () => {
			const card = createScryfallCard({
				layout: 'modal_dfc',
				card_faces: [
					{ image_uris: mockImageUris },
					{ image_uris: mockBackImageUris },
				],
			});
			const result = cardParser(card);
			expect(result.orientationData.turnable).toBe(true);
		});
	});

	// ──────────────── double_faced_token ────────────────

	describe('double_faced_token layout', () => {
		it('sets front and back from card_faces with turnable=true', () => {
			const card = createScryfallCard({
				layout: 'double_faced_token',
				card_faces: [
					{ image_uris: mockImageUris },
					{ image_uris: mockBackImageUris },
				],
			});
			const result = cardParser(card);
			expect(result.imageData.front).toEqual(mockImageUris);
			expect(result.imageData.back).toEqual(mockBackImageUris);
			expect(result.orientationData.turnable).toBe(true);
		});
	});

	// ──────────────── transform ────────────────

	describe('transform layout', () => {
		it('sets turnable to true', () => {
			const card = createScryfallCard({
				layout: 'transform',
				type_line: 'Creature',
				card_faces: [
					{ image_uris: mockImageUris },
					{ image_uris: mockBackImageUris },
				],
			});
			const result = cardParser(card);
			expect(result.orientationData.turnable).toBe(true);
		});

		it('sets rotated=true when type_line includes Battle', () => {
			const card = createScryfallCard({
				layout: 'transform',
				type_line: 'Battle — Siege',
				card_faces: [
					{ image_uris: mockImageUris },
					{ image_uris: mockBackImageUris },
				],
			});
			const result = cardParser(card);
			expect(result.displayData.rotated).toBe(true);
		});

		it('sets rotated=false when type_line does not include Battle', () => {
			const card = createScryfallCard({
				layout: 'transform',
				type_line: 'Creature — Werewolf',
				card_faces: [
					{ image_uris: mockImageUris },
					{ image_uris: mockBackImageUris },
				],
			});
			const result = cardParser(card);
			expect(result.displayData.rotated).toBe(false);
		});

		it('sets front and back images from card_faces', () => {
			const card = createScryfallCard({
				layout: 'transform',
				type_line: 'Creature',
				card_faces: [
					{ image_uris: mockImageUris },
					{ image_uris: mockBackImageUris },
				],
			});
			const result = cardParser(card);
			expect(result.imageData.front).toEqual(mockImageUris);
			expect(result.imageData.back).toEqual(mockBackImageUris);
		});
	});

	// ──────────────── flip ────────────────

	describe('flip layout', () => {
		it('sets front from image_uris', () => {
			const card = createScryfallCard({ layout: 'flip' });
			const result = cardParser(card);
			expect(result.imageData.front).toEqual(mockImageUris);
		});

		it('sets flipable to true', () => {
			const card = createScryfallCard({ layout: 'flip' });
			const result = cardParser(card);
			expect(result.orientationData.flipable).toBe(true);
		});

		it('leaves back null', () => {
			const card = createScryfallCard({ layout: 'flip' });
			const result = cardParser(card);
			expect(result.imageData.back).toBeNull();
		});
	});

	// ──────────────── split (non-aftermath) ────────────────

	describe('split layout (non-aftermath)', () => {
		it('sets front from image_uris', () => {
			const card = createScryfallCard({ layout: 'split', keywords: [] });
			const result = cardParser(card);
			expect(result.imageData.front).toEqual(mockImageUris);
		});

		it('sets rotated=true', () => {
			const card = createScryfallCard({ layout: 'split', keywords: [] });
			const result = cardParser(card);
			expect(result.displayData.rotated).toBe(true);
		});

		it('sets counterRotateable=false', () => {
			const card = createScryfallCard({ layout: 'split', keywords: [] });
			const result = cardParser(card);
			expect(result.orientationData.counterRotateable).toBe(false);
		});
	});

	// ──────────────── split (aftermath) ────────────────

	describe('split layout (aftermath)', () => {
		it('sets rotated=false', () => {
			const card = createScryfallCard({ layout: 'split', keywords: ['Aftermath'] });
			const result = cardParser(card);
			expect(result.displayData.rotated).toBe(false);
		});

		it('sets counterRotateable=true', () => {
			const card = createScryfallCard({ layout: 'split', keywords: ['Aftermath'] });
			const result = cardParser(card);
			expect(result.orientationData.counterRotateable).toBe(true);
		});

		it('sets front from image_uris', () => {
			const card = createScryfallCard({ layout: 'split', keywords: ['Aftermath'] });
			const result = cardParser(card);
			expect(result.imageData.front).toEqual(mockImageUris);
		});
	});

	// ──────────────── meld ────────────────

	describe('meld layout', () => {
		it('sets front from image_uris', () => {
			const card = createScryfallCard({
				layout: 'meld',
				all_parts: [
					{ id: 'p1', component: 'meld_part', name: 'Part One' },
					{ id: 'p2', component: 'meld_part', name: 'Part Two' },
					{ id: 'r1', component: 'meld_result', name: 'Combined' },
				],
			});
			const result = cardParser(card);
			expect(result.imageData.front).toEqual(mockImageUris);
		});

		it('extracts meld part names from all_parts', () => {
			const card = createScryfallCard({
				layout: 'meld',
				all_parts: [
					{ id: 'p1', component: 'meld_part', name: 'Bruna' },
					{ id: 'p2', component: 'meld_part', name: 'Gisela' },
					{ id: 'r1', component: 'meld_result', name: 'Brisela' },
				],
			});
			const result = cardParser(card);
			expect(result.meldData).toEqual({
				meldPartOne: 'Bruna',
				meldPartTwo: 'Gisela',
				meldResult: 'Brisela',
			});
		});

		it('handles missing all_parts gracefully', () => {
			const card = createScryfallCard({
				layout: 'meld',
				all_parts: undefined,
			});
			const result = cardParser(card);
			expect(result.meldData).toEqual({
				meldPartOne: null,
				meldPartTwo: null,
				meldResult: null,
			});
		});

		it('leaves back null', () => {
			const card = createScryfallCard({
				layout: 'meld',
				all_parts: [],
			});
			const result = cardParser(card);
			expect(result.imageData.back).toBeNull();
		});
	});

	// ──────────────── unknown layout ────────────────

	describe('unknown layout', () => {
		it('returns cardData with id, name, set, and layout', () => {
			const card = createScryfallCard({ layout: 'some_future_layout' });
			const result = cardParser(card);
			expect(result.id).toBe('card-123');
			expect(result.name).toBe('Test Card');
			expect(result.set).toBe('Test Set');
			expect(result.layout).toBe('some_future_layout');
		});

		it('keeps default null images', () => {
			const card = createScryfallCard({
				layout: 'some_future_layout',
				image_uris: undefined,
			});
			const result = cardParser(card);
			expect(result.imageData.front).toBeNull();
			expect(result.imageData.back).toBeNull();
		});
	});
});
