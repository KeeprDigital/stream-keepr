import { describe, expect, it } from 'vitest';
import { buildFeatureMatchOverlayTemplateMetadataValues, featureMatchTokenValues } from '~~/shared/featureMatchOverlayValues';
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
