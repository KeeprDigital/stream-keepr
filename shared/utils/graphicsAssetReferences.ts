import type { GraphicAssetReference } from '../types/graphicsAsset';
import type {
	FeatureMatchOverlayBoxStyle,
	FeatureMatchOverlayModeConfig,
	FeatureMatchWidgetConfig,
} from '../types/screenConfig';
import type { GraphicsVideoTarget } from './graphicAssetTargetCompatibility';
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

function widgetReference(
	widget: FeatureMatchWidgetConfig,
	ownerSlot: string,
): ScreenGraphicAssetReference | undefined {
	if (widget.type === 'image' && widget.asset) {
		return {
			reference: widget.asset,
			ownerSlot,
			kind: 'image',
		};
	}
	return undefined;
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

function appendTokenFontReferences(
	references: ScreenGraphicAssetReference[],
	widget: FeatureMatchWidgetConfig,
	ownerSlot: string,
) {
	if (widget.type !== 'text')
		return;
	for (const [token, style] of Object.entries(widget.tokenStyles ?? {}))
		appendFontReference(references, style, `${ownerSlot}.tokenStyles.${token}.font`);
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
		appendFontReference(references, item.surfaceStyle, `layout.items.${item.id}.surfaceStyle.font`);
		if (item.type === 'media' && item.asset) {
			references.push({
				reference: item.asset,
				ownerSlot: `layout.items.${item.id}.asset`,
				kind: item.mediaKind,
				videoCompatibility: item.videoCompatibility,
				videoTarget: item.videoTarget,
			});
		}
		if (item.type === 'widget') {
			const reference = widgetReference(
				item.widget,
				`layout.items.${item.id}.widget.asset`,
			);
			if (reference)
				references.push(reference);
			appendTokenFontReferences(references, item.widget, `layout.items.${item.id}.widget`);
		}
		if (item.type === 'widget-group') {
			appendFontReference(
				references,
				item.defaultChildSurfaceStyle,
				`layout.items.${item.id}.defaultChildSurfaceStyle.font`,
			);
			for (const child of item.children) {
				appendFontReference(
					references,
					child.surfaceStyle,
					`layout.items.${item.id}.children.${child.id}.surfaceStyle.font`,
				);
				const reference = widgetReference(
					child.widget,
					`layout.items.${item.id}.children.${child.id}.widget.asset`,
				);
				if (reference)
					references.push(reference);
				appendTokenFontReferences(
					references,
					child.widget,
					`layout.items.${item.id}.children.${child.id}.widget`,
				);
			}
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

export function graphicAssetRevisionStatusPath(reference: GraphicAssetReference): string {
	return `/api/graphics-assets/${encodeURIComponent(reference.assetId)}/revisions/${encodeURIComponent(reference.revisionId)}/status`;
}
