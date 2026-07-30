import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import type { GraphicAssetReference } from '~~/shared/types/graphicsAsset';
import type { ScreenOutput } from '~~/shared/types/screenConfig';
import type { GraphicsCompositionRenderModel } from '~/modules/graphics/renderModel';
import type { GraphicsSelectionTarget } from '~/modules/graphics/selection';
import { resolveGraphicsCompositionRenderModel } from '~/modules/graphics/renderModel';

export interface BroadcastGraphicsRenderModelInput {
	output: ScreenOutput;
	canvasWidth: number;
	canvasHeight: number;
	/** The Screen's authored back-to-front stack of Broadcast Graphics. */
	graphics: readonly BroadcastGraphicConfig[];
	/**
	 * The Broadcast Graphics currently on air. A Screen Output composes only
	 * these; an omitted set means none are on air, so the Screen renders empty
	 * until an operator takes a graphic.
	 */
	onAirGraphicIds?: readonly string[];
	/** Editor-only item guides and selection highlighting. */
	itemGuides?: boolean;
	/** Editor-only advisory action-safe and title-safe guides. */
	safeAreaGuides?: boolean;
	selectedTarget?: GraphicsSelectionTarget;
	/**
	 * Resolves a Media Graphic Item's pinned Graphic Asset Revision to a URL this
	 * output may load. A live Screen Output supplies one backed by its Screen
	 * Output Asset Capability, so an output resolves content only through that
	 * capability and never by browsing the Graphics Asset Library.
	 */
	graphicAssetContentUrl?: (reference: GraphicAssetReference) => string;
}

export type BroadcastGraphicsRenderModel = GraphicsCompositionRenderModel;

/**
 * Broadcast Graphics Screen render-model seam.
 *
 * Composition in, one Screen Output render model out. The Screen supplies its
 * own canvas and authored stack; the shared compositor turns them into the one
 * composed transparent colour-and-opacity frame from which the Overlay, Fill,
 * and Key Outputs are derived, all at identical canvas dimensions.
 *
 * An empty Broadcast Graphics Screen is transparent in its Overlay Output and
 * black in its Fill Output and Key Output.
 */
export function resolveBroadcastGraphicsRenderModel(
	input: BroadcastGraphicsRenderModelInput,
): BroadcastGraphicsRenderModel {
	return resolveGraphicsCompositionRenderModel({
		output: input.output,
		canvasWidth: input.canvasWidth,
		canvasHeight: input.canvasHeight,
		graphics: input.graphics,
		visibleGraphicIds: input.onAirGraphicIds ?? [],
		itemGuides: input.itemGuides,
		safeAreaGuides: input.safeAreaGuides,
		selectedTarget: input.selectedTarget,
		graphicAssetContentUrl: input.graphicAssetContentUrl,
	});
}
