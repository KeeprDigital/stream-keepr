import type { GraphicInputValue, MediaGraphicInputValue } from '../../types/graphics';
import type { BroadcastGraphicsModeConfig } from '../../types/screenConfig';
import type { ScreenGraphicAssetReference } from '../../utils/graphicsAssetReferences';
import type { BroadcastGraphicsLiveState } from './playout';
import {
	BROADCAST_GRAPHICS_LIVE_SESSION_SLOT_PREFIX,
	mediaScreenGraphicAssetReference,
} from '../../utils/graphicsAssetReferences';
import { broadcastGraphicInputsState } from './inputs';

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
		const accepted = broadcastGraphicInputsState(state, graphic.id).accepted;
		for (const declaration of graphic.inputs ?? []) {
			if (declaration.type !== 'media')
				continue;
			const value = accepted[declaration.key];
			if (!isMediaGraphicInputValue(value))
				continue;
			references.push(mediaScreenGraphicAssetReference(
				value,
				declaration.mediaKind,
				`${BROADCAST_GRAPHICS_LIVE_SESSION_SLOT_PREFIX}${graphic.id}.inputs.${declaration.key}`,
			));
		}
	}

	return references;
}

/**
 * Whether an accepted value is a media value at all.
 *
 * Asked of the stored value rather than assumed from the declaration: a Graphic Input
 * stores what the operator entered even when it violates its declared type, so a
 * media input may legitimately be holding something that is not a reference.
 */
function isMediaGraphicInputValue(value: GraphicInputValue | undefined): value is MediaGraphicInputValue {
	return typeof value === 'object'
		&& value !== null
		&& typeof value.assetId === 'string'
		&& typeof value.revisionId === 'string';
}
