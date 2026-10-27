import type { BackgroundLayersCapableMode } from '../screenModes';
import type {
	GraphicFontSelection,
	GraphicGroupChildConfig,
	GraphicInputDeclaration,
	GraphicItemConfig,
} from '../types/graphics';
import type { GraphicAssetReference } from '../types/graphicsAsset';
import type {
	BackgroundLayer,
	BackgroundLayersModeConfig,
	BackgroundModeConfig,
	BroadcastGraphicsModeConfig,
	FeatureMatchLayoutConfig,
	FeatureMatchOverlayModeConfig,
	ScreenMediaSource,
} from '../types/screenConfig';
import { BACKGROUND_LAYERS_CAPABLE_MODES } from '../screenModes';
import { resolveScreenModeConfig } from '../types/screenConfig';

/**
 * The reference owners that are saved, revisable graphics Templates: the two
 * authored template libraries. A Graphic Asset either references cannot be
 * retired (ADR-0034), because every template write requires its references to
 * stay selectable. An Installed Graphics Template is not one: it is never revised
 * and cannot be deleted, so counting it would make its assets unretirable for good.
 */
export const GRAPHICS_TEMPLATE_REFERENCE_OWNER_KINDS = [
	'broadcast-graphic-template',
	'feature-match-layout-template',
] as const;

export function isGraphicsTemplateReferenceOwnerKind(
	kind: string,
): kind is typeof GRAPHICS_TEMPLATE_REFERENCE_OWNER_KINDS[number] {
	return (GRAPHICS_TEMPLATE_REFERENCE_OWNER_KINDS as readonly string[]).includes(kind);
}

export interface ScreenGraphicAssetReference {
	reference: GraphicAssetReference;
	ownerSlot: string;
	kind: 'image' | 'silent-video' | 'font';
}

/**
 * One media Graphic Asset Reference, wherever the choice was made.
 *
 * A Media Graphic Item's content, a media Graphic Input's authored default, and a
 * value an operator picks live are the same kind of thing indexed the same way, so
 * the facts that travel with them are assembled once here rather than three times.
 *
 * Nothing about playback engines travels with it: Chromium is the only supported
 * engine for transparent video (ADR-0020), so there is no compatibility to check.
 */
export function mediaScreenGraphicAssetReference(
	value: GraphicAssetReference,
	kind: 'image' | 'silent-video',
	ownerSlot: string,
): ScreenGraphicAssetReference {
	return {
		reference: { assetId: value.assetId, revisionId: value.revisionId },
		ownerSlot,
		kind,
	};
}

/**
 * The exact revision a Screen Media Source pins, or null for a Remote Media URL,
 * which is a remote dependency and never a Graphic Asset Reference (ADR-0021).
 */
export function screenMediaSourceReference(source: ScreenMediaSource | undefined): GraphicAssetReference | null {
	return source?.kind === 'asset'
		? { assetId: source.assetId, revisionId: source.revisionId }
		: null;
}

function appendScreenMediaSourceReference(
	references: ScreenGraphicAssetReference[],
	source: ScreenMediaSource | undefined,
	kind: 'image' | 'silent-video',
	ownerSlot: string,
) {
	const reference = screenMediaSourceReference(source);
	if (reference)
		references.push(mediaScreenGraphicAssetReference(reference, kind, ownerSlot));
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
 * Every reference is the exact revision and its kind, nothing more: Chromium is the
 * only supported engine for transparent video (ADR-0020), so no playback fact
 * travels with a silent video, and a font is delivered like any other pinned
 * revision.
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
			item.asset,
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
 * Two sources, and only two: the Frame's own image and video, which are
 * host-owned Screen Media Sources outside the shared vocabulary and publish only
 * when library-sourced (ADR-0021), and the shared item tree — its Media
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
	// A disabled Frame video still publishes, as a disabled Background Layer does.
	appendScreenMediaSourceReference(references, layout.frame.backgroundImage, 'image', 'layout.frame.backgroundImage');
	appendScreenMediaSourceReference(references, layout.frame.mediaBackground?.source, 'silent-video', 'layout.frame.mediaBackground.source');
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
	return backgroundLayerStackGraphicAssetReferences(config.layers, 'layers');
}

/**
 * Every Graphic Asset Revision a plain overlay mode's own Background Layer stack
 * pins (#580), by the same rules as the Background Screen's.
 *
 * Every plain mode names its stack `backgroundLayers`, so the slot is rooted at
 * the mode as well as the field: a slot namespace shared between modes would let
 * one mode's write clear another's rows.
 */
export function plainModeBackgroundLayerGraphicAssetReferences(
	mode: BackgroundLayersCapableMode,
	config: BackgroundLayersModeConfig | undefined,
): ScreenGraphicAssetReference[] {
	return backgroundLayerStackGraphicAssetReferences(config?.backgroundLayers, `${mode}.backgroundLayers`);
}

function backgroundLayerStackGraphicAssetReferences(
	layers: readonly BackgroundLayer[] | undefined,
	slotRoot: string,
): ScreenGraphicAssetReference[] {
	const references: ScreenGraphicAssetReference[] = [];

	// A stored configuration is legitimately partial — PATCH writes fragments —
	// so a config with no stack yet publishes nothing rather than throwing.
	for (const layer of layers ?? []) {
		if (layer.type !== 'image' && layer.type !== 'video')
			continue;
		appendScreenMediaSourceReference(
			references,
			layer.source,
			layer.type === 'video'
				? 'silent-video'
				: 'image',
			`${slotRoot}.${layer.id}.source`,
		);
	}

	return references;
}

/**
 * The Screen Modes whose configuration publishes Graphic Asset References.
 *
 * Every other mode publishes none, so its configuration writes go through the
 * ordinary versioned write. A mode listed here writes its configuration and its
 * reference index in one atomic operation instead.
 *
 * Two kinds of member: the modes whose own content pins assets, named here, and
 * every mode whose Screen Mode Definition declares a Background Layer stack,
 * which joins by that declaration alone rather than by being listed twice.
 */
export const GRAPHIC_ASSET_REFERENCING_SCREEN_MODES = [
	'feature-match-overlay',
	'broadcast-graphics',
	'background',
	...BACKGROUND_LAYERS_CAPABLE_MODES,
] as const;

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
 * its references are discovered from — and, for the plain modes, which all name
 * that field `backgroundLayers`, at the mode first — so the prefix identifies
 * which mode published a row without a column to store it.
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
	...Object.fromEntries(BACKGROUND_LAYERS_CAPABLE_MODES.map(mode => [mode, `${mode}.backgroundLayers.`])) as {
		[M in BackgroundLayersCapableMode]: `${M}.backgroundLayers.`;
	},
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
 * The owner-slot namespace a Screen's Screen Theme Overrides index into, beside
 * its modes' own (ADR-0050). No mode's namespace covers it: a Screen Output
 * resolves it only through the Screen's resolved tokens, and a Graphic Asset
 * referenced from it cannot be retired.
 */
export const SCREEN_THEME_OVERRIDE_SLOT_PREFIX = 'themeOverrides.';

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

/** Stored mode configurations, as the write path holds them: each one a fragment. */
export type GraphicAssetReferencingScreenModeConfigs = {
	'feature-match-overlay'?: Partial<FeatureMatchOverlayModeConfig>;
	'broadcast-graphics'?: Partial<BroadcastGraphicsModeConfig>;
	'background'?: Partial<BackgroundModeConfig>;
} & {
	[Mode in BackgroundLayersCapableMode]?: Partial<BackgroundLayersModeConfig>;
};

/**
 * The references one Screen Mode's configuration publishes, whichever mode it is.
 *
 * One dispatcher rather than a branch at each call site: the write path, the
 * create-path rejection, and the publication-eligibility check all need the same
 * answer, and a mode added to the list above must reach every one of them or a
 * Screen Output would resolve content nothing indexed.
 *
 * Exhaustive by construction: every mode not branched on here is one whose
 * definition declares a Background Layer stack, and that stack is all it pins.
 *
 * A stored fragment is completed through `resolveScreenModeConfig`, the same
 * resolution a rendering of the mode reads, so a Screen is indexed for exactly
 * what it publishes. A Screen whose layout was never saved therefore publishes
 * its default layout, which pins nothing, rather than failing the save (#625).
 */
export function screenModeGraphicAssetReferences(
	mode: GraphicAssetReferencingScreenMode,
	modeConfigs: GraphicAssetReferencingScreenModeConfigs | null | undefined,
): ScreenGraphicAssetReference[] {
	switch (mode) {
		case 'feature-match-overlay':
			return featureMatchOverlayGraphicAssetReferences(resolveScreenModeConfig(modeConfigs, mode));
		case 'broadcast-graphics':
			return broadcastGraphicsGraphicAssetReferences(resolveScreenModeConfig(modeConfigs, mode));
		case 'background':
			return backgroundGraphicAssetReferences(resolveScreenModeConfig(modeConfigs, mode));
		default: {
			const declared: BackgroundLayersCapableMode = mode;
			return plainModeBackgroundLayerGraphicAssetReferences(declared, modeConfigs?.[declared]);
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
