import type { BroadcastGraphicConfig } from '../../types/graphics';
import type { BroadcastGraphicsModeConfig } from '../../types/screenConfig';
import type { ScreenGraphicAssetReference } from '../../utils/graphicsAssetReferences';
import type { GraphicInputValues } from './inputs';
import type { BroadcastGraphicsLiveState } from './playout';
import {
	BROADCAST_GRAPHICS_LIVE_SESSION_SLOT_PREFIX,
	mediaScreenGraphicAssetReference,
} from '../../utils/graphicsAssetReferences';
import { isMediaGraphicInputValue } from '../graphics';
import { broadcastGraphicInputsState } from './inputs';

/**
 * One Broadcast Graphic's media Graphic Input values, whichever set they came from.
 *
 * Read through the Screen's current declarations rather than straight out of the
 * value map, because only the declaration says which keys are media and what kind
 * each one is — and because a declaration removed by a later authored write leaves
 * its value behind, while a Screen publishes what it declares.
 */
function appendGraphicInputMediaReferences(
	references: ScreenGraphicAssetReference[],
	graphic: Pick<BroadcastGraphicConfig, 'id' | 'inputs'>,
	values: GraphicInputValues | undefined,
	slotSuffix = '',
) {
	if (!values)
		return;

	for (const declaration of graphic.inputs ?? []) {
		if (declaration.type !== 'media')
			continue;
		const value = values[declaration.key];
		if (!isMediaGraphicInputValue(value))
			continue;
		references.push(mediaScreenGraphicAssetReference(
			value,
			declaration.mediaKind,
			`${BROADCAST_GRAPHICS_LIVE_SESSION_SLOT_PREFIX}${graphic.id}.inputs.${declaration.key}${slotSuffix}`,
		));
	}
}

/**
 * Every Graphic Asset Revision a Broadcast Graphics Live Session publishes.
 *
 * A media Graphic Input value an operator chooses at runtime is not in `modeConfigs`,
 * so a Screen Output Asset Capability derived from authored configuration alone
 * cannot resolve it: the graphic reaches air and its media does not (#96). The Live
 * Session is the second place a Screen publishes from, and this is what it publishes.
 *
 * ## Only accepted values, and why that is the whole rule
 *
 * The accepted set is what an on-air Broadcast Graphic renders, and it is the set a
 * Take composes from. A working value is an edit in progress and an override masks a
 * binding without being accepted; publishing either would let an output fetch media
 * that is not on air, which is the library-browsing hole the capability exists to
 * close. Equally, a revision an acceptance replaced leaves the set in the same
 * moment — so it stops being resolvable exactly when it stops being on air.
 *
 * Values are read through the Screen's current declarations rather than straight out
 * of live state. A declaration removed by a later authored write leaves its accepted
 * value behind, and a Screen publishes what it declares.
 *
 * ## Why the value has to carry its own compatibility facts
 *
 * The reference index compares a silent-video reference against the pinned revision's
 * own target compatibility, and a value carrying no such fact loses that precondition
 * rather than failing it. Nothing downstream can go and ask the Graphics Asset
 * Library, so the fact is recorded on the value at the moment of selection and
 * travels with it from there — exactly as a Media Graphic Item's does.
 */
export function broadcastGraphicsLiveSessionGraphicAssetReferences(
	config: BroadcastGraphicsModeConfig,
	state: Pick<BroadcastGraphicsLiveState, 'inputs'>,
): ScreenGraphicAssetReference[] {
	const references: ScreenGraphicAssetReference[] = [];

	for (const graphic of config.graphics) {
		appendGraphicInputMediaReferences(
			references,
			graphic,
			broadcastGraphicInputsState(state, graphic.id).accepted,
		);
	}

	return references;
}

/**
 * What `renderedInputValues` answers with: the values each Broadcast Graphic is
 * drawing now, and the ones an update phase is cross-transitioning away from.
 */
export interface BroadcastGraphicsRenderedInputValues {
	current: Record<string, GraphicInputValues>;
	outgoing?: Record<string, GraphicInputValues>;
}

/**
 * Every Graphic Asset Revision a Broadcast Graphics Screen's outputs are *rendering*
 * from its Live Session, at one instant.
 *
 * The sibling above answers what the Screen publishes, which is what a Screen Output
 * Asset Capability resolves and therefore what the authoritative reference index is
 * built from. This one answers a different question, and it is a client's question:
 * given the rendering the compositor is producing right now, is there any media in it
 * that an output without a capability would be failing to draw?
 *
 * Kept apart from the authored walk in `graphicsAssetReferences.ts` on purpose — that
 * one deliberately excludes runtime-chosen values, because a value an operator picks
 * live is not authored configuration and does not travel with it. Widening it would
 * make a Graphic Input default and a live acceptance indistinguishable to every caller
 * that walks configuration, which is the whole basis of the two-namespace split.
 *
 * `outgoing` is walked as well as `current`, under its own slot so the two can never
 * collide. Both renderings are on program during an update cross-transition, so an
 * output that cannot resolve media is losing both; and the case that only `outgoing`
 * catches is real — a media Graphic Input updated to no value at all still has its old
 * media on screen for the length of the update.
 *
 * Not an index source, and the `.outgoing` slot is the reason to say so out loud: what
 * a Screen Output may resolve is what the Screen *publishes*, which the sibling above
 * decides, and a superseded rendering leaves that set the moment its replacement is
 * accepted. This walk is read for what it finds, never written.
 */
export function broadcastGraphicsRenderedInputGraphicAssetReferences(
	graphics: readonly Pick<BroadcastGraphicConfig, 'id' | 'inputs'>[],
	rendered: BroadcastGraphicsRenderedInputValues,
): ScreenGraphicAssetReference[] {
	const references: ScreenGraphicAssetReference[] = [];

	for (const graphic of graphics) {
		appendGraphicInputMediaReferences(references, graphic, rendered.current[graphic.id]);
		appendGraphicInputMediaReferences(references, graphic, rendered.outgoing?.[graphic.id], '.outgoing');
	}

	return references;
}
