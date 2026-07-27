import type { GraphicAssetReference } from '~~/shared/types/graphicsAsset';
import type {
	FeatureMatchOverlayModeConfig,
	FeatureMatchWidgetConfig,
} from '~~/shared/types/screenConfig';

export interface ScreenGraphicAssetReference {
	reference: GraphicAssetReference;
	ownerSlot: string;
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
