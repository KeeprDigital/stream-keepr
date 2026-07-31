import type {
	GraphicAssetLifecycleState,
	GraphicAssetReference,
} from '~~/shared/types/graphicsAsset';
import type {
	TemplatePackageAsset,
	TemplatePackageCapabilityKind,
	TemplatePackageKind,
	TemplatePackageManifest,
	TemplatePackagePreflightIssue,
	TemplatePackagePreflightMapping,
	TemplatePackagePreflightQuota,
	TemplatePackagePreflightReport,
	TemplatePackageTotals,
} from '~~/shared/types/templatePackage';
import type { TemplatePackageArchiveEntry } from './template-package-archive';
import {
	TEMPLATE_PACKAGE_ARTIFACTS,
	TEMPLATE_PACKAGE_CAPABILITY_KINDS,
	TEMPLATE_PACKAGE_KINDS,
	TEMPLATE_PACKAGE_LIMITS,
	TEMPLATE_PACKAGE_MANIFEST_ENTRY,
	TEMPLATE_PACKAGE_MINIMUM_MIGRATABLE_SCHEMA_VERSION,
	TEMPLATE_PACKAGE_SCHEMA_VERSION,
	TEMPLATE_PACKAGE_TEMPLATE_ENTRY,
	templatePackageContentEntry,
} from '~~/shared/types/templatePackage';
import { inspectTemplatePackageCapabilities } from './template-package';
import { packagedOriginKey } from './template-package-installation';
import { templatePackagePreflightIssue } from './template-package-preflight-issues';

/**
 * The provider-independent half of Template Package preflight: what a received
 * manifest must say, how an older supported schema migrates, which archive
 * entries the manifest accounts for, how a packaged identity becomes a proposed
 * local mapping, and what makes one proposal the same as another.
 *
 * Nothing here reads bytes, touches a catalogue, or knows a storage provider, so
 * both package kinds are held to identical rules and every decision is a pure
 * function of what the package declared and what the receiver already holds.
 */

const DIGEST = /^[a-f0-9]{64}$/;

const CANONICAL_MIMES = new Set<string>([
	'image/png',
	'image/jpeg',
	'image/webp',
	'video/mp4',
	'video/webm',
	'font/woff2',
	'font/woff',
	'font/ttf',
	'font/otf',
]);

const ASSET_KINDS = new Set<string>(['image', 'silent-video', 'font']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function isNonEmptyString(value: unknown, maximumLength = 200): value is string {
	return typeof value === 'string' && value.length > 0 && value.length <= maximumLength;
}

function invalidManifest(message: string, subject?: string): TemplatePackagePreflightIssue {
	return templatePackagePreflightIssue('invalid-package-manifest', { message, subject });
}

export interface ReadTemplatePackageManifestResult {
	manifest: TemplatePackageManifest;
	receivedSchemaVersion: number;
	migrated: boolean;
}

export type ReadTemplatePackageManifestOutcome
	= | { outcome: 'read'; result: ReadTemplatePackageManifestResult }
		| { outcome: 'rejected'; issues: readonly TemplatePackagePreflightIssue[] };

/**
 * Brings a supported older manifest up to the current schema.
 *
 * Migration is deterministic and total: it must produce the same current-schema
 * manifest for the same input every time, because a package that migrated
 * differently on a retry would invalidate the report an author already
 * confirmed.
 *
 * Version 1 is currently both the oldest supported and the current schema, so
 * every branch below is unreachable today: nothing migrates, and
 * `package-migration-unavailable` cannot be produced. This is scaffolding a
 * schema 2 extends, not behaviour any test can exercise yet.
 */
function migrateManifest(
	value: Record<string, unknown>,
	receivedSchemaVersion: number,
): Record<string, unknown> {
	let migrated = value;
	for (
		let version = receivedSchemaVersion;
		version < TEMPLATE_PACKAGE_SCHEMA_VERSION;
		version += 1
	) {
		migrated = { ...migrated, schemaVersion: version + 1 };
	}
	return migrated;
}

function readPackagedAsset(
	value: unknown,
	index: number,
): { asset: TemplatePackageAsset } | { issues: TemplatePackagePreflightIssue[] } {
	const subject = `packagedAssets[${index}]`;
	if (!isPlainObject(value))
		return { issues: [invalidManifest('Packaged asset is not an object', subject)] };
	const issues: TemplatePackagePreflightIssue[] = [];
	const { packagedId, name, kind, origin, integrity, facts, compatibilityProfile, content, requiredBy } = value;

	if (!isNonEmptyString(packagedId))
		issues.push(invalidManifest('Packaged asset has no usable identity', subject));
	if (!isNonEmptyString(name))
		issues.push(invalidManifest('Packaged asset has no usable name', subject));
	if (typeof kind !== 'string' || !ASSET_KINDS.has(kind))
		issues.push(invalidManifest('Packaged asset declares an unsupported media kind', subject));
	if (!isPlainObject(origin)
		|| !isNonEmptyString(origin.sourceAssetId)
		|| !isNonEmptyString(origin.sourceRevisionId)
		|| !Number.isSafeInteger(origin.sourceRevisionNumber)
		|| (origin.sourceRevisionNumber as number) <= 0
		|| typeof origin.digest !== 'string'
		|| !DIGEST.test(origin.digest)) {
		issues.push(invalidManifest('Packaged asset declares an unusable Graphic Asset Origin', subject));
	}
	if (!isPlainObject(integrity)
		|| integrity.algorithm !== 'sha256'
		|| typeof integrity.digest !== 'string'
		|| !DIGEST.test(integrity.digest)
		|| !Number.isSafeInteger(integrity.byteLength)
		|| (integrity.byteLength as number) < 0
		|| typeof integrity.canonicalMime !== 'string'
		|| !CANONICAL_MIMES.has(integrity.canonicalMime)) {
		issues.push(invalidManifest('Packaged asset declares unusable integrity facts', subject));
	}
	// Provenance and integrity describe the same bytes, so a package that
	// disagrees with itself about which digest they are cannot be mapped.
	if (
		isPlainObject(origin)
		&& isPlainObject(integrity)
		&& typeof origin.digest === 'string'
		&& origin.digest !== integrity.digest
	) {
		issues.push(invalidManifest('Packaged asset origin and integrity name different content', subject));
	}
	if (!isPlainObject(facts))
		issues.push(invalidManifest('Packaged asset carries no technical facts', subject));
	if (!isNonEmptyString(compatibilityProfile))
		issues.push(invalidManifest('Packaged asset names no compatibility profile', subject));
	if (
		!isPlainObject(content)
		|| !isNonEmptyString(content.entry)
		|| !isPlainObject(integrity)
		|| typeof integrity.digest !== 'string'
		|| content.entry !== templatePackageContentEntry(integrity.digest)
	) {
		issues.push(invalidManifest('Packaged asset does not point at its own content entry', subject));
	}
	if (!Array.isArray(requiredBy) || requiredBy.some(slot => typeof slot !== 'string'))
		issues.push(invalidManifest('Packaged asset does not record which Template slots require it', subject));

	if (issues.length > 0)
		return { issues };
	return { asset: value as unknown as TemplatePackageAsset };
}

/**
 * Proves a received manifest says everything a receiver needs, and only things
 * it can act on. A manifest that cannot be read is never partially believed: no
 * mapping is proposed from a package whose own declarations are unusable.
 */
export function readTemplatePackageManifest(value: unknown): ReadTemplatePackageManifestOutcome {
	if (!isPlainObject(value))
		return { outcome: 'rejected', issues: [invalidManifest('The package manifest is not an object')] };

	const receivedSchemaVersion = value.schemaVersion;
	if (!Number.isSafeInteger(receivedSchemaVersion) || (receivedSchemaVersion as number) <= 0)
		return { outcome: 'rejected', issues: [invalidManifest('The package manifest declares no usable schema version')] };
	const schemaVersion = receivedSchemaVersion as number;
	// An unrecognised future schema is refused rather than guessed at: a receiver
	// that ignored what it could not read would install an incomplete Template.
	if (schemaVersion > TEMPLATE_PACKAGE_SCHEMA_VERSION) {
		return {
			outcome: 'rejected',
			issues: [templatePackagePreflightIssue('unsupported-package-schema-version', {
				message: `The package declares schema version ${schemaVersion}, which is newer than the version ${TEMPLATE_PACKAGE_SCHEMA_VERSION} this installation reads`,
			})],
		};
	}
	if (schemaVersion < TEMPLATE_PACKAGE_MINIMUM_MIGRATABLE_SCHEMA_VERSION) {
		return {
			outcome: 'rejected',
			issues: [templatePackagePreflightIssue('package-migration-unavailable', {
				message: `This installation cannot migrate a package from schema version ${schemaVersion}`,
			})],
		};
	}

	const migratedValue = migrateManifest(value, schemaVersion);
	const issues: TemplatePackagePreflightIssue[] = [];
	const { packageKind, templateKind, template, packagedAssets, applicationCapabilities, contents, totals } = migratedValue;

	// Exactly one supported artifact type, agreeing with itself about which.
	if (typeof packageKind !== 'string' || !(TEMPLATE_PACKAGE_KINDS as readonly string[]).includes(packageKind)) {
		return {
			outcome: 'rejected',
			issues: [templatePackagePreflightIssue('unsupported-package-artifact', {
				message: 'The package does not declare a supported artifact type',
			})],
		};
	}
	const kind = packageKind as TemplatePackageKind;
	if (templateKind !== TEMPLATE_PACKAGE_ARTIFACTS[kind].templateKind) {
		issues.push(templatePackagePreflightIssue('unsupported-package-artifact', {
			message: `A ${kind} package carries a ${TEMPLATE_PACKAGE_ARTIFACTS[kind].templateKind}, not "${String(templateKind)}"`,
		}));
	}
	// Exactly one Template, at the one entry a package may carry it in.
	if (
		!isPlainObject(template)
		|| !isNonEmptyString(template.identity)
		|| !isNonEmptyString(template.name)
		|| template.entry !== TEMPLATE_PACKAGE_TEMPLATE_ENTRY
	) {
		issues.push(templatePackagePreflightIssue('unsupported-package-artifact', {
			message: 'The package does not declare exactly one Template at its Template entry',
		}));
	}
	// A declared source revision is provenance, so an unusable one is refused rather
	// than dropped: silently discarding it would leave a later import unable to tell
	// a re-import of the same design from a newer revision of it, with nothing in
	// the report to say the information was ever there.
	else if (
		template.revision !== undefined
		&& (!Number.isSafeInteger(template.revision) || (template.revision as number) <= 0)
	) {
		issues.push(invalidManifest('The package declares an unusable Template revision', 'template.revision'));
	}

	if (typeof migratedValue.createdAt !== 'string')
		issues.push(invalidManifest('The package manifest records no creation time'));

	if (!Array.isArray(packagedAssets))
		issues.push(invalidManifest('The package manifest declares no packaged assets'));
	if (!Array.isArray(contents))
		issues.push(invalidManifest('The package manifest declares no content entries'));
	if (!Array.isArray(applicationCapabilities))
		issues.push(invalidManifest('The package manifest declares no application capabilities'));
	if (issues.length > 0)
		return { outcome: 'rejected', issues };

	const assets: TemplatePackageAsset[] = [];
	const packagedIds = new Set<string>();
	const declaredOrigins = new Set<string>();
	for (const [index, candidate] of (packagedAssets as unknown[]).entries()) {
		const read = readPackagedAsset(candidate, index);
		if ('issues' in read) {
			issues.push(...read.issues);
			continue;
		}
		if (packagedIds.has(read.asset.packagedId)) {
			issues.push(invalidManifest(
				'The package declares the same packaged identity twice',
				`packagedAssets[${index}]`,
			));
			continue;
		}
		// One source revision is one local revision. Two packaged identities
		// claiming the same provenance cannot both map: a Template field naming
		// that origin has two candidate mappings and no way to choose, and the
		// origin row itself can only record one of them. Neither is a partial
		// installation worth attempting, so the package is refused.
		const originKey = packagedOriginKey(read.asset.origin);
		if (declaredOrigins.has(originKey)) {
			issues.push(templatePackagePreflightIssue('duplicate-packaged-origin', {
				subject: read.asset.packagedId,
				message: `"${read.asset.name}" claims a source identity and revision another packaged asset already claims`,
			}));
			continue;
		}
		declaredOrigins.add(originKey);
		packagedIds.add(read.asset.packagedId);
		assets.push(read.asset);
	}

	const contentDigests = new Set<string>();
	for (const [index, candidate] of (contents as unknown[]).entries()) {
		const subject = `contents[${index}]`;
		if (
			!isPlainObject(candidate)
			|| typeof candidate.digest !== 'string'
			|| !DIGEST.test(candidate.digest)
			|| !Number.isSafeInteger(candidate.byteLength)
			|| (candidate.byteLength as number) < 0
			|| typeof candidate.canonicalMime !== 'string'
			|| !CANONICAL_MIMES.has(candidate.canonicalMime)
			|| candidate.entry !== templatePackageContentEntry(candidate.digest)
		) {
			issues.push(invalidManifest('Content entry is unusable', subject));
			continue;
		}
		if (contentDigests.has(candidate.digest)) {
			issues.push(invalidManifest('The package declares the same content entry twice', subject));
			continue;
		}
		contentDigests.add(candidate.digest);
	}

	for (const [index, capability] of (applicationCapabilities as unknown[]).entries()) {
		if (
			!isPlainObject(capability)
			|| typeof capability.capability !== 'string'
			|| !(TEMPLATE_PACKAGE_CAPABILITY_KINDS as readonly string[]).includes(capability.capability)
			|| !isNonEmptyString(capability.identity)
			|| !Array.isArray(capability.requiredBy)
		) {
			issues.push(invalidManifest('Application capability declaration is unusable', `applicationCapabilities[${index}]`));
		}
	}

	for (const asset of assets) {
		if (!contentDigests.has(asset.integrity.digest)) {
			issues.push(templatePackagePreflightIssue('missing-package-entry', {
				subject: asset.packagedId,
				message: `Packaged asset "${asset.name}" names content the manifest never declares`,
			}));
		}
	}

	if (assets.length > TEMPLATE_PACKAGE_LIMITS.maximumPackagedRevisionCount) {
		issues.push(templatePackagePreflightIssue('packaged-revision-limit-exceeded', {
			message: `The package declares ${assets.length} packaged Graphic Asset Revisions, beyond the ${TEMPLATE_PACKAGE_LIMITS.maximumPackagedRevisionCount} limit`,
		}));
	}

	// The totals are the manifest's own account of the envelope. A manifest that
	// miscounts itself cannot be used to check the envelope's limits.
	if (
		!isPlainObject(totals)
		|| totals.packagedAssetCount !== assets.length
		|| totals.packagedRevisionCount !== assets.length
		|| totals.uniqueContentCount !== contentDigests.size
		|| totals.entryCount !== contentDigests.size + 2
		|| !Number.isSafeInteger(totals.expandedByteLength)
	) {
		issues.push(invalidManifest('The package manifest does not agree with its own totals'));
	}

	if (issues.length > 0)
		return { outcome: 'rejected', issues };

	return {
		outcome: 'read',
		result: {
			manifest: migratedValue as unknown as TemplatePackageManifest,
			receivedSchemaVersion: schemaVersion,
			migrated: schemaVersion !== TEMPLATE_PACKAGE_SCHEMA_VERSION,
		},
	};
}

/**
 * Reconciles what the archive carries against what the manifest declares. A
 * package contains its manifest, its Template, and exactly one content entry per
 * declared digest: anything else present is undeclared, and anything declared
 * but absent leaves the Template incomplete.
 */
export function inspectTemplatePackageEntries(
	entries: readonly TemplatePackageArchiveEntry[],
	manifest: TemplatePackageManifest,
): TemplatePackagePreflightIssue[] {
	const issues: TemplatePackagePreflightIssue[] = [];
	const declared = new Map<string, number>([
		[TEMPLATE_PACKAGE_MANIFEST_ENTRY, Number.NaN],
		[TEMPLATE_PACKAGE_TEMPLATE_ENTRY, Number.NaN],
		...manifest.contents.map(content => [content.entry, content.byteLength] as const),
	]);
	const present = new Set(entries.map(entry => entry.name));
	for (const entry of entries) {
		const declaredByteLength = declared.get(entry.name);
		if (declaredByteLength === undefined) {
			issues.push(templatePackagePreflightIssue('undeclared-package-entry', {
				subject: entry.name,
				message: 'The archive carries an entry the manifest never declares',
			}));
			continue;
		}
		// The manifest states a size only for content; the manifest and Template
		// entries are measured by the archive alone.
		if (Number.isSafeInteger(declaredByteLength) && declaredByteLength !== entry.byteLength) {
			issues.push(templatePackagePreflightIssue('inconsistent-package-entry-size', {
				subject: entry.name,
				message: `The manifest declares ${declaredByteLength} bytes but the archive carries ${entry.byteLength}`,
			}));
		}
	}
	for (const name of declared.keys()) {
		if (!present.has(name)) {
			issues.push(templatePackagePreflightIssue('missing-package-entry', {
				subject: name,
				message: 'The manifest declares an entry the archive does not carry',
			}));
		}
	}
	return issues;
}

/**
 * Refuses an entry that is itself an archive. Nested archives are how content a
 * receiver never validated travels inside one it did, so they are recognised by
 * their own leading bytes rather than by what the manifest called them.
 */
const ARCHIVE_SIGNATURES: readonly { offset: number; bytes: readonly number[] }[] = [
	{ offset: 0, bytes: [0x50, 0x4B, 0x03, 0x04] },
	{ offset: 0, bytes: [0x50, 0x4B, 0x05, 0x06] },
	{ offset: 0, bytes: [0x50, 0x4B, 0x07, 0x08] },
	{ offset: 0, bytes: [0x1F, 0x8B] },
	{ offset: 0, bytes: [0x42, 0x5A, 0x68] },
	{ offset: 0, bytes: [0xFD, 0x37, 0x7A, 0x58, 0x5A] },
	{ offset: 0, bytes: [0x28, 0xB5, 0x2F, 0xFD] },
	{ offset: 0, bytes: [0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C] },
	{ offset: 0, bytes: [0x52, 0x61, 0x72, 0x21] },
	// A tar has no header magic at all: `ustar` sits at byte 257 of its first
	// 512-byte block, after the name, mode, owner, size, and mtime fields.
	{ offset: 257, bytes: [0x75, 0x73, 0x74, 0x61, 0x72] },
];

/**
 * The bytes of an entry a nested-archive check needs to see. It covers a
 * complete tar header block so the one signature that is not at the start of
 * the file can still be found.
 */
export const NESTED_ARCHIVE_PROBE_BYTES = 512;

export function hasNestedArchiveSignature(leadingBytes: Uint8Array): boolean {
	return ARCHIVE_SIGNATURES.some(signature =>
		signature.bytes.every((byte, index) => leadingBytes[signature.offset + index] === byte),
	);
}

/**
 * How one packaged identity relates to what this installation already holds.
 * Preflight resolves it once, and the answer decides both the proposal and
 * whether the author has to confirm anything.
 */
export interface LocalOriginMatch {
	/** The exact local revision recording this source identity and revision. */
	reference: GraphicAssetReference;
	/** That revision's content digest, which must equal the packaged digest. */
	digest: string;
	name: string;
	/**
	 * Whether that revision's Graphic Asset can still take a reference. Only an
	 * active asset can, and a proposal that reused a Retired or Trashed one would
	 * be refused at the last possible moment instead of here.
	 */
	lifecycleState: GraphicAssetLifecycleState;
}

export interface TemplatePackageMappingInput {
	asset: TemplatePackageAsset;
	/** A local revision carrying this exact source identity and source revision. */
	originMatch?: LocalOriginMatch;
	/** A local revision carrying the same source identity at another revision. */
	relatedOriginExists: boolean;
	/** Whether the canonical byte store already holds the packaged digest. */
	contentAlreadyStored: boolean;
	/**
	 * Whether an earlier mapping in this same package already accounts for these
	 * bytes. Two packaged identities sharing one content entry install two Graphic
	 * Assets but store the bytes once, so only the first is charged for them.
	 */
	contentCountedByAnotherMapping: boolean;
	/** A local asset already backed by these exact bytes under other provenance. */
	sharedContentName?: string;
	/** Whether the revalidated content is restricted to particular targets. */
	compatibilityRestricted: boolean;
}

export interface TemplatePackageMappingOutcome {
	mapping: TemplatePackagePreflightMapping;
	issues: TemplatePackagePreflightIssue[];
}

/**
 * Decides one packaged identity's proposed local mapping.
 *
 * Exact provenance is the only thing that reuses an existing revision, and it
 * reuses it untouched: a repeated import stays stable and never overwrites
 * locally curated metadata. Everything else creates a separate Graphic Asset, so
 * a package can share stored bytes but can never mutate an identity, its
 * provenance, or its history. An exact origin whose digest disagrees is an
 * immutable-provenance conflict, which rejects the complete package.
 */
export function templatePackageMappingProposal(
	input: TemplatePackageMappingInput,
): TemplatePackageMappingOutcome {
	const { asset } = input;
	const issues: TemplatePackagePreflightIssue[] = [];
	const base = {
		packagedId: asset.packagedId,
		name: asset.name,
		kind: asset.kind,
		origin: asset.origin,
		contentAlreadyStored: input.contentAlreadyStored,
	} as const;

	if (input.compatibilityRestricted) {
		issues.push(templatePackagePreflightIssue('graphic-asset-compatibility-restricted', {
			subject: asset.packagedId,
			message: `"${asset.name}" plays only on targets that prove the capability it requires`,
		}));
	}

	if (input.originMatch) {
		// A Retired asset takes no new references and a Trashed one takes none
		// either, so a proposal to reuse either could never be installed. Saying so
		// here is the difference between an author restoring the asset and retrying,
		// and an author watching every attempt fail at the final transaction with
		// nothing to act on. It stays retryable because restoring is the fix.
		if (input.originMatch.lifecycleState !== 'active') {
			issues.push(templatePackagePreflightIssue('graphic-asset-origin-not-referenceable', {
				subject: asset.packagedId,
				message: `"${input.originMatch.name}" is ${
					input.originMatch.lifecycleState === 'retired' ? 'Retired' : 'in Trash'
				} here, so this package cannot reference the revision it reuses`,
			}));
		}
		if (input.originMatch.digest !== asset.origin.digest) {
			issues.push(templatePackagePreflightIssue('immutable-origin-digest-conflict', {
				subject: asset.packagedId,
				message: `"${asset.name}" claims an origin this installation already records with different content`,
			}));
			return {
				issues,
				mapping: {
					...base,
					proposal: 'create-graphic-asset',
					basis: 'exact-origin',
					canonicalGrowthBytes: 0,
					localName: input.originMatch.name,
				},
			};
		}
		if (input.originMatch.name !== asset.name) {
			issues.push(templatePackagePreflightIssue('graphic-asset-name-differs', {
				subject: asset.packagedId,
				message: `The package calls this asset "${asset.name}"; this library records it as "${input.originMatch.name}"`,
			}));
		}
		return {
			issues,
			mapping: {
				...base,
				proposal: 'reuse-graphic-asset-revision',
				basis: 'exact-origin',
				reference: input.originMatch.reference,
				// Reuse adds nothing: the bytes and the revision both already exist.
				canonicalGrowthBytes: 0,
				localName: input.originMatch.name,
			},
		};
	}

	const basis = input.relatedOriginExists
		? 'related-origin-revision'
		: input.sharedContentName !== undefined
			? 'shared-content-digest'
			: 'new-content';
	if (basis === 'related-origin-revision') {
		issues.push(templatePackagePreflightIssue('graphic-asset-created-from-related-origin', {
			subject: asset.packagedId,
			message: `"${asset.name}" is a different revision of a source this installation has already imported`,
		}));
	}
	if (basis === 'shared-content-digest') {
		issues.push(templatePackagePreflightIssue('graphic-asset-created-from-shared-content', {
			subject: asset.packagedId,
			message: `"${asset.name}" carries content this installation already stores as "${input.sharedContentName}"`,
		}));
	}
	return {
		issues,
		mapping: {
			...base,
			proposal: 'create-graphic-asset',
			basis,
			canonicalGrowthBytes: input.contentAlreadyStored || input.contentCountedByAnotherMapping
				? 0
				: asset.integrity.byteLength,
			localName: input.sharedContentName,
		},
	};
}

/**
 * Checks the application capabilities a package declares against the ones this
 * installation actually provides, reusing the same rule export applies so a
 * package this installation could not produce is one it will not install.
 */
export function inspectReceivedApplicationCapabilities(
	manifest: TemplatePackageManifest,
): TemplatePackagePreflightIssue[] {
	const { issues } = inspectTemplatePackageCapabilities(
		manifest.applicationCapabilities.map(declaration => ({
			slot: declaration.requiredBy[0] ?? declaration.identity,
			capability: declaration.capability as TemplatePackageCapabilityKind,
			identity: declaration.identity,
			configurationVersion: declaration.configurationVersion,
		})),
	);
	return issues.map(issue => templatePackagePreflightIssue('unsupported-application-capability', {
		subject: issue.slot,
		message: issue.message,
	}));
}

export interface TemplatePackagePreflightReportInput {
	packageKind: TemplatePackageKind;
	templateIdentity: string;
	templateName: string;
	templateRevision?: number;
	checkedAt: string;
	/** The digest of the exact received archive bytes. */
	sourceDigest: string;
	schema: TemplatePackagePreflightReport['schema'];
	compatibilityProfiles: readonly string[];
	issues: readonly TemplatePackagePreflightIssue[];
	mappings: readonly TemplatePackagePreflightMapping[];
	quota: TemplatePackagePreflightQuota;
	observed: TemplatePackageTotals & { archiveByteLength: number };
}

/**
 * The exact material a confirmation is bound to.
 *
 * It covers the received bytes, the compatibility profiles the content was
 * judged under, the complete proposal, and every issue that proposal carries —
 * and deliberately not the clock. A retry that reaches an identical conclusion
 * keeps the author's confirmation valid, while any change to the package, the
 * library's profiles, or the proposed result produces a different fingerprint
 * and so requires a new report and a new confirmation.
 */
export function templatePackagePreflightFingerprintMaterial(
	input: Omit<TemplatePackagePreflightReportInput, 'checkedAt'>,
): string {
	return JSON.stringify({
		sourceDigest: input.sourceDigest,
		packageKind: input.packageKind,
		templateIdentity: input.templateIdentity,
		templateName: input.templateName,
		// Part of the provenance the installed copy keeps, so a confirmation is bound
		// to the revision it was shown as much as to the identity.
		templateRevision: input.templateRevision ?? null,
		schema: input.schema,
		compatibilityProfiles: [...input.compatibilityProfiles].sort(),
		quotaGrowthBytes: input.quota.canonicalGrowthBytes,
		observed: input.observed,
		// Every field the author reads is covered, not just the structural ones.
		// A mapping whose displayed name changed is a different proposal to the
		// person confirming it, however identical its shape.
		mappings: input.mappings.map(mapping => ({
			packagedId: mapping.packagedId,
			name: mapping.name,
			kind: mapping.kind,
			origin: mapping.origin,
			proposal: mapping.proposal,
			basis: mapping.basis,
			reference: mapping.reference ?? null,
			contentAlreadyStored: mapping.contentAlreadyStored,
			canonicalGrowthBytes: mapping.canonicalGrowthBytes,
			localName: mapping.localName ?? null,
		})),
		issues: input.issues.map(issue => ({
			code: issue.code,
			severity: issue.severity,
			subject: issue.subject ?? null,
			// The message carries the specifics a code cannot — which local asset
			// the content matched, which name differs — so it is part of what was
			// agreed to.
			message: issue.message,
		})),
	});
}

function issueOrder(issue: TemplatePackagePreflightIssue) {
	return `${issue.severity === 'error' ? '0' : '1'} ${issue.subject ?? ''} ${issue.code}`;
}

/**
 * Assembles the one immutable report. Errors make it terminal, warnings make it
 * pause exactly once, and an entirely clean proposal needs no confirmation at
 * all — so an author is asked to confirm only what they could actually change
 * their mind about.
 */
export function assembleTemplatePackagePreflightReport(
	input: TemplatePackagePreflightReportInput & { fingerprint: string },
): TemplatePackagePreflightReport {
	const issues = [...input.issues].sort((left, right) =>
		issueOrder(left).localeCompare(issueOrder(right)),
	);
	const hasError = issues.some(issue => issue.severity === 'error');
	return {
		packageKind: input.packageKind,
		templateIdentity: input.templateIdentity,
		templateName: input.templateName,
		templateRevision: input.templateRevision,
		checkedAt: input.checkedAt,
		fingerprint: input.fingerprint,
		schema: input.schema,
		compatibilityProfiles: [...input.compatibilityProfiles].sort(),
		issues,
		mappings: input.mappings,
		quota: input.quota,
		limits: TEMPLATE_PACKAGE_LIMITS,
		observed: input.observed,
		outcome: hasError
			? 'rejected'
			: issues.length > 0
				? 'requires-confirmation'
				: 'ready',
	};
}

/**
 * One Template Package operation's durable preflight checkpoint.
 *
 * The report is immutable once written. A confirmation records the exact
 * fingerprint it accepted, so a later run that reaches a different conclusion
 * cannot inherit it, and a run that reaches the same conclusion does not ask the
 * author again.
 *
 * Derivatives record only what preflight proved it could produce: the digest and
 * size of each regenerated preview, by packaged identity. The bytes themselves
 * are deliberately not staged — generation is deterministic, installation must
 * read the staged archive anyway, and a per-derivative staged object would be a
 * new class of state that cancellation, staged-input expiry, and the staging
 * reservation would all have to learn to reclaim. So this is a record of proof
 * and of quota cost, not a cache a retry reads back.
 */
export interface TemplatePackagePreflightState {
	report: TemplatePackagePreflightReport;
	confirmedFingerprint?: string;
	confirmedAt?: string;
	derivatives: {
		packagedId: string;
		digest: string;
		byteLength: number;
	}[];
}

/**
 * Whether this preflight result may proceed to installation without asking the
 * author anything further. A clean proposal needs no confirmation; a proposal
 * carrying warnings needs one bound to this exact fingerprint.
 */
export function templatePackagePreflightConfirmed(
	state: TemplatePackagePreflightState,
): boolean {
	if (state.report.outcome === 'rejected')
		return false;
	return state.report.outcome === 'ready'
		|| state.confirmedFingerprint === state.report.fingerprint;
}
