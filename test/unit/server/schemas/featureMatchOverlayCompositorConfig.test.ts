import type { GraphicItemConfig } from '~~/shared/types/graphics';
import { describe, expect, it } from 'vitest';
import {
	featureMatchOverlayModeConfigSchema,
	MAX_GRAPHIC_ITEMS_PER_FEATURE_MATCH_LAYOUT,
} from '~~/server/schemas/api/screen';
import { createFeatureMatchLayoutComposition } from '~~/shared/featureMatchLayoutComposition';
import { getGraphicItemDefinition } from '~~/shared/modules/graphics';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';

function item(kind: 'text' | 'clock' | 'player-life' | 'game-wins', id: string): GraphicItemConfig {
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
		layout: { ...config.layout, composition: { ...createFeatureMatchLayoutComposition(), items } },
	};
}

describe('featureMatchOverlayModeConfigSchema', () => {
	it('accepts a layout carrying no shared item tree', () => {
		// A layout authored before the compositor still validates: the field is
		// optional, and adopting the compositor cannot invalidate stored configuration.
		expect(featureMatchOverlayModeConfigSchema.safeParse(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG).success).toBe(true);
	});

	it('accepts the shared base kinds and the three context-gated kinds', () => {
		const parsed = featureMatchOverlayModeConfigSchema.safeParse(configWith([
			item('text', 'name'),
			item('clock', 'clock'),
			item('player-life', 'life'),
			item('game-wins', 'wins'),
		]));

		expect(parsed.success).toBe(true);
	});

	it('refuses a Feature Match Layout that declares Graphic Inputs', () => {
		// The Host Contract says a Feature Match Overlay binds a fixed token catalogue
		// instead of declaring inputs. Accepting the field would store declarations
		// nothing resolves and nothing can accept — there is no Update Graphic here.
		const config = configWith([item('text', 'name')]);
		const parsed = featureMatchOverlayModeConfigSchema.safeParse({
			...config,
			layout: {
				...config.layout,
				composition: {
					...config.layout.composition,
					inputs: [{
						type: 'text',
						key: 'name',
						label: 'Name',
						required: false,
						updatePolicy: 'staged',
						default: '',
						maxLength: 40,
					}],
				},
			},
		});

		expect(parsed.success).toBe(false);
	});

	it('refuses duplicate Graphic Item ids within one Feature Match Layout', () => {
		// Every authoring operation addresses an item by id alone, so a duplicate would
		// edit, move, or delete the wrong item.
		const parsed = featureMatchOverlayModeConfigSchema.safeParse(
			configWith([item('text', 'name'), item('clock', 'name')]),
		);

		expect(parsed.success).toBe(false);
	});

	it('refuses a Game Wins Item carrying the legacy border width instead of a Shape Geometry', () => {
		const wins = item('game-wins', 'wins');
		const parsed = featureMatchOverlayModeConfigSchema.safeParse(
			configWith([{ ...wins, boxBorderWidth: 2 } as unknown as GraphicItemConfig]),
		);

		expect(parsed.success).toBe(false);
	});

	it('bounds a Player Life change animation to a duration an operator can read', () => {
		const life = item('player-life', 'life');
		const tooLong = featureMatchOverlayModeConfigSchema.safeParse(
			configWith([{ ...life, lifeAnimationDurationMs: 9000 } as GraphicItemConfig]),
		);

		expect(tooLong.success).toBe(false);
		expect(featureMatchOverlayModeConfigSchema.safeParse(
			configWith([{ ...life, lifeAnimationDurationMs: 3000 } as GraphicItemConfig]),
		).success).toBe(true);
	});

	it('accepts a context-gated Item as a Graphic Group child', () => {
		// A Feature Match Layout composes a player cluster from a life total and a win
		// indicator in one row, so the group child union gates on context exactly as the
		// top-level one does.
		const group = getGraphicItemDefinition('group').createDefault({
			id: 'cluster',
			label: 'Cluster',
			canvasWidth: 1920,
			canvasHeight: 1080,
		});
		const parsed = featureMatchOverlayModeConfigSchema.safeParse(configWith([
			{ ...group, children: [item('player-life', 'life'), item('game-wins', 'wins')] } as GraphicItemConfig,
		]));

		expect(parsed.success).toBe(true);
	});

	it('counts Graphic Group children against the Feature Match Layout item cap', () => {
		// The cap was on the top-level list alone, so a layout could carry 100
		// top-level items each holding 50 Graphic Group children — 5,100 Graphic
		// Items — against 110 for a whole Broadcast Graphics Screen, stopped only by
		// the opaque byte total. One composition, one bound, whichever host it
		// belongs to. See #99.
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
		expect(featureMatchOverlayModeConfigSchema.safeParse(groupsOf(21, 4)).success).toBe(false);
		const over = featureMatchOverlayModeConfigSchema.safeParse(groupsOf(21, 4));
		expect(over.error?.issues.map(issue => issue.message)).toContain(
			`A Feature Match Layout must not contain more than ${MAX_GRAPHIC_ITEMS_PER_FEATURE_MATCH_LAYOUT} Graphic Items in total`,
		);
	});

	it('bounds a Feature Match Layout stagger to the items the composition holds', () => {
		// The same rule the Broadcast Graphics containers carry, on the same shared
		// vocabulary: a stagger orders a subset of its container's own items.
		const staggered = (ids: number) => {
			const config = configWith([item('text', 'name')]);
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
