import type {
	GraphicFontSelection,
	GraphicGroupChildConfig,
	GraphicInputDeclaration,
	GraphicItemConfig,
	MediaGraphicInputValue,
} from '../types/graphics';
import type { GraphicAssetReference } from '../types/graphicsAsset';
import type {
	BackgroundModeConfig,
	BroadcastGraphicsModeConfig,
	FeatureMatchLayoutConfig,
	FeatureMatchOverlayModeConfig,
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

/**
 * One media Graphic Asset Reference, wherever the choice was made.
 *
 * A Media Graphic Item's content, a media Graphic Input's authored default, and a
 * value an operator picks live are the same kind of thing indexed the same way, so
 * the facts that travel with them are assembled once here rather than three times.
 *
 * A silent-video reference carries the pinned revision's own target compatibility,
 * which the reference index checks it against, and an authored target of Chromium.
 * That assumption is shared by both hosts on purpose: a graphics Screen Output is
 * consumed as a browser source in Chromium-based capture, which is what makes VP9
 * alpha usable at all, and neither host has a control that would let an author say
 * otherwise. An image carries neither fact, because it has no target compatibility
 * to check.
 */
export function mediaScreenGraphicAssetReference(
	value: MediaGraphicInputValue,
	kind: 'image' | 'silent-video',
	ownerSlot: string,
): ScreenGraphicAssetReference {
	return {
		reference: { assetId: value.assetId, revisionId: value.revisionId },
		ownerSlot,
		kind,
		...(kind === 'silent-video'
			? { videoCompatibility: value.videoCompatibility, videoTarget: 'chromium' as const }
			: {}),
	};
}

export function sameGraphicAssetReference(
	left: GraphicAssetReference | undefined,
	right: GraphicAssetReference | undefined,
): boolean {
	return left?.assetId === right?.assetId
		&& left?.revisionId === right?.revisionId;
}

/**
 * Every font Graphic Asset Revision one Graphic Item's typography pins.
 *
 * Two places name a font on one item, and both are collected: the item's base
 * typography, and each Graphic Placeholder Style that overrides it for one
 * `{inputKey}`. The placeholder's key is in its own slot rather than folded into
 * the item's, so a Missing Graphic Asset Reference points at the run an author has
 * to go and repair.
 *
 * Asked structurally rather than by kind. Four Graphic Item kinds carry typography
 * today — Text, Clock, Player Life, and Game Wins — and a fifth that carried it
 * without appearing in a hand-written list would paint a library font its Screen
 * Output was never given a capability for, which is a blank line on air rather
 * than an error anyone sees.
 */
function appendGraphicFontReferences(
	references: ScreenGraphicAssetReference[],
	item: GraphicItemConfig | GraphicGroupChildConfig,
	ownerSlot: string,
) {
	function append(font: GraphicFontSelection | undefined, slot: string) {
		if (font?.kind !== 'asset')
			return;
		references.push({ reference: font.reference, ownerSlot: slot, kind: 'font' });
	}

	if ('typography' in item)
		append(item.typography.font, `${ownerSlot}.typography.font`);
	if (!('placeholderStyles' in item))
		return;
	for (const [key, style] of Object.entries(item.placeholderStyles ?? {}))
		append(style.font, `${ownerSlot}.placeholderStyles.${key}.font`);
}

/**
 * Every Graphic Asset Revision one shared Graphic Item tree pins.
 *
 * Two sources: a Media Graphic Item's content, and a font Graphic Asset Revision
 * named by any item's typography or Graphic Placeholder Style. Slots are built
 * from ids rather than list positions, so a reorder does not read as a set of
 * changed references.
 *
 * A silent-video reference carries the pinned revision's own target compatibility,
 * which the reference index checks it against, and an authored target of Chromium.
 * That assumption is shared by both hosts on purpose: a graphics Screen Output is
 * consumed as a browser source in Chromium-based capture, which is what makes VP9
 * alpha usable at all, and neither host has a control that would let an author say
 * otherwise. An output opened in another engine reports the incompatibility rather
 * than silently showing nothing.
 *
 * A font reference carries no video facts, because a font has no target
 * compatibility to check and nothing in the delivery path treats it differently
 * from any other pinned revision.
 */
function appendSharedGraphicItemReferences(
	references: ScreenGraphicAssetReference[],
	items: readonly GraphicItemConfig[],
	slotPrefix: string,
) {
	function append(item: GraphicItemConfig | GraphicGroupChildConfig, ownerSlot: string) {
		appendGraphicFontReferences(references, item, ownerSlot);
		if (item.type !== 'media' || !item.asset)
			return;
		references.push(mediaScreenGraphicAssetReference(
			{ ...item.asset, videoCompatibility: item.videoCompatibility },
			item.mediaKind,
			`${ownerSlot}.asset`,
		));
	}

	for (const item of items) {
		const slot = `${slotPrefix}.${item.id}`;
		append(item, slot);
		if (item.type !== 'group')
			continue;
		for (const child of item.children)
			append(child, `${slot}.children.${child.id}`);
	}
}

/**
 * Every Graphic Asset Revision one Broadcast Graphic's declared Graphic Inputs pin.
 *
 * Only a media Graphic Input can pin one, and only through its authored default: the
 * default travels with the configuration, so it is discovered here exactly as a
 * Media Graphic Item's content is. A value an operator picks at runtime is not
 * authored configuration at all and is published from the Broadcast Graphics Live
 * Session instead.
 *
 * Without this, an asset reached only through an input default is unindexed on every
 * path — invisible to the Screen Output Asset Capability, so the live output cannot
 * fetch it, and invisible as usage, so nothing stops it being retired or purged out
 * from under the graphic that depends on it.
 */
function appendGraphicInputReferences(
	references: ScreenGraphicAssetReference[],
	inputs: readonly GraphicInputDeclaration[] | undefined,
	slotPrefix: string,
) {
	for (const declaration of inputs ?? []) {
		if (declaration.type !== 'media' || !declaration.default)
			continue;
		references.push(mediaScreenGraphicAssetReference(
			declaration.default,
			declaration.mediaKind,
			`${slotPrefix}.${declaration.key}.default`,
		));
	}
}

/**
 * Every Graphic Asset Revision one Feature Match Layout pins.
 *
 * Two sources, and only two: the Frame's background image, which is host-owned
 * capability outside the shared vocabulary, and the shared item tree — its Media
 * Graphic Items' content and its typography's library fonts. Source Items pin
 * nothing: they frame an external video source rather than carrying content, and
 * their framing style is host-owned and carries no typography at all.
 *
 * Discovery takes the layout rather than the Screen configuration around it,
 * because a layout is what pins assets and a layout is what travels: a Feature
 * Match Layout Template stores one with no Screen anywhere near it, and its
 * references have to be the same references the Screen holding the same layout
 * publishes. Slots keep the `layout.` prefix either way. That prefix is
 * load-bearing: a write scopes its reference delete to it, and a Screen Output
 * resolves only the prefix for its Screen's current mode, so a tree publishing
 * outside it would have its references orphaned by the next write.
 */
export function featureMatchLayoutGraphicAssetReferences(
	layout: FeatureMatchLayoutConfig,
): ScreenGraphicAssetReference[] {
	const references: ScreenGraphicAssetReference[] = [];
	if (layout.frame.backgroundImage) {
		references.push({
			reference: layout.frame.backgroundImage,
			ownerSlot: 'layout.frame.backgroundImage',
			kind: 'image',
		});
	}
	appendSharedGraphicItemReferences(references, layout.composition.items, 'layout.composition.items');
	appendGraphicInputReferences(references, layout.composition.inputs, 'layout.composition.inputs');

	return references;
}

/** Every Graphic Asset Revision a Feature Match Overlay Screen publishes. */
export function featureMatchOverlayGraphicAssetReferences(
	config: FeatureMatchOverlayModeConfig,
): ScreenGraphicAssetReference[] {
	return featureMatchLayoutGraphicAssetReferences(config.layout);
}

/**
 * Every exact Graphic Asset Revision a Broadcast Graphics Screen publishes.
 *
 * This is what the Screen's reference index is built from, and so what its Screen
 * Output Asset Capability will resolve: an output can reach exactly these
 * revisions and nothing else in the Graphics Asset Library.
 *
 * The owner slot names the item that pins the reference, so a Missing Graphic
 * Asset Reference is reported against the Graphic Item an author can go and
 * repair rather than against the Screen as a whole. Slots are stable across a
 * reorder, because they are built from ids rather than list positions — a
 * reordered stack must not read as a set of changed references.
 *
 * A silent-video reference carries the pinned revision's own target
 * compatibility, which the reference index checks it against, and an authored
 * target of Chromium. Broadcast Graphics Screen Outputs are consumed as browser
 * sources in Chromium-based capture, which is what makes VP9 alpha usable here at
 * all; an output opened in another engine reports the incompatibility rather than
 * silently showing nothing.
 */
export function broadcastGraphicsGraphicAssetReferences(
	config: BroadcastGraphicsModeConfig,
): ScreenGraphicAssetReference[] {
	const references: ScreenGraphicAssetReference[] = [];

	for (const graphic of config.graphics) {
		appendSharedGraphicItemReferences(references, graphic.items, `graphics.${graphic.id}.items`);
		appendGraphicInputReferences(references, graphic.inputs, `graphics.${graphic.id}.inputs`);
	}

	return references;
}

/**
 * Every Graphic Asset Revision a Background Screen's layer stack pins.
 *
 * Only an asset-sourced image or video layer pins one; colour, gradient,
 * animation, and URL-sourced layers carry no library reference. A disabled
 * layer still publishes — disabled is a display state, not a removal, so the
 * pinned revision must stay resolvable for the re-enable, exactly as a hidden
 * Media Graphic Item's does. Slots are built from layer ids rather than stack
 * positions, so a reorder does not read as a set of changed references.
 */
export function backgroundGraphicAssetReferences(
	config: BackgroundModeConfig,
): ScreenGraphicAssetReference[] {
	const references: ScreenGraphicAssetReference[] = [];

	for (const layer of config.layers) {
		if (layer.type !== 'image' && layer.type !== 'video')
			continue;
		if (layer.source.kind !== 'asset')
			continue;
		references.push(mediaScreenGraphicAssetReference(
			{
				assetId: layer.source.assetId,
				revisionId: layer.source.revisionId,
				...(layer.source.videoCompatibility !== undefined
					? { videoCompatibility: layer.source.videoCompatibility }
					: {}),
			},
			layer.type === 'video' ? 'silent-video' : 'image',
			`layers.${layer.id}.source`,
		));
	}

	return references;
}

/**
 * The Screen Modes whose configuration publishes Graphic Asset References.
 *
 * Every other mode publishes none, so its configuration writes go through the
 * ordinary versioned write. A mode listed here writes its configuration and its
 * reference index in one atomic operation instead.
 */
export const GRAPHIC_ASSET_REFERENCING_SCREEN_MODES = ['feature-match-overlay', 'broadcast-graphics', 'background'] as const;

export type GraphicAssetReferencingScreenMode = typeof GRAPHIC_ASSET_REFERENCING_SCREEN_MODES[number];

export function isGraphicAssetReferencingScreenMode(mode: string): mode is GraphicAssetReferencingScreenMode {
	return (GRAPHIC_ASSET_REFERENCING_SCREEN_MODES as readonly string[]).includes(mode);
}

/**
 * The owner-slot namespace each referencing Screen Mode writes into.
 *
 * One Screen may hold a configuration for every mode at once, so its reference
 * index holds every mode's references at once too. The owner slot is what keeps
 * them apart: each mode's slots are rooted at the top-level configuration field
 * its references are discovered from, so the prefix identifies which mode
 * published a row without a column to store it.
 *
 * That makes this map load-bearing rather than descriptive. A write scopes its
 * delete to its own prefix so it cannot clear another mode's rows, and a Screen
 * Output resolves only the prefix belonging to the Screen's current mode. A slot
 * that escaped its prefix would silently break both, which is why
 * `broadcastGraphicsAssetReferences.test.ts` asserts every discovered slot
 * against it.
 */
export const GRAPHIC_ASSET_REFERENCE_SLOT_PREFIXES = {
	'feature-match-overlay': 'layout.',
	'broadcast-graphics': 'graphics.',
	'background': 'layers.',
} as const satisfies Record<GraphicAssetReferencingScreenMode, string>;

export function graphicAssetReferenceSlotPrefix(mode: GraphicAssetReferencingScreenMode): string {
	return GRAPHIC_ASSET_REFERENCE_SLOT_PREFIXES[mode];
}

/**
 * The owner-slot namespace a Broadcast Graphics Live Session's accepted media
 * Graphic Input values write into.
 *
 * Deliberately outside `graphics.`, which is authored configuration's. The two are
 * written by different authorities on different occasions — a configuration write
 * clears and rewrites its whole namespace, and acceptance clears and rewrites this
 * one — so sharing a prefix would mean each write silently deleting the other's
 * rows, leaving media the Screen is still publishing unresolvable to its outputs.
 */
export const BROADCAST_GRAPHICS_LIVE_SESSION_SLOT_PREFIX = 'liveSession.';

/**
 * Every owner-slot namespace a Screen Output in one mode may resolve.
 *
 * A Screen Output resolves exactly what its Screen currently publishes, and for
 * Broadcast Graphics that is published from two places: the authored stack, and the
 * Live Session's accepted media Graphic Input values. Both are on air, so both are
 * resolvable — while a Screen switched away from the mode resolves neither.
 */
export function screenOutputResolvableSlotPrefixes(
	mode: GraphicAssetReferencingScreenMode,
): readonly string[] {
	return mode === 'broadcast-graphics'
		? [GRAPHIC_ASSET_REFERENCE_SLOT_PREFIXES[mode], BROADCAST_GRAPHICS_LIVE_SESSION_SLOT_PREFIX]
		: [GRAPHIC_ASSET_REFERENCE_SLOT_PREFIXES[mode]];
}

export interface GraphicAssetReferencingScreenModeConfigs {
	'feature-match-overlay'?: FeatureMatchOverlayModeConfig;
	'broadcast-graphics'?: BroadcastGraphicsModeConfig;
	'background'?: BackgroundModeConfig;
}

/**
 * The references one Screen Mode's configuration publishes, whichever mode it is.
 *
 * One dispatcher rather than a branch at each call site: the write path, the
 * create-path rejection, and the publication-eligibility check all need the same
 * answer, and a mode added to the list above must reach every one of them or a
 * Screen Output would resolve content nothing indexed.
 *
 * Exhaustive by construction: a mode added to the list without a branch here
 * fails to compile rather than quietly reading another mode's configuration.
 */
export function screenModeGraphicAssetReferences(
	mode: GraphicAssetReferencingScreenMode,
	modeConfigs: GraphicAssetReferencingScreenModeConfigs | null | undefined,
): ScreenGraphicAssetReference[] {
	switch (mode) {
		case 'feature-match-overlay': {
			const config = modeConfigs?.['feature-match-overlay'];
			return config ? featureMatchOverlayGraphicAssetReferences(config) : [];
		}
		case 'broadcast-graphics': {
			const config = modeConfigs?.['broadcast-graphics'];
			return config ? broadcastGraphicsGraphicAssetReferences(config) : [];
		}
		case 'background': {
			const config = modeConfigs?.background;
			return config ? backgroundGraphicAssetReferences(config) : [];
		}
		default: {
			const unreachable: never = mode;
			return unreachable;
		}
	}
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

export function screenOutputAssetCapabilityCookieName(screenId: number): string {
	return `screen-output-asset-capability-${screenId}`;
}

export function screenOutputAssetCapabilityCookiePath(screenId: number): string {
	return `/api/screen-output/screens/${screenId}/`;
}

export function screenOutputAssetCapabilitySessionPath(screenId: number): string {
	return `${screenOutputAssetCapabilityCookiePath(screenId)}asset-capability-session`;
}

export function graphicAssetRevisionStatusPath(reference: GraphicAssetReference): string {
	return `/api/graphics-assets/${encodeURIComponent(reference.assetId)}/revisions/${encodeURIComponent(reference.revisionId)}/status`;
}
