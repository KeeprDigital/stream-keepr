import type { GraphicItemConfig } from '~~/shared/types/graphics';
import { describe, expect, it } from 'vitest';
import { featureMatchOverlayModeConfigSchema } from '~~/server/schemas/api/screen';
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
});
