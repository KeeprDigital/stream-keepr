import type { GraphicInputValue } from '~~/shared/types/graphics';
import type { GraphicAssetReference } from '~~/shared/types/graphicsAsset';
import type { FeatureMatchLayoutConfig, ScreenOutput } from '~~/shared/types/screenConfig';
import type { GraphicMediaIncompatibilityCode, GraphicsAnimationProjection, GraphicsCompositionRenderModel, GraphicsFeatureMatchContext } from '~/modules/graphics/renderModel';
import type { GraphicsSelectionTarget } from '~/modules/graphics/selection';
import { FEATURE_MATCH_LAYOUT_COMPOSITION_ID, featureMatchLayoutStack } from '~~/shared/featureMatchLayoutComposition';
import {
	featureMatchTokenDeclarations,
	featureMatchTokenPresentations,
} from '~~/shared/featureMatchTokenCatalogue';
import { resolveGraphicsCompositionRenderModel } from '~/modules/graphics/renderModel';

/**
 * Feature Match Overlay compositor render-model seam.
 *
 * The host adapter for the shared compositor, and the mirror of the Broadcast
 * Graphics one. It translates a Feature Match Layout's shared item tree into the
 * stack of one the shared model composes, and supplies the two things a Feature
 * Match host has that a Broadcast Graphics host does not: a fixed token catalogue
 * standing in for declared Graphic Inputs, and the live session state the
 * context-gated Definitions read.
 *
 * What it deliberately does not translate is the Frame and the Source Items. They
 * are host-owned, rendered beneath and around this model's output by the Display
 * component rather than composed into it — the Host Contract's rule that capability
 * outside the contract stays with the host, applied to the two pieces of a Feature
 * Match Layout that have no shared vocabulary.
 *
 * There is no playout here, and no field for one. Every composition is always
 * composed: a Feature Match Overlay has no stack, no Graphic Channels, and no Take
 * or Out, so unlike `onAirGraphicIds` there is nothing to select and no empty set
 * to mean "nothing on air".
 */

export interface FeatureMatchOverlayCompositorRenderModelInput {
	output: ScreenOutput;
	canvasWidth: number;
	canvasHeight: number;
	/** The Feature Match Layout whose shared item tree composes. */
	layout: Pick<FeatureMatchLayoutConfig, 'composition'>;
	/**
	 * The Feature Match token binding catalogue's resolved values. An omitted map
	 * renders every placeholder empty, which is what a Feature Match Overlay whose
	 * Slot holds no Match should look like.
	 */
	tokenValues?: Readonly<Record<string, GraphicInputValue>>;
	/** The live session state the Clock, Player Life, and Game Wins Items read. */
	featureMatch?: GraphicsFeatureMatchContext;
	/**
	 * Per-item lifecycle projections, keyed by Graphic Item id — the per-item
	 * phase trigger (#492), driven by the host watching the `sideboardRevealed`
	 * edge. Keyed by item id alone because a Feature Match Overlay has exactly one
	 * composition; the adapter nests the map under its stable id the same way it
	 * nests the token values.
	 */
	itemAnimation?: Readonly<Record<string, readonly GraphicsAnimationProjection[]>>;
	/** Editor-only item guides and selection highlighting. */
	itemGuides?: boolean;
	/** Editor-only advisory action-safe and title-safe guides. */
	safeAreaGuides?: boolean;
	selectedTarget?: GraphicsSelectionTarget;
	/**
	 * Resolves a Media Graphic Item's pinned Graphic Asset Revision to a URL this
	 * output may load, backed by the Screen Output Asset Capability on a live output
	 * and by ordinary authoring access in the editor.
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

export type FeatureMatchOverlayCompositorRenderModel = GraphicsCompositionRenderModel;

export function resolveFeatureMatchOverlayCompositorRenderModel(
	input: FeatureMatchOverlayCompositorRenderModelInput,
): FeatureMatchOverlayCompositorRenderModel {
	return resolveGraphicsCompositionRenderModel({
		output: input.output,
		canvasWidth: input.canvasWidth,
		canvasHeight: input.canvasHeight,
		graphics: featureMatchLayoutStack(input.layout),
		// One layer inside a canvas this host already paints, mounted above the Frame
		// and the Source Items. It must paint no backdrop of its own: a Fill or Key
		// Output's black would cover the entire host-owned layer.
		canvasRole: 'layer',
		// Deliberately no `visibleGraphicIds`: the one composition is always composed.
		textDeclarations: featureMatchTokenDeclarations(),
		textTokenPresentations: featureMatchTokenPresentations(),
		inputValues: input.tokenValues
			? { [FEATURE_MATCH_LAYOUT_COMPOSITION_ID]: input.tokenValues }
			: undefined,
		itemAnimation: input.itemAnimation
			? { [FEATURE_MATCH_LAYOUT_COMPOSITION_ID]: input.itemAnimation }
			: undefined,
		featureMatch: input.featureMatch,
		itemGuides: input.itemGuides,
		safeAreaGuides: input.safeAreaGuides,
		selectedTarget: input.selectedTarget,
		graphicAssetContentUrl: input.graphicAssetContentUrl,
		graphicAssetContentRefusal: input.graphicAssetContentRefusal,
	});
}
