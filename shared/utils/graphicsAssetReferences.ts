import type { GraphicGroupChildConfig, GraphicItemConfig } from '../types/graphics';
import type { GraphicAssetReference } from '../types/graphicsAsset';
import type {
	BroadcastGraphicsModeConfig,
	FeatureMatchGraphicItemDefinitionOwnedConfig,
	FeatureMatchOverlayBoxStyle,
	FeatureMatchOverlayModeConfig,
} from '../types/screenConfig';
import type { GraphicsVideoTarget } from './graphicAssetTargetCompatibility';
import { discoverFeatureMatchGraphicItemAssetReferences } from '../featureMatchGraphicItemDefinitions';
import { chromiumTransparencyTargetCompatibility } from './graphicAssetTargetCompatibility';

export interface ScreenGraphicAssetReference {
	reference: GraphicAssetReference;
	ownerSlot: string;
	kind: 'image' | 'silent-video' | 'font';
	videoCompatibility?: 'all-supported' | 'chromium-transparency';
	videoTarget?: Exclude<GraphicsVideoTarget, 'other'>;
}

export function screenGraphicAssetReferenceTargetCompatibility(
	reference: ScreenGraphicAssetReference,
	actualTarget?: GraphicsVideoTarget,
):
	| { outcome: 'compatible' }
	| { outcome: 'blocked'; code: 'vp9-alpha-chromium-required' } {
	return chromiumTransparencyTargetCompatibility(
		reference.videoCompatibility === 'chromium-transparency',
		reference.videoTarget,
		actualTarget,
	);
}

export function sameGraphicAssetReference(
	left: GraphicAssetReference | undefined,
	right: GraphicAssetReference | undefined,
): boolean {
	return left?.assetId === right?.assetId
		&& left?.revisionId === right?.revisionId;
}

function fontReference(
	style: FeatureMatchOverlayBoxStyle | undefined,
	ownerSlot: string,
): ScreenGraphicAssetReference | undefined {
	return style?.font?.kind === 'asset'
		? { reference: style.font.reference, ownerSlot, kind: 'font' }
		: undefined;
}

function appendFontReference(
	references: ScreenGraphicAssetReference[],
	style: FeatureMatchOverlayBoxStyle | undefined,
	ownerSlot: string,
) {
	const reference = fontReference(style, ownerSlot);
	if (reference)
		references.push(reference);
}

function appendGraphicItemAssetReferences(
	references: ScreenGraphicAssetReference[],
	graphicItem: FeatureMatchGraphicItemDefinitionOwnedConfig,
	ownerSlot: string,
) {
	for (const discovered of discoverFeatureMatchGraphicItemAssetReferences(graphicItem)) {
		references.push({
			reference: discovered.reference,
			ownerSlot: `${ownerSlot}.${discovered.ownerSuffix}`,
			kind: discovered.kind,
			videoCompatibility: discovered.videoCompatibility,
			videoTarget: discovered.videoTarget,
		});
	}
}

export function featureMatchOverlayGraphicAssetReferences(
	config: FeatureMatchOverlayModeConfig,
): ScreenGraphicAssetReference[] {
	const references: ScreenGraphicAssetReference[] = [];
	if (config.layout.frame.backgroundImage) {
		references.push({
			reference: config.layout.frame.backgroundImage,
			ownerSlot: 'layout.frame.backgroundImage',
			kind: 'image',
		});
	}
	for (const item of config.layout.items) {
		if (item.type === 'graphic-item')
			appendFontReference(references, item.surfaceStyle, `layout.items.${item.id}.surfaceStyle.font`);
		if (item.type === 'graphic-item') {
			appendGraphicItemAssetReferences(references, item.graphicItem, `layout.items.${item.id}.graphicItem`);
		}
		else {
			appendGraphicItemAssetReferences(references, item, `layout.items.${item.id}`);
		}
	}
	return references;
}

/**
 * Every exact Graphic Asset Revision a Broadcast Graphics Screen publishes.
 *
 * This is what the Screen's reference index is built from, and so what its Screen
 * Output Asset Capability will resolve: an output can reach exactly these
 * revisions and nothing else in the Graphics Asset Library.
 *
 * The owner slot names the item that pins the reference, so a Missing Graphic
 * Asset Reference is reported against the Graphic Item an author can go and
 * repair rather than against the Screen as a whole. Slots are stable across a
 * reorder, because they are built from ids rather than list positions — a
 * reordered stack must not read as a set of changed references.
 *
 * A silent-video reference carries the pinned revision's own target
 * compatibility, which the reference index checks it against, and an authored
 * target of Chromium. Broadcast Graphics Screen Outputs are consumed as browser
 * sources in Chromium-based capture, which is what makes VP9 alpha usable here at
 * all; an output opened in another engine reports the incompatibility rather than
 * silently showing nothing.
 */
export function broadcastGraphicsGraphicAssetReferences(
	config: BroadcastGraphicsModeConfig,
): ScreenGraphicAssetReference[] {
	const references: ScreenGraphicAssetReference[] = [];

	function append(item: GraphicItemConfig | GraphicGroupChildConfig, ownerSlot: string) {
		if (item.type !== 'media' || !item.asset)
			return;
		references.push({
			reference: item.asset,
			ownerSlot: `${ownerSlot}.asset`,
			kind: item.mediaKind,
			...(item.mediaKind === 'silent-video'
				? { videoCompatibility: item.videoCompatibility, videoTarget: 'chromium' as const }
				: {}),
		});
	}

	for (const graphic of config.graphics) {
		for (const item of graphic.items) {
			const slot = `graphics.${graphic.id}.items.${item.id}`;
			append(item, slot);
			if (item.type !== 'group')
				continue;
			for (const child of item.children)
				append(child, `${slot}.children.${child.id}`);
		}
	}

	return references;
}

/**
 * The Screen Modes whose configuration publishes Graphic Asset References.
 *
 * Every other mode publishes none, so its configuration writes go through the
 * ordinary versioned write. A mode listed here writes its configuration and its
 * reference index in one atomic operation instead.
 */
export const GRAPHIC_ASSET_REFERENCING_SCREEN_MODES = ['feature-match-overlay', 'broadcast-graphics'] as const;

export type GraphicAssetReferencingScreenMode = typeof GRAPHIC_ASSET_REFERENCING_SCREEN_MODES[number];

export function isGraphicAssetReferencingScreenMode(mode: string): mode is GraphicAssetReferencingScreenMode {
	return (GRAPHIC_ASSET_REFERENCING_SCREEN_MODES as readonly string[]).includes(mode);
}

export interface GraphicAssetReferencingScreenModeConfigs {
	'feature-match-overlay'?: FeatureMatchOverlayModeConfig;
	'broadcast-graphics'?: BroadcastGraphicsModeConfig;
}

/**
 * The references one Screen Mode's configuration publishes, whichever mode it is.
 *
 * One dispatcher rather than a branch at each call site: the write path, the
 * create-path rejection, and the publication-eligibility check all need the same
 * answer, and a mode added to the list above must reach every one of them or a
 * Screen Output would resolve content nothing indexed.
 */
export function screenModeGraphicAssetReferences(
	mode: GraphicAssetReferencingScreenMode,
	modeConfigs: GraphicAssetReferencingScreenModeConfigs | null | undefined,
): ScreenGraphicAssetReference[] {
	if (mode === 'feature-match-overlay') {
		const config = modeConfigs?.['feature-match-overlay'];
		return config ? featureMatchOverlayGraphicAssetReferences(config) : [];
	}
	const config = modeConfigs?.['broadcast-graphics'];
	return config ? broadcastGraphicsGraphicAssetReferences(config) : [];
}

export function sameScreenGraphicAssetReferences(
	left: readonly ScreenGraphicAssetReference[],
	right: readonly ScreenGraphicAssetReference[],
): boolean {
	if (left.length !== right.length)
		return false;
	const rightBySlot = new Map(
		right.map(item => [item.ownerSlot, item] as const),
	);
	return left.every((item) => {
		const other = rightBySlot.get(item.ownerSlot);
		return item.kind === other?.kind
			&& item.videoCompatibility === other?.videoCompatibility
			&& item.videoTarget === other?.videoTarget
			&& sameGraphicAssetReference(item.reference, other.reference);
	});
}

export function graphicAssetRevisionContentPath(reference: GraphicAssetReference): string {
	return `/api/graphics-assets/${encodeURIComponent(reference.assetId)}/revisions/${encodeURIComponent(reference.revisionId)}/content`;
}

export function screenOutputGraphicAssetRevisionContentPath(
	screenId: number,
	reference: GraphicAssetReference,
): string {
	return `/api/screen-output/screens/${screenId}/assets/${encodeURIComponent(reference.assetId)}/revisions/${encodeURIComponent(reference.revisionId)}/content`;
}

export function screenOutputAssetCapabilityCookieName(screenId: number): string {
	return `screen-output-asset-capability-${screenId}`;
}

export function screenOutputAssetCapabilityCookiePath(screenId: number): string {
	return `/api/screen-output/screens/${screenId}/`;
}

export function screenOutputAssetCapabilitySessionPath(screenId: number): string {
	return `${screenOutputAssetCapabilityCookiePath(screenId)}asset-capability-session`;
}

export function graphicAssetRevisionStatusPath(reference: GraphicAssetReference): string {
	return `/api/graphics-assets/${encodeURIComponent(reference.assetId)}/revisions/${encodeURIComponent(reference.revisionId)}/status`;
}
