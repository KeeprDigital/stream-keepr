import type { BroadcastGraphicConfig, GraphicInputValue } from '~~/shared/types/graphics';
import type { ScreenOutput } from '~~/shared/types/screenConfig';
import type { GraphicsAnimationProjection, GraphicsCompositionRenderModel } from '~/modules/graphics/renderModel';
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
	/**
	 * Which lifecycle phase each Broadcast Graphic is in, and how long it has been
	 * there. An omitted map composes every graphic at its Graphic Resting State,
	 * which is what a settled Screen and a recovered Live Session both resolve to.
	 */
	animation?: Readonly<Record<string, GraphicsAnimationProjection>>;
	/**
	 * The accepted on-air Graphic Input values a Graphic Text Template renders,
	 * keyed by Broadcast Graphic id. Omitted renders declared defaults, which is what
	 * an editor preview with no Live Session shows.
	 */
	inputValues?: Readonly<Record<string, Readonly<Record<string, GraphicInputValue>>>>;
	/** Editor-only item guides and selection highlighting. */
	itemGuides?: boolean;
	/** Editor-only advisory action-safe and title-safe guides. */
	safeAreaGuides?: boolean;
	selectedTarget?: GraphicsSelectionTarget;
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
		animation: input.animation,
		inputValues: input.inputValues,
		itemGuides: input.itemGuides,
		safeAreaGuides: input.safeAreaGuides,
		selectedTarget: input.selectedTarget,
	});
}
