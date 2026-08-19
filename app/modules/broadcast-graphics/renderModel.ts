import type { SocialProfilePresentationProjection } from '~~/shared/modules/broadcast-graphics-live-session';
import type { BroadcastGraphicConfig, GraphicInputValue, SocialProfileProjectionValues } from '~~/shared/types/graphics';
import type { GraphicAssetReference } from '~~/shared/types/graphicsAsset';
import type { ScreenOutput } from '~~/shared/types/screenConfig';
import type { GraphicMediaIncompatibilityCode, GraphicsAnimationProjection, GraphicsCompositionRenderModel } from '~/modules/graphics/renderModel';
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
	 * Which lifecycle phases each Broadcast Graphic is in, and how long it has been in
	 * each, innermost first. An omitted map composes every graphic at its Graphic
	 * Resting State, which is what a settled Screen and a recovered Live Session both
	 * resolve to.
	 *
	 * More than one phase per graphic, because an exit interrupting an update or
	 * on-screen cycling continues from the state that was rendered rather than from the
	 * Graphic Resting State — so both phases are in play and the compositor composes them.
	 */
	animation?: Readonly<Record<string, readonly GraphicsAnimationProjection[]>>;
	/**
	 * The accepted on-air Graphic Input values a Graphic Text Template renders,
	 * keyed by Broadcast Graphic id. A Graphic Input with no value here renders
	 * nothing, never its authored default.
	 */
	inputValues?: Readonly<Record<string, Readonly<Record<string, GraphicInputValue>>>>;
	/** Current correlated values for every Social Profile Projection on program. */
	socialProfileValues?: Readonly<Record<string, SocialProfileProjectionValues>>;
	/** Sampled synchronized Presentation Group frames, keyed by graphic and projection. */
	socialProfilePresentations?: Readonly<Record<string, Readonly<Record<string, SocialProfilePresentationProjection>>>>;
	/** Correlated Social Profile values an update phase is transitioning away from. */
	outgoingSocialProfileValues?: Readonly<Record<string, SocialProfileProjectionValues>>;
	/**
	 * The rendering each updating Broadcast Graphic is transitioning away from.
	 *
	 * Needed alongside `inputValues` because an update cross-transitions two
	 * renderings, and both have to come from the authoritative snapshot for an output
	 * that joins mid-update to draw the transition rather than cut.
	 */
	outgoingInputValues?: Readonly<Record<string, Readonly<Record<string, GraphicInputValue>>>>;
	/**
	 * Render authored defaults for unset Graphic Inputs. An editor preview does, so an
	 * author sees the design as authored; a live Screen Output never does.
	 */
	substituteAuthoredDefaults?: boolean;
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
	/**
	 * Why the same resolver expects one pinned revision to be refused, so a clip a
	 * Media Graphic Item's recorded compatibility says is playable but the
	 * authoritative side will not deliver is reported rather than drawn blank (#184).
	 */
	graphicAssetContentRefusal?: (
		reference: GraphicAssetReference,
	) => GraphicMediaIncompatibilityCode | undefined;
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
		socialProfileValues: input.socialProfileValues,
		socialProfilePresentations: input.socialProfilePresentations,
		outgoingSocialProfileValues: input.outgoingSocialProfileValues,
		outgoingInputValues: input.outgoingInputValues,
		substituteAuthoredDefaults: input.substituteAuthoredDefaults,
		itemGuides: input.itemGuides,
		safeAreaGuides: input.safeAreaGuides,
		selectedTarget: input.selectedTarget,
		graphicAssetContentUrl: input.graphicAssetContentUrl,
		graphicAssetContentRefusal: input.graphicAssetContentRefusal,
	});
}
