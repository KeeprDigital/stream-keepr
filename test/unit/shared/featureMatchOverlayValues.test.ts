import { describe, expect, it } from 'vitest';
import { buildFeatureMatchOverlayTemplateMetadataValues, featureMatchTokenValues } from '~~/shared/featureMatchOverlayValues';
import { featureMatchTokenCatalogue } from '~~/shared/featureMatchTokenCatalogue';
import { scryfallCardImageUrl } from '~~/shared/utils/scryfallCardImage';
import { ATRAXA, KRAUM, TYMNA } from '~~/test/helpers/commanders';
import { seatedPlayer } from '~~/test/helpers/featureMatchSnapshots';
import { LUFFY } from '~~/test/helpers/opCards';

describe('broadcast layout template metadata values', () => {
	it('populates event, stage, round, format, and table placeholders', () => {
		const values = buildFeatureMatchOverlayTemplateMetadataValues({
			event: { name: 'Regional Championship', game: 'mtg' },
			featureMatch: { tableNumber: 12, activeSession: null } as any,
			sourceMatch: { tableNumber: 8 } as any,
			round: { name: 'Round 7' },
			phase: {
				name: 'Swiss',
			},
		});

		expect(values).toMatchObject({
			eventName: 'Regional Championship',
			stage: 'Swiss',
			round: 'Round 7',
			format: 'Magic: The Gathering',
			table: 'Table 12',
		});
	});

	it('prefers manual feature match metadata over linked source metadata', () => {
		const values = buildFeatureMatchOverlayTemplateMetadataValues({
			event: { name: 'Regional Championship', game: 'mtg' },
			featureMatch: {
				tableNumber: 12,
				roundName: 'Feature Round',
				formatName: 'Legacy',
				activeSession: null,
			} as any,
			sourceMatch: null,
			round: { name: 'Round 7' },
			phase: {
				name: 'Swiss',
			},
		});

		expect(values.round).toBe('Feature Round');
		expect(values.format).toBe('Legacy');
	});

	it('falls back to source match table, active session snapshot table, and event game format', () => {
		expect(buildFeatureMatchOverlayTemplateMetadataValues({
			event: { name: 'Local Open', game: 'op' },
			featureMatch: { tableNumber: null, activeSession: null } as any,
			sourceMatch: { tableNumber: 4 } as any,
			round: null,
			phase: { name: 'Top Cut' },
		})).toMatchObject({
			format: 'One Piece',
			table: 'Table 4',
			stage: 'Top Cut',
		});

		expect(buildFeatureMatchOverlayTemplateMetadataValues({
			event: { name: 'Local Open', game: 'mtg' },
			featureMatch: {
				tableNumber: null,
				activeSession: {
					sourceSnapshot: { tableNumber: 9 },
				},
			} as any,
			sourceMatch: null,
			round: null,
			phase: null,
		}).table).toBe('Table 9');
	});

	it('uses round text as stage when phase metadata is unavailable', () => {
		expect(buildFeatureMatchOverlayTemplateMetadataValues({
			event: { name: 'Local Open', game: 'mtg' },
			featureMatch: {
				tableNumber: null,
				roundName: 'Top 8 Quarterfinals',
				activeSession: null,
			} as any,
			sourceMatch: null,
			round: null,
			phase: null,
		}).stage).toBe('Top 8 Quarterfinals');
	});

	it('returns blank strings when optional metadata is unavailable', () => {
		expect(buildFeatureMatchOverlayTemplateMetadataValues({
			event: null,
			featureMatch: null,
			sourceMatch: null,
			round: null,
			phase: null,
		})).toEqual({
			round: '',
			stage: '',
			table: '',
			format: '',
			eventName: '',
		});
	});
});

describe('a side\'s deck on the Feature Match Overlay', () => {
	function valuesFor(game: 'mtg' | 'op', gameData: unknown) {
		return featureMatchTokenValues({
			event: {
				name: 'Open',
				game,
				displayRecordSeparator: '-',
				displayHideZeroDraws: true,
				displayPositionFormat: 'ordinal',
			},
			featureMatch: {
				player1Data: { name: 'Ana', gameData },
				player2Data: null,
				activeSession: null,
			} as any,
			sourceMatch: null,
			round: null,
			phase: null,
		});
	}

	// A One Piece deck is named by its Leader, which also sets its colours.
	it.each([
		{
			game: 'op' as const,
			gameData: { type: 'op', leader: LUFFY },
			deck: 'Monkey.D.Luffy',
			colors: 'Red/Green',
			image: 'https://cards-img.keepr.digital/OP01-003.png',
		},
		{
			game: 'op' as const,
			gameData: { type: 'op', leader: null },
			deck: '',
			colors: '',
			image: '',
		},
		{
			game: 'mtg' as const,
			gameData: { type: 'mtg', deckName: 'Boros', deckColors: 'RW' },
			deck: 'Boros',
			colors: 'RW',
			image: '',
		},
	])('shows $game deck "$deck" in $colors', ({ game, gameData, deck, colors, image }) => {
		expect(valuesFor(game, gameData)).toMatchObject({
			player1Deck: deck,
			player1DeckColors: colors,
			player1LeaderImage: image,
			player2LeaderImage: '',
		});
	});
});

describe('a side\'s name on the Feature Match Overlay', () => {
	// Shown by the shared name-or-Nickname rule (ADR-0074).
	it('shows a One Piece side with no name by its Nickname', () => {
		const values = featureMatchTokenValues({
			event: {
				name: 'Open',
				game: 'op',
				displayRecordSeparator: '-',
				displayHideZeroDraws: true,
				displayPositionFormat: 'ordinal',
			},
			featureMatch: {
				player1Data: { name: '', nickname: 'linlin_88' },
				player2Data: { name: 'Big Mom', nickname: 'linlin_88' },
				activeSession: null,
			} as any,
			sourceMatch: null,
			round: null,
			phase: null,
		});

		expect(values).toMatchObject({ player1Name: 'linlin_88', player2Name: 'Big Mom' });
	});
});

describe('which player a side shows on the Feature Match Overlay', () => {
	// The active Session owns side order (ADR-0058); the Slot keeps pairing order.
	it('names each side by the active Session\'s side order', () => {
		const values = featureMatchTokenValues({
			event: {
				name: 'Open',
				game: 'mtg',
				displayRecordSeparator: '-',
				displayHideZeroDraws: true,
				displayPositionFormat: 'ordinal',
			},
			featureMatch: {
				player1Data: { name: 'Ana', wins: 3, losses: 0 },
				player2Data: { name: 'Ben', wins: 2, losses: 1 },
				activeSession: {
					sourceSnapshot: {
						playersSwapped: true,
						player1: {
							playerId: 2,
							data: { name: 'Ben', wins: 2, losses: 1 },
						},
						player2: {
							playerId: 1,
							data: { name: 'Ana', wins: 3, losses: 0 },
						},
					},
				},
			} as any,
			sourceMatch: null,
			round: null,
			phase: null,
		});

		expect([
			values.player1Name,
			values.player1Record,
			values.player2Name,
			values.player2Record,
		])
			.toEqual(['Ben', '2-1', 'Ana', '3-0']);
	});
});

describe('a Commander Slot on the Feature Match Overlay', () => {
	const EVENT = {
		name: 'Pod Night',
		game: 'mtg' as const,
		variant: 'commander' as const,
		displayRecordSeparator: '-' as const,
		displayHideZeroDraws: true,
		displayPositionFormat: 'ordinal' as const,
	};

	function valuesFor(seats: Partial<Record<'player1Data' | 'player2Data' | 'player3Data' | 'player4Data', unknown>>) {
		return featureMatchTokenValues({
			event: EVENT,
			featureMatch: {
				player1Data: null,
				player2Data: null,
				...seats,
				activeSession: null,
			} as any,
			sourceMatch: null,
			round: null,
			phase: null,
		});
	}

	// A Commander deck is its Commanders: their names, and their colour identity together (ADR-0087).
	it('names a third and fourth Seat, each deck by its Commanders and its colours by their identity', () => {
		expect(valuesFor({
			player3Data: { ...seatedPlayer('Cleo', [TYMNA, KRAUM]), pronouns: 'she/her', lgs: 'Card Shop' },
			player4Data: seatedPlayer('Dara', [ATRAXA]),
		})).toMatchObject({
			player3Name: 'Cleo',
			player3Deck: 'Tymna the Weaver / Kraum, Ludevic\'s Opus',
			player3DeckColors: 'WUBR',
			player3Pronouns: 'she/her',
			player3Lgs: 'Card Shop',
			player4Name: 'Dara',
			player4Deck: 'Atraxa, Praetors\' Voice',
			player4DeckColors: 'WUBG',
		});
	});

	it.each([
		{ name: 'a pair', commanders: [TYMNA, KRAUM], first: scryfallCardImageUrl(TYMNA.scryfallId), second: scryfallCardImageUrl(KRAUM.scryfallId) },
		{ name: 'one Commander', commanders: [ATRAXA], first: scryfallCardImageUrl(ATRAXA.scryfallId), second: '' },
		{ name: 'no Commander yet', commanders: [], first: '', second: '' },
	])('shows the card of each Commander a Seat holds: $name', ({ commanders, first, second }) => {
		expect(valuesFor({ player2Data: seatedPlayer('Ben', commanders) })).toMatchObject({
			player2Commander1Image: first,
			player2Commander2Image: second,
		});
	});

	it('reads an empty Seat as empty values', () => {
		expect(valuesFor({})).toMatchObject({ player4Name: '', player4Deck: '', player4Commander1Image: '' });
	});
});

describe('the Feature Match token values of each kind of Event', () => {
	// The public Feature Match read returns every value, so a Two-Player or One
	// Piece Card Game Event's must not gain a Seat or a Commander term (ADR-0056).
	it.each([
		{ kind: 'mtg-two-player' as const, event: { game: 'mtg' as const, variant: 'two-player' as const } },
		{ kind: 'mtg-two-player' as const, event: { game: 'mtg' as const } },
		{ kind: 'mtg-commander' as const, event: { game: 'mtg' as const, variant: 'commander' as const } },
		{ kind: 'op' as const, event: { game: 'op' as const, variant: null } },
	])('are keyed exactly as a $kind Event\'s catalogue ($event.variant)', ({ kind, event }) => {
		const values = featureMatchTokenValues({
			event: { name: 'Open', ...event } as any,
			featureMatch: null,
			sourceMatch: null,
			round: null,
			phase: null,
		});

		expect(Object.keys(values).sort()).toEqual(featureMatchTokenCatalogue(kind).map(token => token.key).sort());
	});
});
