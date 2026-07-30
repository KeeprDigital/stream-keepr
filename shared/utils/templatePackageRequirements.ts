import type { BroadcastGraphicConfig } from '../types/graphics';
import type {
	FeatureMatchGraphicGroupContentConfig,
	FeatureMatchLayoutItemConfig,
	FeatureMatchOverlayModeConfig,
} from '../types/screenConfig';
import type {
	TemplatePackageAssetRequirement,
	TemplatePackageCapabilityRequirement,
} from '../types/templatePackage';
import {
	featureMatchGraphicGroupChildGraphicItemConfig,
	featureMatchGraphicItemDefinition,
	featureMatchLayoutItemDefinition,
} from '../featureMatchGraphicItemDefinitions';
import { getGraphicItemDefinition } from '../modules/graphics/itemDefinitions';
import { featureMatchOverlayGraphicAssetReferences } from './graphicsAssetReferences';

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
 * Application fonts travel as identifiers. Every graphics vocabulary spells an
 * application font the same way — a `fontId` beside its selection — so one walk
 * finds them wherever a style, token style map, or placeholder style sits.
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
		if (key === 'fontId' && typeof nested === 'string' && nested.length > 0) {
			capabilities.push({
				slot: nestedPath,
				capability: 'application-font',
				identity: nested,
			});
			continue;
		}
		appendApplicationFontCapabilities(capabilities, nested, nestedPath, depth + 1);
	}
}

/** A Broadcast Graphic Template's payload is one authored Broadcast Graphic. */
export function broadcastGraphicTemplatePackageRequirements(
	graphic: BroadcastGraphicConfig,
): TemplatePackageRequirements {
	const capabilities: TemplatePackageCapabilityRequirement[] = [];
	for (const item of graphic.items) {
		capabilities.push({
			slot: `items.${item.id}.type`,
			capability: 'graphic-item-definition',
			identity: getGraphicItemDefinition(item.type).kind,
			configurationVersion: 1,
		});
	}
	appendApplicationFontCapabilities(capabilities, graphic.items, 'items');
	// The Shared Graphics Foundation vocabulary carries no Graphic Asset
	// Reference yet; Media Graphic Items add them without changing this contract.
	return { assets: [], capabilities };
}

function appendFeatureMatchItemCapabilities(
	capabilities: TemplatePackageCapabilityRequirement[],
	item: FeatureMatchLayoutItemConfig,
): void {
	const definition = featureMatchLayoutItemDefinition(item);
	capabilities.push({
		slot: `items.${item.id}.type`,
		capability: 'graphic-item-definition',
		identity: definition.id,
		configurationVersion: definition.configurationVersion,
	});
	const content = item.type === 'graphic-item' ? item.graphicItem : item;
	if (content.type !== 'graphic-group')
		return;
	for (const child of (content as FeatureMatchGraphicGroupContentConfig).children) {
		const childDefinition = featureMatchGraphicItemDefinition(
			featureMatchGraphicGroupChildGraphicItemConfig(child).type,
		);
		capabilities.push({
			slot: `items.${item.id}.children.${child.id}.type`,
			capability: 'graphic-item-definition',
			identity: childDefinition.id,
			configurationVersion: childDefinition.configurationVersion,
		});
	}
}

/**
 * A Feature Match Layout Template's payload is one reusable layout, so slots are
 * named relative to the layout the package carries rather than to the Screen
 * configuration the layout was discovered in.
 */
export function featureMatchLayoutTemplatePackageRequirements(
	config: FeatureMatchOverlayModeConfig,
): TemplatePackageRequirements {
	const assets = featureMatchOverlayGraphicAssetReferences(config).map(discovered => ({
		slot: discovered.ownerSlot.replace(/^layout\./, ''),
		reference: discovered.reference,
		expectedKind: discovered.kind,
	}));
	const capabilities: TemplatePackageCapabilityRequirement[] = [];
	for (const item of config.layout.items)
		appendFeatureMatchItemCapabilities(capabilities, item);
	appendApplicationFontCapabilities(capabilities, config.layout, '');
	return { assets, capabilities };
}
