import { describe, expect, it } from 'vitest';
import { isScryfallCardImageUrl, scryfallCardImageUrl } from '~~/shared/utils/scryfallCardImage';

// Only a Scryfall card image is loaded on air for a Magic card.
describe('a Scryfall card image URL', () => {
	it.each([
		[
			scryfallCardImageUrl('d0d33d52-3d28-4635-b985-51e126289259')!,
			true,
		],
		['https://cards.scryfall.io.example.com/x.jpg', false],
		['http://cards.scryfall.io/x.jpg', false],
		['not a url', false],
	])('recognises %s: %s', (url, recognised) => {
		expect(isScryfallCardImageUrl(url)).toBe(recognised);
	});
});
