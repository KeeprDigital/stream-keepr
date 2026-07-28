import type { GraphicAssetReference } from '../types/graphicsAsset';
import type {
	FeatureMatchOverlayBoxStyle,
	FeatureMatchOverlayModeConfig,
	FeatureMatchWidgetConfig,
} from '../types/screenConfig';

export interface ScreenGraphicAssetReference {
	reference: GraphicAssetReference;
	ownerSlot: string;
	kind: 'image' | 'font';
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
	return widget.type === 'image' && widget.asset
		? { reference: widget.asset, ownerSlot, kind: 'image' }
		: undefined;
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
