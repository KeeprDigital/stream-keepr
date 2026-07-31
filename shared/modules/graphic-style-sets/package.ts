import type { GraphicStyleSetEntry } from '../../types/graphicStyleSet';
import type {
	GraphicStyleSetPackageDisposition,
	GraphicStyleSetPackageManifest,
	GraphicStyleSetPackagePreflightIssue,
	GraphicStyleSetPackageResolution,
	GraphicStyleSetSnapshot,
} from '../../types/graphicStyleSetPackage';
import type { TemplatePackageCapabilityDeclaration } from '../../types/templatePackage';
import { MAX_GRAPHIC_STYLE_SET_ENTRIES } from '../../types/graphicStyleSet';
import {
	GRAPHIC_STYLE_SET_PACKAGE_ARTIFACT_KIND,
	GRAPHIC_STYLE_SET_PACKAGE_KIND,
	GRAPHIC_STYLE_SET_PACKAGE_MINIMUM_MIGRATABLE_SCHEMA_VERSION,
	GRAPHIC_STYLE_SET_PACKAGE_SCHEMA_VERSION,
	GRAPHIC_STYLE_SET_PACKAGE_STYLE_SET_ENTRY,
} from '../../types/graphicStyleSetPackage';
import { sameGraphicStyleValue } from './apply';

/**
 * Everything a `.skstyle` package decides that is a pure function of what it carried
 * and what this installation already holds.
 *
 * Freezing a snapshot, digesting it, declaring the fonts it needs, reading a received
 * manifest, and — the part that matters — deciding what installing it would do. All of
 * it lives here rather than beside a route or a table so that both halves of a
 * transfer are held to one statement of the rules, and so the conflict table can be
 * proved exhaustively without a database.
 */

/* ────────────────────────────────────────────────
 * The frozen snapshot and its content digest
 * ──────────────────────────────────────────────── */

/**
 * The canonical text a content digest is taken over.
 *
 * Two installations must agree byte for byte about content they consider identical, or
 * every re-import of an unchanged Style Set would read as a conflict. JSON alone does
 * not promise that: object key order survives a round trip through storage and
 * `JSON.stringify` preserves whatever order it is handed, so the same entries written
 * on two machines can serialise differently. So keys are sorted at every depth and
 * `undefined` members are dropped, which is what a stored document does to them
 * anyway.
 *
 * Array order is deliberately *not* normalised. An entry list is authored — the order
 * an author put their palette in is part of what they published — and
 * {@link sameGraphicStyleValue}, the comparison the rest of the Style Set feature is
 * built on, compares arrays positionally. Two comparisons disagreeing about
 * reordering is how a conflict becomes undecidable.
 */
export function canonicalGraphicStyleSetJson(value: unknown): string {
	if (value === null || typeof value !== 'object')
		return JSON.stringify(value ?? null);
	if (Array.isArray(value))
		return `[${value.map(canonicalGraphicStyleSetJson).join(',')}]`;
	const record = value as Record<string, unknown>;
	const members = Object.keys(record)
		.filter(key => record[key] !== undefined)
		.sort()
		.map(key => `${JSON.stringify(key)}:${canonicalGraphicStyleSetJson(record[key])}`);
	return `{${members.join(',')}}`;
}

/**
 * The SHA-256 a package records as provenance, over the entries alone.
 *
 * The Style Set's name and description are outside it on purpose. Renaming a Style Set
 * creates no revision, so two installations at the same revision under different names
 * hold the same published content — a difference worth telling an author about, and
 * not a conflict about what the style *is*.
 */
export async function graphicStyleSetContentDigest(
	entries: readonly GraphicStyleSetEntry[],
): Promise<string> {
	const bytes = new TextEncoder().encode(canonicalGraphicStyleSetJson(entries));
	const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
	return [...new Uint8Array(digest)]
		.map(byte => byte.toString(16).padStart(2, '0'))
		.join('');
}

/**
 * The application fonts a snapshot requires, as capability declarations.
 *
 * One per distinct font rather than one per preset, with every preset that needs it
 * named in `requiredBy`, so an author told "this installation does not have Barlow"
 * can see which entries would break rather than the same sentence six times.
 */
export function graphicStyleSetPackageCapabilities(
	entries: readonly GraphicStyleSetEntry[],
): TemplatePackageCapabilityDeclaration[] {
	const byFont = new Map<string, string[]>();
	for (const entry of entries) {
		if (entry.kind !== 'typography')
			continue;
		const requiredBy = byFont.get(entry.value.fontId) ?? [];
		requiredBy.push(`entries.${entry.id}.fontId`);
		byFont.set(entry.value.fontId, requiredBy);
	}
	return [...byFont]
		.map(([identity, requiredBy]) => ({
			capability: 'application-font' as const,
			identity,
			configurationVersion: 1,
			requiredBy: [...requiredBy].sort(),
		}))
		.sort((left, right) => left.identity.localeCompare(right.identity));
}

/* ────────────────────────────────────────────────
 * Reading a received manifest
 * ──────────────────────────────────────────────── */

const DIGEST = /^[a-f0-9]{64}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function isNonEmptyString(value: unknown, maximumLength = 200): value is string {
	return typeof value === 'string' && value.length > 0 && value.length <= maximumLength;
}

export interface ReadGraphicStyleSetPackageManifestResult {
	manifest: GraphicStyleSetPackageManifest;
	receivedSchemaVersion: number;
	migrated: boolean;
}

export type ReadGraphicStyleSetPackageManifestOutcome
	= | { outcome: 'read'; result: ReadGraphicStyleSetPackageManifestResult }
		| {
			outcome: 'rejected';
			issues: readonly {
				code: 'invalid-package-manifest' | 'unsupported-package-schema-version'
					| 'package-migration-unavailable' | 'unsupported-package-artifact';
				subject?: string;
				message: string;
			}[];
		};

/**
 * Brings a supported older manifest up to the current schema.
 *
 * Version 1 is currently both the oldest supported and the current schema, so nothing
 * migrates yet and `package-migration-unavailable` cannot be produced. This is
 * scaffolding a schema 2 extends, deliberately deterministic and total: a package that
 * migrated differently on a retry would invalidate a report an author already
 * confirmed.
 */
function migrateManifest(
	value: Record<string, unknown>,
	receivedSchemaVersion: number,
): Record<string, unknown> {
	let migrated = value;
	for (
		let version = receivedSchemaVersion;
		version < GRAPHIC_STYLE_SET_PACKAGE_SCHEMA_VERSION;
		version += 1
	) {
		migrated = { ...migrated, schemaVersion: version + 1 };
	}
	return migrated;
}

/**
 * Proves a received manifest says everything a receiver needs, and only things it can
 * act on. A manifest that cannot be read is never partially believed: no disposition
 * is proposed from a package whose own declarations are unusable.
 */
export function readGraphicStyleSetPackageManifest(
	value: unknown,
): ReadGraphicStyleSetPackageManifestOutcome {
	const invalid = (message: string, subject?: string) => ({
		outcome: 'rejected' as const,
		issues: [{ code: 'invalid-package-manifest' as const, subject, message }],
	});

	if (!isPlainObject(value))
		return invalid('The package manifest is not an object');

	const receivedSchemaVersion = value.schemaVersion;
	if (!Number.isSafeInteger(receivedSchemaVersion) || (receivedSchemaVersion as number) <= 0)
		return invalid('The package manifest declares no usable schema version');
	const schemaVersion = receivedSchemaVersion as number;
	// An unrecognised future schema is refused rather than guessed at: a receiver that
	// ignored what it could not read would install an incomplete Style Set.
	if (schemaVersion > GRAPHIC_STYLE_SET_PACKAGE_SCHEMA_VERSION) {
		return {
			outcome: 'rejected',
			issues: [{
				code: 'unsupported-package-schema-version',
				message: `The package declares schema version ${schemaVersion}, which is newer than the version ${GRAPHIC_STYLE_SET_PACKAGE_SCHEMA_VERSION} this installation reads`,
			}],
		};
	}
	if (schemaVersion < GRAPHIC_STYLE_SET_PACKAGE_MINIMUM_MIGRATABLE_SCHEMA_VERSION) {
		return {
			outcome: 'rejected',
			issues: [{
				code: 'package-migration-unavailable',
				message: `This installation cannot migrate a package from schema version ${schemaVersion}`,
			}],
		};
	}

	const migrated = migrateManifest(value, schemaVersion);
	if (
		migrated.packageKind !== GRAPHIC_STYLE_SET_PACKAGE_KIND
		|| migrated.artifactKind !== GRAPHIC_STYLE_SET_PACKAGE_ARTIFACT_KIND
	) {
		return {
			outcome: 'rejected',
			issues: [{
				code: 'unsupported-package-artifact',
				message: 'The package does not declare a Graphic Style Set Package',
			}],
		};
	}

	const styleSet = migrated.styleSet;
	if (
		!isPlainObject(styleSet)
		|| !isNonEmptyString(styleSet.identity, 100)
		|| !isNonEmptyString(styleSet.name)
		|| !Number.isSafeInteger(styleSet.revision)
		|| (styleSet.revision as number) <= 0
		|| typeof styleSet.contentDigest !== 'string'
		|| !DIGEST.test(styleSet.contentDigest)
		|| !Number.isSafeInteger(styleSet.entryCount)
		|| (styleSet.entryCount as number) < 0
		|| (styleSet.entryCount as number) > MAX_GRAPHIC_STYLE_SET_ENTRIES
		|| styleSet.entry !== GRAPHIC_STYLE_SET_PACKAGE_STYLE_SET_ENTRY
	) {
		return invalid(
			'The package does not declare exactly one published Graphic Style Set at its Style Set entry',
			'styleSet',
		);
	}

	if (typeof migrated.createdAt !== 'string')
		return invalid('The package manifest records no creation time');
	if (!Array.isArray(migrated.applicationCapabilities))
		return invalid('The package manifest declares no application capabilities');
	for (const [index, capability] of (migrated.applicationCapabilities as unknown[]).entries()) {
		if (
			!isPlainObject(capability)
			|| capability.capability !== 'application-font'
			|| !isNonEmptyString(capability.identity)
			|| !Array.isArray(capability.requiredBy)
		) {
			return invalid(
				'Application capability declaration is unusable',
				`applicationCapabilities[${index}]`,
			);
		}
	}

	// The totals are the manifest's own account of the envelope. A manifest that
	// miscounts itself cannot be used to check the envelope's limits.
	const totals = migrated.totals;
	if (
		!isPlainObject(totals)
		|| totals.entryCount !== 2
		|| !Number.isSafeInteger(totals.expandedByteLength)
		|| (totals.expandedByteLength as number) < 0
	) {
		return invalid('The package manifest does not agree with its own totals');
	}

	return {
		outcome: 'read',
		result: {
			manifest: migrated as unknown as GraphicStyleSetPackageManifest,
			receivedSchemaVersion: schemaVersion,
			migrated: schemaVersion !== GRAPHIC_STYLE_SET_PACKAGE_SCHEMA_VERSION,
		},
	};
}

/* ────────────────────────────────────────────────
 * What installing this package would do
 * ──────────────────────────────────────────────── */

const DISPOSITION_REMEDIATION = {
	'graphic-style-set-revision-conflict': 'Two installations published different entries as the same revision of this Graphic Style Set. Install it as an independent copy, or reconcile the two by hand and publish a newer revision on one of them.',
	'graphic-style-set-revision-superseded': 'This installation already holds a newer revision of this Graphic Style Set. Export the newer one instead, or install this package as an independent copy.',
	'graphic-style-set-draft-diverged': 'The installed Graphic Style Set has unpublished draft changes this update would discard. Publish or revert the draft first, or install this package as an independent copy.',
} as const;

/** One installed Style Set as the disposition decision reads it. */
export interface InstalledGraphicStyleSetFacts {
	id: string;
	name: string;
	/** The published revision. Zero means it has never been published. */
	revision: number;
	/** The token a write compare-and-swaps on, so an install cannot race a draft edit. */
	draftRevision: number;
	published: readonly GraphicStyleSetEntry[] | null;
	/** Whether the working draft differs from the published entries. */
	hasUnpublishedChanges: boolean;
}

export interface GraphicStyleSetPackageDispositionInput {
	packaged: Pick<GraphicStyleSetSnapshot, 'id' | 'name' | 'revision' | 'entries'>;
	/** The Style Set installed under the packaged identity, where one is. */
	installed?: InstalledGraphicStyleSetFacts;
	resolution: GraphicStyleSetPackageResolution;
}

export interface GraphicStyleSetPackageDispositionOutcome {
	disposition: GraphicStyleSetPackageDisposition;
	issues: GraphicStyleSetPackagePreflightIssue[];
}

/**
 * The complete conflict table, as one function over one pair of facts.
 *
 * The rules it encodes are the glossary's, in the glossary's order:
 *
 * - The first import preserves the packaged identity and revision.
 * - An exact identity, revision, and content match is already installed, so nothing
 *   happens.
 * - A newer related revision may explicitly update the installed Style Set, which is
 *   what makes it a confirmation rather than a silent write.
 * - An older revision never silently downgrades one.
 * - The same identity and revision with different content is a conflict.
 * - Any related or conflicting package may instead install as an independent copy with
 *   a new identity.
 *
 * There is no branch that takes some entries and leaves others. "Imports never
 * field-merge Style Sets" is not a check performed somewhere — it is the absence of
 * any disposition that could.
 */
export function graphicStyleSetPackageDisposition(
	input: GraphicStyleSetPackageDispositionInput,
): GraphicStyleSetPackageDispositionOutcome {
	const issues: GraphicStyleSetPackagePreflightIssue[] = [];

	// An explicit copy answers every relation the same way: a new identity relates to
	// nothing installed, so no revision comparison can apply to it.
	if (input.resolution === 'independent-copy') {
		issues.push({
			code: 'graphic-style-set-installed-as-copy',
			severity: 'warning',
			message: `“${input.packaged.name}” will be installed as an independent Graphic Style Set with a new identity`,
			remediation: 'Nothing links to the copy until a template selects entries from it, and it will never receive an update from this package\'s source.',
		});
		return { disposition: 'install-independent-copy', issues };
	}

	const { installed } = input;
	// Nothing here holds the packaged identity, so the package's own identity and
	// revision become this installation's — which is what makes a later package able to
	// update this one's result rather than sit beside it as a second copy.
	if (!installed)
		return { disposition: 'install-new', issues };

	if (installed.revision === 0 || installed.published === null) {
		// The identity exists here but has never been published, so it is somebody's
		// working draft rather than a revision the package can relate to. An import
		// never overwrites a draft: that is a merge decision, and imports never merge.
		issues.push({
			code: 'graphic-style-set-draft-diverged',
			severity: 'error',
			message: 'A Graphic Style Set with this identity exists here and has never been published, so installing over it would discard an unpublished draft',
			remediation: DISPOSITION_REMEDIATION['graphic-style-set-draft-diverged'],
		});
		return { disposition: 'rejected', issues };
	}

	if (installed.name !== input.packaged.name) {
		issues.push({
			code: 'graphic-style-set-name-differs',
			severity: 'warning',
			message: `The package calls this Graphic Style Set “${input.packaged.name}”; this library records it as “${installed.name}”`,
			remediation: 'Confirm to keep the installed name, or rename the Graphic Style Set after installing.',
		});
	}

	if (input.packaged.revision === installed.revision) {
		if (sameGraphicStyleValue(input.packaged.entries, installed.published))
			return { disposition: 'already-installed', issues };
		issues.push({
			code: 'graphic-style-set-revision-conflict',
			severity: 'error',
			message: `Revision ${input.packaged.revision} of this Graphic Style Set is already installed with different entries`,
			remediation: DISPOSITION_REMEDIATION['graphic-style-set-revision-conflict'],
		});
		return { disposition: 'rejected', issues };
	}

	if (input.packaged.revision < installed.revision) {
		issues.push({
			code: 'graphic-style-set-revision-superseded',
			severity: 'error',
			message: `The package carries revision ${input.packaged.revision}; this installation already publishes revision ${installed.revision}`,
			remediation: DISPOSITION_REMEDIATION['graphic-style-set-revision-superseded'],
		});
		return { disposition: 'rejected', issues };
	}

	if (installed.hasUnpublishedChanges) {
		issues.push({
			code: 'graphic-style-set-draft-diverged',
			severity: 'error',
			message: `The installed Graphic Style Set has unpublished draft changes that installing revision ${input.packaged.revision} would discard`,
			remediation: DISPOSITION_REMEDIATION['graphic-style-set-draft-diverged'],
		});
		return { disposition: 'rejected', issues };
	}

	issues.push({
		code: 'graphic-style-set-revision-updated',
		severity: 'warning',
		message: `This will publish revision ${input.packaged.revision} over the installed revision ${installed.revision}`,
		remediation: 'Every linked template is offered the change as an available style update to review; none of them is rewritten by this install.',
	});
	return { disposition: 'update-installed', issues };
}
