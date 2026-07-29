import type { FeatureMatchGraphicItemDefinitionConfig } from '~~/shared/types/screenConfig';

/**
 * Feature Match Overlay Graphic Item Definition: the editor-facing contract for
 * one Graphic Item type — display label, icon, default configuration, and summary.
 * Adding a Graphic Item type means one entry here plus a branch in the renderer
 * (see Widget.vue / renderModel.graphicItemRender); nothing else enumerates types.
 */
export interface FeatureMatchOverlayGraphicItemDefinition<
	Config extends FeatureMatchGraphicItemDefinitionConfig = FeatureMatchGraphicItemDefinitionConfig,
> {
	type: Config['type'];
	label: string;
	icon: string;
	defaultConfig: () => Config;
	summary: (graphicItem: Config) => string;
}

const DEFINITIONS = {
	'text': {
		type: 'text',
		label: 'Text',
		icon: 'i-lucide-type',
		defaultConfig: () => ({ type: 'text', playerSide: 'player1', template: '{name}' }),
		summary: graphicItem => graphicItem.type === 'text' ? graphicItem.template || 'Text' : 'Text',
	},
	'image': {
		type: 'image',
		label: 'Image',
		icon: 'i-lucide-image',
		defaultConfig: () => ({ type: 'image', fit: 'contain', opacity: 1, borderRadius: 0 }),
		summary: graphicItem => graphicItem.type === 'image' && graphicItem.asset ? 'Graphic Asset selected' : 'Image',
	},
	'clock': {
		type: 'clock',
		label: 'Clock',
		icon: 'i-lucide-clock',
		defaultConfig: () => ({ type: 'clock' }),
		summary: () => 'Live clock',
	},
	'player-life': {
		type: 'player-life',
		label: 'Life',
		icon: 'i-lucide-heart-pulse',
		defaultConfig: () => ({ type: 'player-life', playerSide: 'player1', lifeAnimation: 'glow', lifeAnimationDurationMs: 420, lifeAnimationAccentColor: '#ffffff' }),
		summary: graphicItem => graphicItem.type === 'player-life' ? `${graphicItem.playerSide} life` : 'Life',
	},
	'game-wins': {
		type: 'game-wins',
		label: 'Wins',
		icon: 'i-lucide-trophy',
		defaultConfig: () => ({ type: 'game-wins', playerSide: 'player1', displayMode: 'boxes', boxOrientation: 'horizontal', boxWidth: 22, boxHeight: 22, boxGap: 6, boxBorderWidth: 2 }),
		summary: graphicItem => graphicItem.type === 'game-wins' ? `${graphicItem.playerSide} wins` : 'Wins',
	},
} satisfies Record<FeatureMatchGraphicItemDefinitionConfig['type'], FeatureMatchOverlayGraphicItemDefinition>;

export const FEATURE_MATCH_OVERLAY_GRAPHIC_ITEM_TYPES = Object.keys(DEFINITIONS) as Array<FeatureMatchGraphicItemDefinitionConfig['type']>;

export function featureMatchOverlayGraphicItemDefinition<
	Type extends FeatureMatchGraphicItemDefinitionConfig['type'],
>(
	type: Type,
): FeatureMatchOverlayGraphicItemDefinition<
	Extract<FeatureMatchGraphicItemDefinitionConfig, { type: Type }>
> {
	return DEFINITIONS[type] as unknown as FeatureMatchOverlayGraphicItemDefinition<
		Extract<FeatureMatchGraphicItemDefinitionConfig, { type: Type }>
	>;
}
