import type { BroadcastGraphicConfig, GraphicGroupChildConfig, GraphicItemConfig } from '../types/graphics';
import type {
	BroadcastGraphicsModeConfig,
	FeatureMatchLayoutConfig,
} from '../types/screenConfig';
import type {
	TemplatePackageAssetRequirement,
	TemplatePackageCapabilityRequirement,
} from '../types/templatePackage';
import {
	FEATURE_MATCH_LAYOUT_FORMAT_VERSION,
	featureMatchLayoutVocabularyIdentity,
} from '../featureMatchLayoutVocabulary';
import {
	FEATURE_MATCH_SOURCE_ITEM_CONFIGURATION_VERSION,
	FEATURE_MATCH_SOURCE_ITEM_DEFINITION_ID,
} from '../featureMatchSourceItems';
import { isFeatureMatchTokenKey } from '../featureMatchTokenCatalogue';
import { getGraphicItemDefinition } from '../modules/graphics/itemDefinitions';
import { graphicTextTemplateInputKeys } from '../modules/graphics/textTemplate';
import {
	SOCIAL_PROFILE_PROJECTION_CAPABILITY_ID,
	SOCIAL_PROFILE_PROJECTION_CONFIGURATION_VERSION,
} from '../types/graphics';
import {
	broadcastGraphicsGraphicAssetReferences,
	featureMatchLayoutGraphicAssetReferences,
} from './graphicsAssetReferences';

/**
 * What each graphics template kind requires from a Template Package.
 *
 * Discovery stays with the vocabulary that owns the payload: a Broadcast Graphic
 * Template walks the Shared Graphics Foundation stack, and a Feature Match Layout
 * Template walks its own layout through its Graphic Item Definitions. Both hand
 * the same shaped requirements to the one Graphics Asset Library export contract,
 * which is what keeps their workflows separate but their packages identical in
 * envelope, asset handling, and integrity.
 */

export interface TemplatePackageRequirements {
	assets: TemplatePackageAssetRequirement[];
	capabilities: TemplatePackageCapabilityRequirement[];
}

/**
 * Application fonts travel as identifiers rather than as bytes, because they ship
 * with Stream Keepr — so a package *declares* one and a receiver missing it
 * refuses. Every graphics vocabulary spells the choice the same way, as a Graphic
 * Font Selection under `font`, so one walk finds them wherever a typography or a
 * Graphic Placeholder Style sits.
 *
 * The library arm is deliberately not declared here. A font Graphic Asset
 * Revision is content the package carries, and it is discovered by the same
 * `graphicsAssetReferences` walk a Media Graphic Item's content is — one
 * discovery for one kind of dependency, so a font is never declared as a
 * capability *and* embedded as an asset, or as neither.
 */
function appendApplicationFontCapabilities(
	capabilities: TemplatePackageCapabilityRequirement[],
	value: unknown,
	path: string,
	depth = 0,
): void {
	if (depth > 32 || typeof value !== 'object' || value === null)
		return;
	if (Array.isArray(value)) {
		value.forEach((item, index) => appendApplicationFontCapabilities(capabilities, item, `${path}[${index}]`, depth + 1));
		return;
	}
	for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
		const nestedPath = path ? `${path}.${key}` : key;
		if (key === 'font' && isApplicationFontSelection(nested)) {
			capabilities.push({
				slot: nestedPath,
				capability: 'application-font',
				identity: nested.fontId,
			});
			continue;
		}
		appendApplicationFontCapabilities(capabilities, nested, nestedPath, depth + 1);
	}
}

function isApplicationFontSelection(value: unknown): value is { kind: 'application'; fontId: string } {
	if (typeof value !== 'object' || value === null)
		return false;
	const selection = value as { kind?: unknown; fontId?: unknown };
	return selection.kind === 'application'
		&& typeof selection.fontId === 'string'
		&& selection.fontId.length > 0;
}

function appendBroadcastGraphicItemCapabilities(
	capabilities: TemplatePackageCapabilityRequirement[],
	item: GraphicItemConfig,
	slot: string,
): void {
	const definition = getGraphicItemDefinition(item.type);
	capabilities.push({
		slot: `${slot}.type`,
		capability: 'graphic-item-definition',
		identity: definition.kind,
		configurationVersion: definition.configurationVersion,
	});
	if (item.type !== 'group')
		return;
	// A Graphic Group's children are Graphic Items in their own right, so their
	// Definitions have to be declared too or a receiver could accept a package
	// holding a kind it cannot render.
	for (const child of item.children)
		appendBroadcastGraphicItemCapabilities(capabilities, child, `${slot}.children.${child.id}`);
}

/** A Broadcast Graphic Template's payload is one authored Broadcast Graphic. */
export function broadcastGraphicTemplatePackageRequirements(
	graphic: BroadcastGraphicConfig,
): TemplatePackageRequirements {
	const capabilities: TemplatePackageCapabilityRequirement[] = [];
	for (const item of graphic.items)
		appendBroadcastGraphicItemCapabilities(capabilities, item, `items.${item.id}`);
	for (const projection of graphic.socialProfileProjections ?? []) {
		capabilities.push({
			slot: `socialProfileProjections.${projection.key}`,
			capability: 'host-vocabulary',
			identity: SOCIAL_PROFILE_PROJECTION_CAPABILITY_ID,
			configurationVersion: SOCIAL_PROFILE_PROJECTION_CONFIGURATION_VERSION,
		});
	}
	appendApplicationFontCapabilities(capabilities, graphic.items, 'items');
	// Media Graphic Items pin exact revisions, and discovery is shared with the
	// Screen reference index rather than repeated here: a Template must package
	// exactly the revisions its Screen would publish, so a Media Graphic Item
	// added to one walk can never be missed by the other. Slots are renamed
	// relative to the graphic the package carries, as the layout side does.
	const graphicSlotPrefix = `graphics.${graphic.id}.`;
	const assets = broadcastGraphicsGraphicAssetReferences({ graphics: [graphic] } as BroadcastGraphicsModeConfig)
		.map(discovered => ({
			slot: discovered.ownerSlot.startsWith(graphicSlotPrefix)
				? discovered.ownerSlot.slice(graphicSlotPrefix.length)
				: discovered.ownerSlot,
			reference: discovered.reference,
			expectedKind: discovered.kind,
		}));
	return { assets, capabilities };
}

/**
 * Every Feature Match token a layout's Graphic Text Templates bind, once each.
 *
 * Two places name one: the `{placeholder}` a template substitutes, and a Graphic
 * Placeholder Style keyed by the same token. Both are collected, because a style
 * naming a token this installation does not have is a style that can never apply.
 *
 * ## Why a placeholder that is not a catalogue token is not declared
 *
 * A Graphic Text Template is a substitution rather than an evaluator, and
 * `renderGraphicTextTemplate` renders a placeholder naming nothing as an absence
 * by design — "a Text Graphic Item is one item of a composition and must keep
 * rendering the literal text around a value it cannot show". An author who typed
 * `{player1name}` sees an empty run locally, and declaring that as a required
 * capability would make the same layout unexportable: refused with a message about
 * a vocabulary term, over a typo, with no way to satisfy it.
 *
 * Filtering to the catalogue also keeps the two directions symmetric, which is the
 * stronger reason. A sender declares the tokens it really has, so a receiver
 * missing one refuses the package — the protection this exists for. A placeholder
 * neither installation has resolves to an absence on both, which is the same
 * rendering the sender was already looking at.
 */
function appendFeatureMatchTokenCapabilities(
	capabilities: TemplatePackageCapabilityRequirement[],
	items: readonly GraphicItemConfig[],
	slotPrefix: string,
): void {
	function append(item: GraphicItemConfig | GraphicGroupChildConfig, slot: string) {
		if (item.type !== 'text')
			return;
		const keys = new Set([
			...graphicTextTemplateInputKeys(item.text),
			...Object.keys(item.placeholderStyles ?? {}),
		]);
		for (const key of keys) {
			if (!isFeatureMatchTokenKey(key))
				continue;
			capabilities.push({
				slot: `${slot}.text`,
				capability: 'host-vocabulary',
				identity: featureMatchLayoutVocabularyIdentity('token', key),
				configurationVersion: FEATURE_MATCH_LAYOUT_FORMAT_VERSION,
			});
		}
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
 * A Feature Match Layout Template's payload is one reusable layout, so slots are
 * named relative to the layout the package carries rather than to the Screen
 * configuration the layout was discovered in.
 *
 * A layout declares more than a Broadcast Graphic does, because more of it is
 * host-owned. Alongside the shared Graphic Item Definitions its composition places
 * and the application fonts its typography names, it declares the Source Item
 * Definition and every term it uses from the three Feature Match Layout host
 * vocabularies — the Source Roles its Source Items carry, the Frame animation
 * effect, and the Feature Match tokens its Graphic Text Templates bind. All of
 * them are things the receiving installation supplies rather than things the
 * package carries, so all of them are things a receiver must be able to refuse.
 */
export function featureMatchLayoutTemplatePackageRequirements(
	layout: FeatureMatchLayoutConfig,
): TemplatePackageRequirements {
	const assets = featureMatchLayoutGraphicAssetReferences(layout).map(discovered => ({
		slot: discovered.ownerSlot.replace(/^layout\./, ''),
		reference: discovered.reference,
		expectedKind: discovered.kind,
	}));
	const capabilities: TemplatePackageCapabilityRequirement[] = [];
	for (const source of layout.sources) {
		capabilities.push({
			slot: `sources.${source.id}.type`,
			capability: 'graphic-item-definition',
			identity: FEATURE_MATCH_SOURCE_ITEM_DEFINITION_ID,
			configurationVersion: FEATURE_MATCH_SOURCE_ITEM_CONFIGURATION_VERSION,
		});
		if (source.sourceRole) {
			capabilities.push({
				slot: `sources.${source.id}.sourceRole`,
				capability: 'host-vocabulary',
				identity: featureMatchLayoutVocabularyIdentity('source-role', source.sourceRole),
				configurationVersion: FEATURE_MATCH_LAYOUT_FORMAT_VERSION,
			});
		}
	}
	// Declared whether or not the effect is currently switched on: the term is
	// stored either way, and an author who imports a layout and enables its Frame
	// animation must not be the one who discovers the renderer is missing.
	if (layout.frame.animation) {
		capabilities.push({
			slot: 'frame.animation.effect',
			capability: 'host-vocabulary',
			identity: featureMatchLayoutVocabularyIdentity('frame-animation-effect', layout.frame.animation.effect),
			configurationVersion: FEATURE_MATCH_LAYOUT_FORMAT_VERSION,
		});
	}
	for (const item of layout.composition.items)
		appendBroadcastGraphicItemCapabilities(capabilities, item, `composition.items.${item.id}`);
	appendFeatureMatchTokenCapabilities(capabilities, layout.composition.items, 'composition.items');
	appendApplicationFontCapabilities(capabilities, layout, '');
	return { assets, capabilities };
}
