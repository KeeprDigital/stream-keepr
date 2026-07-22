import { describe, expect, it } from 'vitest';
import { buildFeatureMatchOverlayTemplateMetadataValues } from '~/utils/featureMatchOverlayTemplateValues';

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
				activeSession: { sourceSnapshot: { tableNumber: 9 } },
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
