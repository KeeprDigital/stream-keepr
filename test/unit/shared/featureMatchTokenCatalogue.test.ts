import type { EventKind } from '~~/shared/config/games';
import { describe, expect, it } from 'vitest';
import {
	FEATURE_MATCH_TOKEN_KEYS,
	featureMatchTokenCatalogue,
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
	/** One Seat's token suffixes, in the order an Event of `kind` is offered them. */
	function seatTokens(kind: EventKind, seat: number): string[] {
		return featureMatchTokenCatalogue(kind)
			.map(token => token.key)
			.filter(key => key.startsWith(`player${seat}`))
			.map(key => key.slice(`player${seat}`.length));
	}

	// A pair's tokens name two Seats, with a record and a Leader's image and no Commander term (ADR-0087).
	it.each(['mtg-two-player', 'op'] as const)('offers a %s Event the pair\'s tokens and no third Seat', (kind) => {
		expect(seatTokens(kind, 1)).toEqual([
			'Name',
			'Record',
			'Deck',
			'DeckColors',
			'Pronouns',
			'Lgs',
			'LeaderImage',
		]);
		expect(seatTokens(kind, 2)).toEqual(seatTokens(kind, 1));
		expect(seatTokens(kind, 3)).toEqual([]);
		expect(seatTokens(kind, 4)).toEqual([]);
	});

	it('offers a Commander Event each of four Seats\' tokens, with its Commanders\' images and no record', () => {
		expect(seatTokens('mtg-commander', 1)).toEqual([
			'Name',
			'Deck',
			'DeckColors',
			'Pronouns',
			'Lgs',
			'Commander1Image',
			'Commander2Image',
		]);
		for (const seat of [2, 3, 4])
			expect(seatTokens('mtg-commander', seat)).toEqual(seatTokens('mtg-commander', 1));
	});

	it('carries the Match, Round, and Event tokens beside the per-Seat ones', () => {
		expect(featureMatchTokenCatalogue('mtg-commander').map(token => token.key).filter(key => !key.startsWith('player')))
			.toEqual([
				'round',
				'stage',
				'table',
				'format',
				'eventName',
			]);
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

	// A Commander Slot's places are Seats; a pair's stay Players, as they read before.
	it.each([
		{ kind: 'mtg-two-player' as const, key: 'player2Lgs', label: 'Player 2 Local Game Store' },
		{ kind: 'mtg-commander' as const, key: 'player2Lgs', label: 'Seat 2 Local Game Store' },
		{ kind: 'mtg-commander' as const, key: 'player4Commander2Image', label: 'Seat 4 Second Commander Image' },
	])('labels $key "$label" on a $kind Event', ({ kind, key, label }) => {
		expect(featureMatchTokenCatalogue(kind).find(token => token.key === key)?.label).toBe(label);
	});

	// Deck Colours hold mana letters on a Magic Event and Leader colours on a One Piece one.
	it.each([
		{
			kind: 'mtg-two-player' as const,
			presentations: { player1DeckColors: 'mtg-mana-colors', player2DeckColors: 'mtg-mana-colors' },
		},
		{
			kind: 'op' as const,
			presentations: {
				player1DeckColors: 'op-colors',
				player2DeckColors: 'op-colors',
				player1LeaderImage: 'op-card-image',
				player2LeaderImage: 'op-card-image',
			},
		},
		{
			kind: 'mtg-commander' as const,
			presentations: Object.fromEntries([1, 2, 3, 4].flatMap(seat => [
				[`player${seat}DeckColors`, 'mtg-mana-colors'],
				[`player${seat}Commander1Image`, 'mtg-card-image'],
				[`player${seat}Commander2Image`, 'mtg-card-image'],
			])),
		},
	])('paints only the $kind Event\'s visual tokens as more than text', ({ kind, presentations }) => {
		expect(featureMatchTokenPresentations(kind)).toEqual(presentations);
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
