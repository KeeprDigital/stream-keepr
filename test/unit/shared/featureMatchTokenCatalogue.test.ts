import { describe, expect, it } from 'vitest';
import {
	FEATURE_MATCH_TOKEN_CATALOGUE,
	FEATURE_MATCH_TOKEN_KEYS,
	featureMatchTokenDeclarations,
	featureMatchTokenPresentations,
	isFeatureMatchTokenKey,
} from '~~/shared/featureMatchTokenCatalogue';
import { graphicTextTemplateInputKeys, renderGraphicTextTemplate } from '~~/shared/modules/graphics';

/** What a template renders, with the placeholder boundaries collapsed away. */
function rendered(template: string, values: Record<string, string>): string {
	return renderGraphicTextTemplate(template, featureMatchTokenDeclarations(), values)
		.map(segment => segment.text)
		.join('');
}

describe('featureMatchTokenCatalogue', () => {
	it('offers the identical token set for both players', () => {
		const forSide = (side: 1 | 2) => FEATURE_MATCH_TOKEN_KEYS
			.filter(key => key.startsWith(`player${side}`))
			.map(key => key.slice(`player${side}`.length));

		expect(forSide(1)).toEqual(['Name', 'Record', 'Deck', 'DeckColors', 'Pronouns', 'Lgs']);
		expect(forSide(2)).toEqual(forSide(1));
	});

	it('carries the Match, Round, and Event tokens beside the per-player ones', () => {
		expect(FEATURE_MATCH_TOKEN_KEYS.filter(key => !key.startsWith('player')))
			.toEqual(['round', 'stage', 'table', 'format', 'eventName']);
	});

	it('gives every token a distinct key', () => {
		// A placeholder, a Graphic Placeholder Style, and a resolved value all
		// address a token by key alone, so a duplicate would render, style, and
		// resolve whichever entry happened to be found first.
		expect(new Set(FEATURE_MATCH_TOKEN_KEYS).size).toBe(FEATURE_MATCH_TOKEN_KEYS.length);
	});

	it('gives every token a key the shared Graphic Text Template parser accepts', () => {
		// A catalogue key the parser does not recognise as a placeholder would be
		// offered by the editor and then rendered as the literal braces an author
		// typed — silently, because nothing else compares the two grammars.
		for (const key of FEATURE_MATCH_TOKEN_KEYS)
			expect(graphicTextTemplateInputKeys(`{${key}}`)).toEqual([key]);
	});

	it('labels every token for an operator', () => {
		expect(FEATURE_MATCH_TOKEN_CATALOGUE.every(token => token.label.length > 0)).toBe(true);
		expect(FEATURE_MATCH_TOKEN_CATALOGUE.find(token => token.key === 'player2Lgs')?.label)
			.toBe('Player 2 Local Game Store');
	});

	it('marks only player Deck Colours for MTG mana-pip presentation', () => {
		expect(featureMatchTokenPresentations()).toEqual({
			player1DeckColors: 'mtg-mana-colors',
			player2DeckColors: 'mtg-mana-colors',
		});
	});

	it('resolves a token through the shared Graphic Text Template mechanism', () => {
		expect(rendered('{player1Name} vs {player2Name}', {
			player1Name: 'Ada',
			player2Name: 'Grace',
		})).toBe('Ada vs Grace');
	});

	it('renders a token with no resolved value as nothing rather than as its braces', () => {
		// A Text Graphic Item is one item of a composition: it keeps rendering the
		// literal text around a value the host cannot currently supply.
		expect(rendered('Table {table}', {})).toBe('Table ');
	});

	it('does not resolve a legacy side-implicit token', () => {
		// The legacy model put the side on the item, so `{name}` meant whichever
		// player that item was configured for. The side now lives in the key, and an
		// unqualified token names nothing — which is what stops it resolving to a
		// silently chosen player.
		expect(isFeatureMatchTokenKey('name')).toBe(false);
		expect(rendered('{name}', { name: 'Ada' })).toBe('');
		expect(isFeatureMatchTokenKey('player1Name')).toBe(true);
	});

	it('declares every catalogue token as a text Graphic Input the mechanism can resolve', () => {
		const declarations = featureMatchTokenDeclarations();

		expect(declarations.map(declaration => declaration.key)).toEqual([...FEATURE_MATCH_TOKEN_KEYS]);
		expect(declarations.every(declaration => declaration.type === 'text')).toBe(true);
		// Nothing on a Feature Match Overlay accepts a staged value, so no token is
		// required and none is staged for an Update Graphic that does not exist.
		expect(declarations.every(declaration => !declaration.required)).toBe(true);
		expect(declarations.every(declaration => declaration.updatePolicy === 'live')).toBe(true);
	});
});
