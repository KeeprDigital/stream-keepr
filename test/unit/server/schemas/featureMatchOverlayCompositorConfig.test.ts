import type { GraphicItemConfig } from '~~/shared/types/graphics';
import { describe, expect, it } from 'vitest';
import {
	featureMatchOverlayModeConfigSchema,
	MAX_GRAPHIC_ITEMS_PER_FEATURE_MATCH_LAYOUT,
} from '~~/server/schemas/api/screen';
import { createFeatureMatchLayoutComposition } from '~~/shared/featureMatchLayoutComposition';
import { getGraphicItemDefinition } from '~~/shared/modules/graphics';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';

function item(kind: 'text' | 'clock' | 'player-life' | 'game-wins' | 'deck-list', id: string): GraphicItemConfig {
	return getGraphicItemDefinition(kind).createDefault({
		id,
		label: id,
		canvasWidth: 1920,
		canvasHeight: 1080,
	});
}

function configWith(items: GraphicItemConfig[]) {
	const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
	return {
		...config,
		layout: {
			...config.layout,
			composition: {
				...createFeatureMatchLayoutComposition(),
				items,
			},
		},
	};
}

describe('featureMatchOverlayModeConfigSchema', () => {
	it('accepts a layout edit that carries a stale pre-rebuild frame animation along, resetting the animation', () => {
		// Every layout write re-sends the whole stored layout (ADR-0014).
		const config = configWith([
			item('text', 'name'),
		]);
		const parsed = featureMatchOverlayModeConfigSchema.safeParse({
			...config,
			layout: {
				...config.layout,
				frame: {
					...config.layout.frame,
					animation: {
						enabled: true,
						effect: 'waves',
						opacity: 0.6,
						color: '#ffffff',
						waveHeight: 25,
						mouseDriftEnabled: true,
						mouseDriftMode: 'orbit',
						mouseDriftSeconds: 12,
						mouseDriftRadius: 0.4,
					},
				},
			},
		});

		expect(parsed.success).toBe(true);
		expect(parsed.success && parsed.data.layout.frame.animation).toBeUndefined();
	});

	it('refuses a current-shape frame animation naming an effect outside the closed vocabulary', () => {
		const config = configWith([
			item('text', 'name'),
		]);
		const parsed = featureMatchOverlayModeConfigSchema.safeParse({
			...config,
			layout: {
				...config.layout,
				frame: {
					...config.layout.frame,
					animation: { enabled: true, effect: 'not-an-effect', opacity: 0.6 },
				},
			},
		});

		expect(parsed.success).toBe(false);
	});

	it('accepts the shared base kinds and the context-gated kinds', () => {
		const parsed = featureMatchOverlayModeConfigSchema.safeParse(configWith([
			item('text', 'name'),
			item('clock', 'clock'),
			item('player-life', 'life'),
			item('game-wins', 'wins'),
			item('deck-list', 'sideboard'),
		]));

		expect(parsed.success).toBe(true);
	});

	it('refuses a Deck List Item carrying a board field, which v1 deliberately has none of', () => {
		// A stored `board` would be misread by a later version that gains one.
		const sideboard = item('deck-list', 'sideboard');
		const parsed = featureMatchOverlayModeConfigSchema.safeParse(
			configWith([
				{ ...sideboard, board: 'sideboard' } as unknown as GraphicItemConfig,
			]),
		);

		expect(parsed.success).toBe(false);
	});

	it('refuses a Deck List view outside the closed vocabulary', () => {
		const sideboard = item('deck-list', 'sideboard');
		const parsed = featureMatchOverlayModeConfigSchema.safeParse(
			configWith([
				{ ...sideboard, view: 'stack' } as unknown as GraphicItemConfig,
			]),
		);

		expect(parsed.success).toBe(false);
	});

	it('refuses a Feature Match Layout that declares Graphic Inputs', () => {
		// It binds a fixed token catalogue; declared inputs would resolve to nothing.
		const config = configWith([
			item('text', 'name'),
		]);
		const parsed = featureMatchOverlayModeConfigSchema.safeParse({
			...config,
			layout: {
				...config.layout,
				composition: {
					...config.layout.composition,
					inputs: [
						{
							type: 'text',
							key: 'name',
							label: 'Name',
							required: false,
							updatePolicy: 'staged',
							default: '',
							maxLength: 40,
						},
					],
				},
			},
		});

		expect(parsed.success).toBe(false);
	});

	it('refuses duplicate Graphic Item ids within one Feature Match Layout', () => {
		// Authoring addresses an item by id alone.
		const parsed = featureMatchOverlayModeConfigSchema.safeParse(
			configWith([
				item('text', 'name'),
				item('clock', 'name'),
			]),
		);

		expect(parsed.success).toBe(false);
	});

	it('refuses a Game Wins Item carrying the legacy border width instead of a Shape Geometry', () => {
		const wins = item('game-wins', 'wins');
		const parsed = featureMatchOverlayModeConfigSchema.safeParse(
			configWith([
				{ ...wins, boxBorderWidth: 2 } as unknown as GraphicItemConfig,
			]),
		);

		expect(parsed.success).toBe(false);
	});

	it('bounds a Player Life change animation to a duration an operator can read', () => {
		const life = item('player-life', 'life');
		const tooLong = featureMatchOverlayModeConfigSchema.safeParse(
			configWith([
				{ ...life, lifeAnimationDurationMs: 9000 } as GraphicItemConfig,
			]),
		);

		expect(tooLong.success).toBe(false);
		expect(featureMatchOverlayModeConfigSchema.safeParse(
			configWith([
				{ ...life, lifeAnimationDurationMs: 3000 } as GraphicItemConfig,
			]),
		).success).toBe(true);
	});

	it('accepts a context-gated Item as a Graphic Group child', () => {
		const group = getGraphicItemDefinition('group').createDefault({
			id: 'cluster',
			label: 'Cluster',
			canvasWidth: 1920,
			canvasHeight: 1080,
		});
		const parsed = featureMatchOverlayModeConfigSchema.safeParse(configWith([
			{
				...group,
				children: [
					item('player-life', 'life'),
					item('game-wins', 'wins'),
					item('deck-list', 'sideboard'),
				],
			} as GraphicItemConfig,
		]));

		expect(parsed.success).toBe(true);
	});

	it('counts Graphic Group children against the Feature Match Layout item cap', () => {
		// One composition, one bound, whichever host it belongs to (ADR-0007).
		const groupsOf = (groups: number, children: number) => configWith(
			Array.from({ length: groups }, (_, index) => ({
				...getGraphicItemDefinition('group').createDefault({
					id: `cluster-${index}`,
					label: `Cluster ${index}`,
					canvasWidth: 1920,
					canvasHeight: 1080,
				}),
				children: Array.from({ length: children }, (_, child) => item('text', `t-${index}-${child}`)),
			}) as GraphicItemConfig),
		);

		// 20 groups of 4 children is 100 Graphic Items counting the groups themselves.
		expect(featureMatchOverlayModeConfigSchema.safeParse(groupsOf(20, 4)).success).toBe(true);
		const over = featureMatchOverlayModeConfigSchema.safeParse(groupsOf(21, 4));
		expect(over.success).toBe(false);
		expect(over.error?.issues.map(issue => issue.message)).toContain(
			`A Feature Match Layout must not contain more than ${MAX_GRAPHIC_ITEMS_PER_FEATURE_MATCH_LAYOUT} Graphic Items in total`,
		);
	});

	it('bounds a Feature Match Layout stagger to the items the composition holds', () => {
		// A stagger orders a subset of its container's own items.
		const staggered = (ids: number) => {
			const config = configWith([
				item('text', 'name'),
			]);
			return featureMatchOverlayModeConfigSchema.safeParse({
				...config,
				layout: {
					...config.layout,
					composition: {
						...config.layout.composition,
						animation: {
							stagger: {
								enter: {
									order: 'list',
									step: 100,
									itemIds: Array.from({ length: ids }, (_, index) => `name-${index}`),
								},
							},
						},
					},
				},
			});
		};

		expect(staggered(1).success).toBe(true);
		expect(staggered(2).success).toBe(false);
	});
});
