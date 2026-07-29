import type { GraphicAssetReference } from '../types/graphicsAsset';
import type {
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
