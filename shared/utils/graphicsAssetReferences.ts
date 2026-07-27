import type { GraphicAssetReference } from '../types/graphicsAsset';
import type {
	FeatureMatchOverlayModeConfig,
	FeatureMatchWidgetConfig,
} from '../types/screenConfig';

export interface ScreenGraphicAssetReference {
	reference: GraphicAssetReference;
	ownerSlot: string;
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
		? { reference: widget.asset, ownerSlot }
		: undefined;
}

export function featureMatchOverlayGraphicAssetReferences(
	config: FeatureMatchOverlayModeConfig,
): ScreenGraphicAssetReference[] {
	const references: ScreenGraphicAssetReference[] = [];
	if (config.layout.frame.backgroundImage) {
		references.push({
			reference: config.layout.frame.backgroundImage,
			ownerSlot: 'layout.frame.backgroundImage',
		});
	}
	for (const item of config.layout.items) {
		if (item.type === 'widget') {
			const reference = widgetReference(
				item.widget,
				`layout.items.${item.id}.widget.asset`,
			);
			if (reference)
				references.push(reference);
		}
		if (item.type === 'widget-group') {
			for (const child of item.children) {
				const reference = widgetReference(
					child.widget,
					`layout.items.${item.id}.children.${child.id}.widget.asset`,
				);
				if (reference)
					references.push(reference);
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
		right.map(item => [item.ownerSlot, item.reference] as const),
	);
	return left.every(item =>
		sameGraphicAssetReference(item.reference, rightBySlot.get(item.ownerSlot)),
	);
}

export function graphicAssetRevisionContentPath(reference: GraphicAssetReference): string {
	return `/api/graphics-assets/${encodeURIComponent(reference.assetId)}/revisions/${encodeURIComponent(reference.revisionId)}/content`;
}

export function graphicAssetRevisionStatusPath(reference: GraphicAssetReference): string {
	return `/api/graphics-assets/${encodeURIComponent(reference.assetId)}/revisions/${encodeURIComponent(reference.revisionId)}/status`;
}
