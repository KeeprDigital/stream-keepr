import type { FeatureMatchGraphicItemType } from '~~/shared/featureMatchGraphicItemDefinitions';
import type { GraphicItemKind } from '~~/shared/types/graphics';
import type { GraphicAssetReference } from '~~/shared/types/graphicsAsset';
import type {
	TemplatePackageAsset,
	TemplatePackageAssetRequirement,
	TemplatePackageCapabilityDeclaration,
	TemplatePackageCapabilityRequirement,
	TemplatePackageContent,
	TemplatePackageExportIssue,
	TemplatePackageExportIssueCode,
	TemplatePackageKind,
	TemplatePackageManifest,
	TemplatePackageTotals,
} from '~~/shared/types/templatePackage';
import {
	FEATURE_MATCH_GRAPHIC_ITEM_TYPES,
	featureMatchGraphicItemDefinition,
} from '~~/shared/featureMatchGraphicItemDefinitions';
import { FEATURE_MATCH_OVERLAY_FONT_IDS } from '~~/shared/featureMatchOverlayFonts';
import { getGraphicItemDefinition, GRAPHIC_ITEM_KINDS } from '~~/shared/modules/graphics/itemDefinitions';
import {
	TEMPLATE_PACKAGE_ARTIFACTS,
	TEMPLATE_PACKAGE_LIMITS,
	TEMPLATE_PACKAGE_MANIFEST_ENTRY,
	TEMPLATE_PACKAGE_SCHEMA_VERSION,
	TEMPLATE_PACKAGE_TEMPLATE_ENTRY,
	templatePackageContentEntry,
} from '~~/shared/types/templatePackage';

/**
 * The provider-independent half of Template Package export: what a Template
 * document is allowed to contain, which application capabilities exist, how
 * exact revisions become logical packaged identities, and how the envelope's
 * limits are measured. Nothing here reads bytes or knows a storage provider, so
 * both package kinds are held to identical rules.
 */

/** Bounds the document walk so a pathological payload cannot exhaust the Worker. */
const MAXIMUM_DOCUMENT_DEPTH = 64;
const MAXIMUM_DOCUMENT_NODES = 100_000;

/** Schemes that would make a package depend on something outside itself. */
const REMOTE_RESOURCE_PATTERN = /(?:https?|ftps?|wss?|file|filesystem):\/\//i;
const WHOLE_VALUE_REMOTE_PATTERN = /^\s*(?:(?:https?|ftps?|wss?|file|filesystem):\/\/|\/\/[^/\s])\S*\s*$/i;
/** A CSS resource function fetches whatever it names, wherever it is authored. */
const CSS_RESOURCE_FUNCTION_PATTERN = /\burl\(\s*(?:['"]\s*)?(?:[a-z][\w+.-]*:|\/\/)/i;
/** Inline payloads bypass the library, so they are undeclared dependencies. */
const INLINE_PAYLOAD_PATTERN = /^\s*(?:data|blob):/i;
/**
 * Property names whose value a renderer would resolve as a resource rather than
 * display as text.
 */
const RESOURCE_PROPERTY_NAMES = new Set([
	'url',
	'uri',
	'src',
	'srcset',
	'href',
	'source',
	'poster',
	'icon',
	'image',
	'media',
	'path',
	'endpoint',
]);

/**
 * Decided on the property's last word, whatever convention names it. A field is
 * a resource because of what it means, not because of how it was capitalised, so
 * `backgroundImage`, `image_url`, `IMAGE_URL`, and `sources` all qualify while
 * `text`, `label`, and `template` do not.
 */
function isResourceProperty(key: string): boolean {
	const words = key
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.split(/[^a-z0-9]+/i)
		.filter(Boolean);
	const last = words.at(-1)?.toLowerCase();
	if (!last)
		return false;
	return RESOURCE_PROPERTY_NAMES.has(last)
		|| (last.endsWith('s') && RESOURCE_PROPERTY_NAMES.has(last.slice(0, -1)));
}
const EXECUTABLE_CONTENT_PATTERN
	= /javascript:|vbscript:|<\s*(?:\/\s*)?script\b|\bon(?:abort|blur|change|click|error|focus|load|mouseover|submit)\s*=/i;
const UNSAFE_PROPERTY_NAMES = new Set(['__proto__', 'constructor', 'prototype']);

const ISSUE_REMEDIATION = {
	'missing-graphic-asset-reference': 'Point the Template field at an existing Graphic Asset Revision, or remove the field.',
	'unavailable-graphic-asset-content': 'The exact revision exists but its bytes are temporarily unavailable. Retry the export, or ask an administrator to repair the content.',
	'invalid-graphic-asset-content-facts': 'The catalogue records an unusable size for this content, so the package cannot be measured. Ask an administrator to reconcile the Graphic Asset before exporting.',
	'unsupported-application-capability': 'This installation does not provide the requested application capability. Replace it with a supported one before exporting.',
	'unexpected-graphic-asset-kind': 'The Template field requires a different media kind. Select a Graphic Asset of the expected kind.',
	'undeclared-graphic-asset-dependency': 'Every asset a Template needs must be selected from the Graphics Asset Library. Replace the inline or undeclared value with a library selection.',
	'remote-resource-dependency': 'A Template Package cannot depend on a remote resource. Ingest the resource into the Graphics Asset Library and select the resulting revision.',
	'executable-template-content': 'Template Packages are data-only. Remove the executable value before exporting.',
	'invalid-template-document': 'The Template document must be plain data. Remove the unsupported value before exporting.',
	'duplicate-template-slot': 'Each Template slot may declare one asset requirement. Remove the duplicate declaration.',
	'package-entry-limit-exceeded': `A Template Package carries at most ${TEMPLATE_PACKAGE_LIMITS.maximumEntryCount} entries. Reduce the number of distinct assets the Template requires.`,
	'packaged-revision-limit-exceeded': `A Template Package carries at most ${TEMPLATE_PACKAGE_LIMITS.maximumPackagedRevisionCount} packaged Graphic Asset Revisions. Reduce the number of distinct revisions the Template requires.`,
	'package-expanded-limit-exceeded': 'The Template requires more asset bytes than a Template Package may expand to. Reduce or replace its largest assets.',
	'package-archive-limit-exceeded': 'The Template requires more asset bytes than a Template Package archive may contain. Reduce or replace its largest assets.',
} as const satisfies Record<TemplatePackageExportIssueCode, string>;

const RETRYABLE_ISSUE_CODES = new Set<TemplatePackageExportIssueCode>([
	'unavailable-graphic-asset-content',
]);

export function templatePackageExportIssue(
	code: TemplatePackageExportIssueCode,
	input: { message: string; slot?: string },
): TemplatePackageExportIssue {
	return {
		code,
		slot: input.slot,
		message: input.message,
		remediation: ISSUE_REMEDIATION[code],
		retryable: RETRYABLE_ISSUE_CODES.has(code),
	};
}

export interface TemplateDocumentInspection {
	issues: TemplatePackageExportIssue[];
	/** Every Graphic Asset Reference the document itself carries, by document path. */
	references: { path: string; reference: GraphicAssetReference }[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function graphicAssetReferenceOf(value: Record<string, unknown>): GraphicAssetReference | undefined {
	return typeof value.assetId === 'string'
		&& value.assetId.length > 0
		&& typeof value.revisionId === 'string'
		&& value.revisionId.length > 0
		? value as unknown as GraphicAssetReference
		: undefined;
}

/**
 * Proves a Template document is data-only and self-contained before anything is
 * packaged. The library checks the document itself rather than trusting the
 * exporting workflow's declarations, so no caller can smuggle a remote
 * dependency, an inline payload, executable content, or an asset it never
 * declared into a package.
 */
export function inspectTemplateDocument(document: unknown): TemplateDocumentInspection {
	const issues: TemplatePackageExportIssue[] = [];
	const references: { path: string; reference: GraphicAssetReference }[] = [];
	let nodeCount = 0;

	function reject(code: TemplatePackageExportIssueCode, path: string, message: string) {
		issues.push(templatePackageExportIssue(code, { slot: path, message }));
	}

	/**
	 * A Template Package may not depend on anything outside itself, but authored
	 * display copy is data, not a dependency: a lower third reading "Visit
	 * https://team.com" is text the renderer draws, never a resource it fetches.
	 * So a remote resource is recognised by position rather than by mentioning a
	 * scheme — a value that is entirely a URL, a value under a resource-shaped
	 * property, or a CSS `url()` function, which fetches wherever it is written.
	 *
	 * Executable content and inline payloads are judged everywhere instead. Both
	 * are anchored to the start of a value, so neither can fire on prose that
	 * merely mentions them, and a value that genuinely begins `data:` or
	 * `javascript:` has no legitimate place in authored broadcast copy. Packages
	 * carry no undeclared files, so an inline payload is refused whatever field
	 * it was authored into.
	 */
	function inspectString(value: string, path: string, resourceProperty: boolean) {
		const wholeValueResource = WHOLE_VALUE_REMOTE_PATTERN.test(value);
		if (EXECUTABLE_CONTENT_PATTERN.test(value))
			reject('executable-template-content', path, 'Template value contains executable content');
		else if (INLINE_PAYLOAD_PATTERN.test(value))
			reject('undeclared-graphic-asset-dependency', path, 'Template value inlines content that no packaged asset declares');
		else if (wholeValueResource || CSS_RESOURCE_FUNCTION_PATTERN.test(value))
			reject('remote-resource-dependency', path, 'Template value requires a remote resource');
		else if (resourceProperty && REMOTE_RESOURCE_PATTERN.test(value))
			reject('remote-resource-dependency', path, 'Template value requires a remote resource');
	}

	function walk(value: unknown, path: string, depth: number, resourceProperty = false) {
		nodeCount += 1;
		if (nodeCount > MAXIMUM_DOCUMENT_NODES) {
			if (nodeCount === MAXIMUM_DOCUMENT_NODES + 1)
				reject('invalid-template-document', path, 'Template document has too many values to package');
			return;
		}
		if (depth > MAXIMUM_DOCUMENT_DEPTH) {
			reject('invalid-template-document', path, 'Template document is nested too deeply to package');
			return;
		}
		if (value === null || typeof value === 'boolean')
			return;
		if (typeof value === 'number') {
			if (!Number.isFinite(value))
				reject('invalid-template-document', path, 'Template value is not a finite number');
			return;
		}
		if (typeof value === 'string') {
			inspectString(value, path, resourceProperty);
			return;
		}
		if (Array.isArray(value)) {
			// An array inherits its property's meaning, so `sources: [...]` stays resource-shaped.
			value.forEach((item, index) => walk(item, `${path}[${index}]`, depth + 1, resourceProperty));
			return;
		}
		if (isPlainObject(value)) {
			const reference = graphicAssetReferenceOf(value);
			if (reference)
				references.push({ path, reference });
			for (const key of Object.keys(value)) {
				if (UNSAFE_PROPERTY_NAMES.has(key)) {
					reject('invalid-template-document', path ? `${path}.${key}` : key, 'Template document declares an unsafe property name');
					continue;
				}
				walk(value[key], path ? `${path}.${key}` : key, depth + 1, isResourceProperty(key));
			}
			return;
		}
		if (typeof value === 'function') {
			reject('executable-template-content', path, 'Template document contains a function');
			return;
		}
		reject('invalid-template-document', path, `Template value of type ${typeof value} is not plain data`);
	}

	walk(document, '', 0);
	return { issues, references };
}

/**
 * The Graphic Item vocabulary a package kind's capability identities are named in.
 *
 * The two vocabularies are separate tables that both spell `text` and `media`, and
 * each advances its own configuration version, so an identity on its own cannot say
 * which version it means. The package kind that declared it can, and stating it
 * here means a new package kind has to name its vocabulary rather than inherit
 * whichever table happens to be consulted first.
 */
const CAPABILITY_VOCABULARY: Record<TemplatePackageKind, 'graphics-foundation' | 'feature-match'> = {
	skgraphic: 'graphics-foundation',
	sklayout: 'feature-match',
};

function supportedGraphicItemDefinitionVersion(
	packageKind: TemplatePackageKind,
	identity: string,
): number | undefined {
	if (CAPABILITY_VOCABULARY[packageKind] === 'feature-match') {
		return (FEATURE_MATCH_GRAPHIC_ITEM_TYPES as readonly string[]).includes(identity)
			? featureMatchGraphicItemDefinition(identity as FeatureMatchGraphicItemType).configurationVersion
			: undefined;
	}
	// The shared Graphics Foundation kinds state their own configuration version on
	// their Graphic Item Definition, so a kind whose stored configuration gains
	// meaning advances one number and every package check follows it.
	return (GRAPHIC_ITEM_KINDS as readonly string[]).includes(identity)
		? getGraphicItemDefinition(identity as GraphicItemKind).configurationVersion
		: undefined;
}

/**
 * Application-owned capabilities travel as declarations. An identity this
 * installation does not own, or a configuration version newer than it
 * implements, blocks export rather than shipping a package that cannot install.
 */
export function inspectTemplatePackageCapabilities(
	packageKind: TemplatePackageKind,
	requirements: readonly TemplatePackageCapabilityRequirement[],
): {
	issues: TemplatePackageExportIssue[];
	declarations: TemplatePackageCapabilityDeclaration[];
} {
	const issues: TemplatePackageExportIssue[] = [];
	const declarations = new Map<string, TemplatePackageCapabilityDeclaration & { requiredBy: string[] }>();
	for (const requirement of requirements) {
		const supportedVersion = requirement.capability === 'application-font'
			? ((FEATURE_MATCH_OVERLAY_FONT_IDS as readonly string[]).includes(requirement.identity) ? 1 : undefined)
			: supportedGraphicItemDefinitionVersion(packageKind, requirement.identity);
		if (
			supportedVersion === undefined
			|| (requirement.configurationVersion !== undefined && requirement.configurationVersion > supportedVersion)
		) {
			issues.push(templatePackageExportIssue('unsupported-application-capability', {
				slot: requirement.slot,
				message: `This installation does not provide ${requirement.capability} "${requirement.identity}"${
					requirement.configurationVersion === undefined
						? ''
						: ` at configuration version ${requirement.configurationVersion}`
				}`,
			}));
			continue;
		}
		const key = `${requirement.capability}:${requirement.identity}`;
		const existing = declarations.get(key);
		if (existing) {
			existing.requiredBy.push(requirement.slot);
			existing.configurationVersion = Math.max(
				existing.configurationVersion ?? 1,
				requirement.configurationVersion ?? 1,
			);
			continue;
		}
		declarations.set(key, {
			capability: requirement.capability,
			identity: requirement.identity,
			configurationVersion: requirement.configurationVersion ?? supportedVersion,
			requiredBy: [requirement.slot],
		});
	}
	return {
		issues,
		declarations: [...declarations.values()]
			.map(declaration => ({
				...declaration,
				requiredBy: [...declaration.requiredBy].sort(),
			}))
			.sort((left, right) =>
				`${left.capability}:${left.identity}`.localeCompare(`${right.capability}:${right.identity}`),
			),
	};
}

export interface ResolvedPackagedRevision {
	reference: GraphicAssetReference;
	name: string;
	kind: 'image' | 'silent-video' | 'font';
	revisionNumber: number;
	digest: string;
	byteLength: number;
	canonicalMime: TemplatePackageAsset['integrity']['canonicalMime'];
	facts: TemplatePackageAsset['facts'];
	compatibilityProfile: string;
	requiredBy: string[];
}

export function packagedRevisionKey(reference: GraphicAssetReference): string {
	return `${reference.assetId} ${reference.revisionId}`;
}

/**
 * Groups declared requirements by exact revision so one revision is packaged
 * once however many Template slots need it, and reports a slot that declares two
 * different requirements.
 */
export function groupTemplatePackageRequirements(
	requirements: readonly TemplatePackageAssetRequirement[],
): {
	issues: TemplatePackageExportIssue[];
	grouped: { reference: GraphicAssetReference; expectedKind?: 'image' | 'silent-video' | 'font'; slots: string[] }[];
} {
	const issues: TemplatePackageExportIssue[] = [];
	const slots = new Map<string, GraphicAssetReference>();
	const grouped = new Map<string, {
		reference: GraphicAssetReference;
		expectedKind?: 'image' | 'silent-video' | 'font';
		slots: string[];
	}>();
	for (const requirement of requirements) {
		const claimed = slots.get(requirement.slot);
		if (claimed && (
			claimed.assetId !== requirement.reference.assetId
			|| claimed.revisionId !== requirement.reference.revisionId
		)) {
			issues.push(templatePackageExportIssue('duplicate-template-slot', {
				slot: requirement.slot,
				message: 'Template slot declares more than one Graphic Asset Revision',
			}));
			continue;
		}
		slots.set(requirement.slot, requirement.reference);
		const key = packagedRevisionKey(requirement.reference);
		const existing = grouped.get(key);
		if (existing) {
			if (!existing.slots.includes(requirement.slot))
				existing.slots.push(requirement.slot);
			existing.expectedKind ??= requirement.expectedKind;
			continue;
		}
		grouped.set(key, {
			reference: requirement.reference,
			expectedKind: requirement.expectedKind,
			slots: [requirement.slot],
		});
	}
	return {
		issues,
		grouped: [...grouped.values()]
			.map(entry => ({ ...entry, slots: [...entry.slots].sort() }))
			.sort((left, right) => packagedRevisionKey(left.reference).localeCompare(packagedRevisionKey(right.reference))),
	};
}

/**
 * Reports a Graphic Asset Reference the Template document carries that the
 * exporting workflow never declared. Discovery belongs to each workflow's own
 * vocabulary, so an undeclared reference means the package would install a
 * Template with a dangling field.
 */
export function undeclaredReferenceIssues(
	documentReferences: readonly { path: string; reference: GraphicAssetReference }[],
	declared: readonly TemplatePackageAssetRequirement[],
): TemplatePackageExportIssue[] {
	const declaredKeys = new Set(declared.map(requirement => packagedRevisionKey(requirement.reference)));
	return documentReferences
		.filter(discovered => !declaredKeys.has(packagedRevisionKey(discovered.reference)))
		.map(discovered => templatePackageExportIssue('undeclared-graphic-asset-dependency', {
			slot: discovered.path,
			message: 'Template document requires a Graphic Asset Revision the export never declared',
		}));
}

export function packagedAssetIdentity(index: number): string {
	return `packaged-asset-${String(index + 1).padStart(4, '0')}`;
}

export interface TemplatePackagePlan {
	manifest: TemplatePackageManifest;
	manifestBytes: Uint8Array;
	templateBytes: Uint8Array;
	contents: readonly TemplatePackageContent[];
	issues: readonly TemplatePackageExportIssue[];
	totals: TemplatePackageTotals & { archiveByteLength: number };
}

function encodeJson(value: unknown): Uint8Array {
	return new TextEncoder().encode(JSON.stringify(value, null, '\t'));
}

/**
 * Assembles the manifest and measures the envelope. Identical bytes collapse to
 * one content entry while every packaged identity keeps its own manifest record,
 * so deduplication saves archive bytes without merging domain resources.
 */
export function planTemplatePackage(input: {
	packageKind: TemplatePackageKind;
	template: { identity: string; name: string; revision?: number; document: unknown };
	revisions: readonly ResolvedPackagedRevision[];
	capabilities: readonly TemplatePackageCapabilityDeclaration[];
	createdAt: string;
	archiveByteLength: (entries: readonly { name: string; byteLength: number }[]) => number;
}): TemplatePackagePlan {
	const issues: TemplatePackageExportIssue[] = [];
	const contents = new Map<string, TemplatePackageContent>();
	for (const revision of input.revisions) {
		// A size the catalogue cannot state is not a small package — it is an
		// unmeasurable one. Left alone it poisons every total into NaN, whose
		// comparisons against the limits are all false, so an unbounded archive
		// would sail through the checks and fail as an exception mid-write.
		if (!Number.isSafeInteger(revision.byteLength) || revision.byteLength < 0) {
			issues.push(templatePackageExportIssue('invalid-graphic-asset-content-facts', {
				slot: revision.requiredBy[0],
				message: `Graphic Asset "${revision.name}" records an unusable content byte length`,
			}));
		}
		if (contents.has(revision.digest))
			continue;
		contents.set(revision.digest, {
			digest: revision.digest,
			byteLength: revision.byteLength,
			canonicalMime: revision.canonicalMime,
			entry: templatePackageContentEntry(revision.digest),
		});
	}
	const contentList = [...contents.values()]
		.sort((left, right) => left.digest.localeCompare(right.digest));

	const packagedAssets: TemplatePackageAsset[] = input.revisions.map((revision, index) => ({
		packagedId: packagedAssetIdentity(index),
		name: revision.name,
		kind: revision.kind,
		origin: {
			sourceAssetId: revision.reference.assetId,
			sourceRevisionId: revision.reference.revisionId,
			sourceRevisionNumber: revision.revisionNumber,
			digest: revision.digest,
		},
		integrity: {
			algorithm: 'sha256',
			digest: revision.digest,
			byteLength: revision.byteLength,
			canonicalMime: revision.canonicalMime,
		},
		facts: revision.facts,
		compatibilityProfile: revision.compatibilityProfile,
		content: { entry: templatePackageContentEntry(revision.digest) },
		requiredBy: revision.requiredBy,
	}));

	const templateBytes = encodeJson(input.template.document);
	const contentByteLength = contentList
		.reduce((total, content) => total + content.byteLength, 0);
	const totals: TemplatePackageTotals = {
		entryCount: 2 + contentList.length,
		packagedAssetCount: packagedAssets.length,
		packagedRevisionCount: packagedAssets.length,
		uniqueContentCount: contentList.length,
		expandedByteLength: 0,
	};

	const manifest: TemplatePackageManifest = {
		schemaVersion: TEMPLATE_PACKAGE_SCHEMA_VERSION,
		packageKind: input.packageKind,
		templateKind: TEMPLATE_PACKAGE_ARTIFACTS[input.packageKind].templateKind,
		createdAt: input.createdAt,
		template: {
			identity: input.template.identity,
			name: input.template.name,
			// Written only when the exporting workflow has one, so a manifest never
			// claims a revision that means nothing.
			...(input.template.revision === undefined ? {} : { revision: input.template.revision }),
			entry: TEMPLATE_PACKAGE_TEMPLATE_ENTRY,
		},
		packagedAssets,
		applicationCapabilities: input.capabilities,
		contents: contentList,
		totals,
	};
	// The manifest records the expanded size it is itself part of. Re-encoding
	// only ever widens the recorded number, so this settles on a fixed point.
	let manifestBytes = encodeJson(manifest);
	for (let attempt = 0; attempt < 8; attempt += 1) {
		const expanded = manifestBytes.byteLength + templateBytes.byteLength + contentByteLength;
		if (totals.expandedByteLength === expanded)
			break;
		totals.expandedByteLength = expanded;
		manifestBytes = encodeJson(manifest);
	}

	const archiveByteLength = input.archiveByteLength([
		{ name: TEMPLATE_PACKAGE_MANIFEST_ENTRY, byteLength: manifestBytes.byteLength },
		{ name: TEMPLATE_PACKAGE_TEMPLATE_ENTRY, byteLength: templateBytes.byteLength },
		...contentList.map(content => ({ name: content.entry, byteLength: content.byteLength })),
	]);

	// A backstop for any other route to an unmeasurable envelope. An individual
	// content size already named above is not restated here.
	if (
		issues.length === 0
		&& (!Number.isSafeInteger(totals.expandedByteLength) || !Number.isSafeInteger(archiveByteLength))
	) {
		issues.push(templatePackageExportIssue('invalid-graphic-asset-content-facts', {
			message: 'The package envelope could not be measured from the recorded content sizes',
		}));
	}
	// Counts survive an unusable size, so they are always worth reporting.
	if (totals.entryCount > TEMPLATE_PACKAGE_LIMITS.maximumEntryCount) {
		issues.push(templatePackageExportIssue('package-entry-limit-exceeded', {
			message: `Package would contain ${totals.entryCount} entries`,
		}));
	}
	if (totals.packagedRevisionCount > TEMPLATE_PACKAGE_LIMITS.maximumPackagedRevisionCount) {
		issues.push(templatePackageExportIssue('packaged-revision-limit-exceeded', {
			message: `Package would contain ${totals.packagedRevisionCount} packaged Graphic Asset Revisions`,
		}));
	}
	// The byte limits are only meaningful over real sizes. Once a content size is
	// unusable these totals say nothing true — NaN slips under every `>` and
	// Infinity trips every one — so the unusable size is reported on its own
	// rather than dressed up as an envelope the author could shrink.
	const bytesMeasurable = issues.every(issue => issue.code !== 'invalid-graphic-asset-content-facts');
	if (bytesMeasurable && totals.expandedByteLength > TEMPLATE_PACKAGE_LIMITS.maximumExpandedByteLength) {
		issues.push(templatePackageExportIssue('package-expanded-limit-exceeded', {
			message: `Package would expand to ${totals.expandedByteLength} bytes`,
		}));
	}
	if (bytesMeasurable && archiveByteLength > TEMPLATE_PACKAGE_LIMITS.maximumArchiveByteLength) {
		issues.push(templatePackageExportIssue('package-archive-limit-exceeded', {
			message: `Package archive would be ${archiveByteLength} bytes`,
		}));
	}

	return {
		manifest: { ...manifest, totals: { ...totals } },
		manifestBytes,
		templateBytes,
		contents: contentList,
		issues,
		totals: { ...totals, archiveByteLength },
	};
}
