import type {
	BroadcastGraphicConfig,
	ClockGraphicItemConfig,
	DeckListGraphicItemConfig,
	GameWinsGraphicItemConfig,
	GraphicGroupChildConfig,
	GraphicGroupItemConfig,
	GraphicItemConfig,
	GraphicSurfaceStyle,
	MediaGraphicItemConfig,
	PlayerLifeGraphicItemConfig,
	ShapeGraphicItemConfig,
	SocialNetworkIconGraphicItemConfig,
	TextGraphicItemConfig,
} from '~~/shared/types/graphics';
import type { GraphicAssetReference } from '~~/shared/types/graphicsAsset';
import { DEFAULT_GRAPHIC_TYPOGRAPHY, getGraphicItemDefinition, squareShapeGeometry } from '~~/shared/modules/graphics';
import { resolveGraphicsCompositionRenderModel } from '~/modules/graphics/renderModel';

/** Graphic Item builders and a one-graphic composition shorthand for render-model tests. */

export const CANVAS = { canvasWidth: 1920, canvasHeight: 1080 };

export const ASSET: GraphicAssetReference = {
	assetId: 'asset-1' as GraphicAssetReference['assetId'],
	revisionId: 'revision-7' as GraphicAssetReference['revisionId'],
};

/** Resolves the way a Screen Output's capability-backed resolver does. */
export function contentUrl(reference: GraphicAssetReference): string {
	return `/api/screen-output/screens/9/assets/${reference.assetId}/revisions/${reference.revisionId}/content`;
}

export function surfaceStyle(overrides: Partial<GraphicSurfaceStyle> = {}): GraphicSurfaceStyle {
	return {
		fill: { type: 'solid', color: '#0077a3' },
		fillOpacity: 0.5,
		...overrides,
	};
}

export function shape(id: string, overrides: Partial<ShapeGraphicItemConfig> = {}): ShapeGraphicItemConfig {
	return {
		type: 'shape',
		id,
		label: id,
		visible: true,
		anchor: 'top-left',
		x: 10,
		y: 20,
		width: 300,
		height: 100,
		geometry: squareShapeGeometry(),
		surfaceStyle: surfaceStyle(),
		...overrides,
	};
}

export function text(id: string, overrides: Partial<TextGraphicItemConfig> = {}): TextGraphicItemConfig {
	return {
		type: 'text',
		id,
		label: id,
		visible: true,
		anchor: 'top-left',
		x: 0,
		y: 0,
		width: 400,
		height: 80,
		text: 'Commentator',
		typography: { ...DEFAULT_GRAPHIC_TYPOGRAPHY },
		overflowPolicy: 'ellipsis',
		minFontSize: 24,
		...overrides,
	};
}

export function media(id: string, overrides: Partial<MediaGraphicItemConfig> = {}): MediaGraphicItemConfig {
	return {
		type: 'media',
		id,
		label: id,
		visible: true,
		anchor: 'top-left',
		x: 40,
		y: 60,
		width: 480,
		height: 270,
		asset: ASSET,
		mediaKind: 'image',
		fit: 'cover',
		focalPosition: { horizontal: 0.5, vertical: 0.5 },
		opacity: 1,
		playbackRate: 1,
		loop: true,
		...overrides,
	};
}

export function socialIcon(
	id: string,
	overrides: Partial<SocialNetworkIconGraphicItemConfig> = {},
): SocialNetworkIconGraphicItemConfig {
	return {
		type: 'social-network-icon',
		id,
		label: id,
		visible: true,
		anchor: 'top-left',
		x: 10,
		y: 20,
		width: 64,
		height: 64,
		network: 'twitch',
		color: '#9146ff',
		opacity: 0.6,
		...overrides,
	};
}

export function group(
	id: string,
	children: GraphicGroupChildConfig[],
	overrides: Partial<GraphicGroupItemConfig> = {},
): GraphicGroupItemConfig {
	return {
		type: 'group',
		id,
		label: id,
		visible: true,
		anchor: 'top-left',
		x: 100,
		y: 200,
		width: 600,
		height: 120,
		arrangement: 'row',
		padding: 0,
		gap: 16,
		align: 'stretch',
		justify: 'start',
		clip: false,
		geometry: squareShapeGeometry(),
		children,
		...overrides,
	};
}

export function graphic(id: string, items: BroadcastGraphicConfig['items']): BroadcastGraphicConfig {
	return { id, name: id, items };
}

/** A context-gated kind, built from its own Graphic Item Definition so its default cannot drift. */
export function contextGated<K extends 'clock' | 'player-life' | 'game-wins' | 'deck-list'>(
	kind: K,
	id: string,
	overrides: Partial<Extract<GraphicItemConfig, { type: K }>> = {},
): Extract<GraphicItemConfig, { type: K }> {
	const item = getGraphicItemDefinition(kind).createDefault({ id, label: id, ...CANVAS });
	return {
		...item,
		...overrides,
	} as Extract<GraphicItemConfig, { type: K }>;
}

export function clock(id: string, overrides: Partial<ClockGraphicItemConfig> = {}) {
	return contextGated('clock', id, overrides);
}

export function playerLife(id: string, overrides: Partial<PlayerLifeGraphicItemConfig> = {}) {
	return contextGated('player-life', id, overrides);
}

export function gameWins(id: string, overrides: Partial<GameWinsGraphicItemConfig> = {}) {
	return contextGated('game-wins', id, overrides);
}

export function deckList(id: string, overrides: Partial<DeckListGraphicItemConfig> = {}) {
	return contextGated('deck-list', id, overrides);
}

type CompositionInput = Parameters<typeof resolveGraphicsCompositionRenderModel>[0];

/** One Broadcast Graphic `a` holding `items`, composed on a 1920×1080 canvas in the Overlay Output unless told otherwise. */
export function compose(
	items: BroadcastGraphicConfig['items'],
	options: Partial<Omit<CompositionInput, 'graphics'>> = {},
) {
	return resolveGraphicsCompositionRenderModel({
		output: 'overlay',
		graphics: [
			graphic('a', items),
		],
		...CANVAS,
		...options,
	});
}
