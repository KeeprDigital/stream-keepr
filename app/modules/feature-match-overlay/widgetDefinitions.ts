import type { FeatureMatchWidgetConfig } from '~~/shared/types/screenConfig';

/**
 * Feature Match Overlay Widget Definition: the editor-facing contract for one
 * Widget type — display label, icon, default configuration, and summary.
 * Adding a Widget type means one entry here plus a branch in the renderer
 * (see Widget.vue / renderModel.widgetRender); nothing else enumerates types.
 */
export interface FeatureMatchOverlayWidgetDefinition {
	type: FeatureMatchWidgetConfig['type'];
	label: string;
	icon: string;
	defaultConfig: () => FeatureMatchWidgetConfig;
	summary: (widget: FeatureMatchWidgetConfig) => string;
}

const DEFINITIONS = {
	'text': {
		type: 'text',
		label: 'Text',
		icon: 'i-lucide-type',
		defaultConfig: () => ({ type: 'text', playerSide: 'player1', template: '{name}' }),
		summary: widget => widget.type === 'text' ? widget.template || 'Text' : 'Text',
	},
	'image': {
		type: 'image',
		label: 'Image',
		icon: 'i-lucide-image',
		defaultConfig: () => ({ type: 'image', url: '', fit: 'contain', opacity: 1, borderRadius: 0 }),
		summary: widget => widget.type === 'image' && widget.url ? 'Image URL set' : 'Image',
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
		summary: widget => widget.type === 'player-life' ? `${widget.playerSide} life` : 'Life',
	},
	'game-wins': {
		type: 'game-wins',
		label: 'Wins',
		icon: 'i-lucide-trophy',
		defaultConfig: () => ({ type: 'game-wins', playerSide: 'player1', displayMode: 'boxes', boxOrientation: 'horizontal', boxWidth: 22, boxHeight: 22, boxGap: 6, boxBorderWidth: 2 }),
		summary: widget => widget.type === 'game-wins' ? `${widget.playerSide} wins` : 'Wins',
	},
} satisfies Record<FeatureMatchWidgetConfig['type'], FeatureMatchOverlayWidgetDefinition>;

export const FEATURE_MATCH_OVERLAY_WIDGET_TYPES = Object.keys(DEFINITIONS) as Array<FeatureMatchWidgetConfig['type']>;

export function featureMatchOverlayWidgetDefinition(type: FeatureMatchWidgetConfig['type']): FeatureMatchOverlayWidgetDefinition {
	return DEFINITIONS[type];
}
