import type { InstalledGraphicStyleSetFacts } from '~~/shared/modules/graphic-style-sets';
import type {
	AffectedGraphicsTemplate,
	GraphicStyleSetEntry,
	GraphicStyleSetPublishIssue,
} from '~~/shared/types/graphicStyleSet';
import type {
	GraphicStyleSetPackageDisposition,
	GraphicStyleSetPackagePreflightIssue,
	GraphicStyleSetPackagePreflightReport,
	GraphicStyleSetPackageProvenance,
	GraphicStyleSetPackageResolution,
	GraphicStyleSetSnapshot,
} from '~~/shared/types/graphicStyleSetPackage';
import { sha256Hex } from '~~/server/modules/graphics-asset-library/png';
import { inspectTemplateDocument } from '~~/server/modules/graphics-asset-library/template-package';
import { readTemplatePackageArchive } from '~~/server/modules/graphics-asset-library/template-package-archive';
import { graphicStyleSetSnapshotSchema } from '~~/server/schemas/api/graphicStyleSet';
import {
	graphicStyleSetContentDigest,
	graphicStyleSetPackageCapabilities,
	graphicStyleSetPackageDisposition,
	graphicStyleSetPackageIssue,
	readGraphicStyleSetPackageManifest,
	validateGraphicStyleSetDraft,
} from '~~/shared/modules/graphic-style-sets';
import { GRAPHIC_FONT_IDS } from '~~/shared/modules/graphics';
import {
	GRAPHIC_STYLE_SET_PACKAGE_EXTENSION,
	GRAPHIC_STYLE_SET_PACKAGE_KIND,
	GRAPHIC_STYLE_SET_PACKAGE_LIMITS,
	GRAPHIC_STYLE_SET_PACKAGE_MANIFEST_ENTRY,
	GRAPHIC_STYLE_SET_PACKAGE_SCHEMA_VERSION,
	GRAPHIC_STYLE_SET_PACKAGE_STYLE_SET_ENTRY,
} from '~~/shared/types/graphicStyleSetPackage';
import {
	graphicStyleSetPackageEnvelopeCode,
	graphicStyleSetPackageEnvelopeIssue,
} from './issues';

/**
 * The complete inspection a received `.skstyle` passes before anything may be
 * installed from it.
 *
 * Every check runs even after an earlier one failed, so an author sees the complete
 * reason a package cannot install rather than correcting one problem at a time. The
 * result is immutable and fingerprinted: the fingerprint covers the received bytes,
 * the resolution the author asked for, the disposition it produced, and every issue
 * that disposition carries, so any change to the package, to this library, or to the
 * proposal invalidates a confirmation rather than silently installing something else.
 *
 * ## Why there is no staging
 *
 * A Template Package stages its bytes durably because it carries media: transfers take
 * minutes, quota has to be reserved, and derivatives have to be regenerated before
 * anything can be published. A Graphic Style Set carries none of that — it is two JSON
 * files bounded by the number of entries a Style Set may hold — so there is nothing to
 * resume and nothing to reserve. Preflight is a pure read of the received bytes, and
 * installation re-runs it over the same bytes and re-proves the fingerprint the author
 * confirmed before writing anything.
 */

/**
 * The first few schema failures, named by the field that caused them. Bounded because
 * a hostile package can produce an unbounded number of them, and a report an author
 * cannot read is not a better report.
 */
const MAXIMUM_REPORTED_SCHEMA_ISSUES = 10;

/**
 * The data-only inspection's findings that are about the envelope rather than about a
 * Graphic Style Set, and so keep the envelope's own codes.
 *
 * A remote dependency and an undeclared asset mean the same thing whatever artifact
 * carried them. Executable content does not appear here because it is reported in the
 * Style Set's own vocabulary — the same code an export refuses it under, so one
 * condition is named one way on both sides of a transfer.
 */
const ENVELOPE_DOCUMENT_ISSUE_CODES = new Set([
	'remote-resource-dependency',
	'undeclared-graphic-asset-dependency',
]);

export interface GraphicStyleSetPackagePreflightInput {
	archive: Uint8Array;
	resolution: GraphicStyleSetPackageResolution;
	/** The received file name, where the transfer had one. A hint, never the authority. */
	sourceFileName?: string;
	/** The Style Set installed under a packaged identity, where one is. */
	findInstalled: (styleSetId: string) => Promise<InstalledGraphicStyleSetFacts | undefined>;
	/**
	 * Every template linked to that identity, and whether the *packaged* entries would
	 * actually change what it renders.
	 *
	 * The entries are supplied rather than read back, because the question is what this
	 * install would do — a template whose referenced entries are identical in the
	 * package receives no update at all, which is exactly what an ordinary publish
	 * computes and for the same reason.
	 */
	findLinkedTemplates: (
		styleSetId: string,
		entries: readonly GraphicStyleSetEntry[],
	) => Promise<AffectedGraphicsTemplate[]>;
	now: () => Date;
}

export interface GraphicStyleSetPackagePreflightOutcome {
	report: GraphicStyleSetPackagePreflightReport;
	/** The snapshot exactly as it travelled, present only when it could be read. */
	snapshot?: GraphicStyleSetSnapshot;
}

function issueOrder(issue: GraphicStyleSetPackagePreflightIssue) {
	return `${issue.severity === 'error' ? '0' : '1'} ${issue.subject ?? ''} ${issue.code}`;
}

/**
 * The exact material a confirmation is bound to.
 *
 * It covers the received bytes, what the author asked for, what that produced, and
 * everything the author read while deciding — and deliberately not the clock. A retry
 * reaching an identical conclusion keeps the confirmation valid; any change to the
 * package, the library, or the proposal produces a different fingerprint.
 */
function fingerprintMaterial(input: {
	sourceDigest: string;
	resolution: GraphicStyleSetPackageResolution;
	disposition: GraphicStyleSetPackageDisposition;
	provenance?: GraphicStyleSetPackageProvenance;
	styleSetName?: string;
	targetStyleSetId?: string;
	installedRevision?: number;
	installedDraftRevision?: number;
	affectedTemplates: readonly AffectedGraphicsTemplate[];
	issues: readonly GraphicStyleSetPackagePreflightIssue[];
}): string {
	return JSON.stringify({
		sourceDigest: input.sourceDigest,
		packageKind: GRAPHIC_STYLE_SET_PACKAGE_KIND,
		resolution: input.resolution,
		disposition: input.disposition,
		provenance: input.provenance ?? null,
		styleSetName: input.styleSetName ?? null,
		targetStyleSetId: input.targetStyleSetId ?? null,
		installedRevision: input.installedRevision ?? null,
		// Part of what a confirmation is bound to, because it is the token the write
		// compare-and-swaps on: a draft edit after this report changes the fingerprint.
		installedDraftRevision: input.installedDraftRevision ?? null,
		affectedTemplates: input.affectedTemplates.map(template => ({
			id: template.id,
			name: template.name,
			revision: template.revision,
			styleChanged: template.styleChanged,
		})),
		// Every field the author reads is covered, not just the structural ones: a
		// message carries the specifics a code cannot, so it is part of what was agreed.
		issues: input.issues.map(issue => ({
			code: issue.code,
			severity: issue.severity,
			subject: issue.subject ?? null,
			message: issue.message,
		})),
	});
}

export async function graphicStyleSetPackagePreflight(
	input: GraphicStyleSetPackagePreflightInput,
): Promise<GraphicStyleSetPackagePreflightOutcome> {
	const checkedAt = input.now().toISOString();
	const archiveByteLength = input.archive.byteLength;
	const sourceDigest = await sha256Hex(input.archive);
	const issues: GraphicStyleSetPackagePreflightIssue[] = [];
	const decoder = new TextDecoder('utf-8', { fatal: true });

	let schema = {
		received: 0,
		supported: GRAPHIC_STYLE_SET_PACKAGE_SCHEMA_VERSION,
		migrated: false,
	};
	let provenance: GraphicStyleSetPackageProvenance | undefined;
	let styleSetName: string | undefined;
	let styleSetEntryCount: number | undefined;
	let snapshot: GraphicStyleSetSnapshot | undefined;
	let disposition: GraphicStyleSetPackageDisposition = 'rejected';
	let targetStyleSetId: string | undefined;
	let installedRevision: number | undefined;
	let installedDraftRevision: number | undefined;
	let affectedTemplates: AffectedGraphicsTemplate[] = [];
	let publishIssues: GraphicStyleSetPublishIssue[] = [];
	let observedArchiveEntryCount = 0;
	let observedExpandedByteLength = 0;

	async function finish(): Promise<GraphicStyleSetPackagePreflightOutcome> {
		const sorted = [...issues].sort((left, right) =>
			issueOrder(left).localeCompare(issueOrder(right)),
		);
		const hasError = sorted.some(issue => issue.severity === 'error');
		const settled: GraphicStyleSetPackageDisposition = hasError ? 'rejected' : disposition;
		const fingerprint = await sha256Hex(new TextEncoder().encode(fingerprintMaterial({
			sourceDigest,
			resolution: input.resolution,
			disposition: settled,
			provenance,
			styleSetName,
			targetStyleSetId,
			installedRevision,
			installedDraftRevision,
			affectedTemplates,
			issues: sorted,
		})));
		return {
			// A snapshot is handed back only when installing it is on the table. A
			// rejected report must not leave a caller holding entries it could write.
			snapshot: hasError ? undefined : snapshot,
			report: {
				packageKind: GRAPHIC_STYLE_SET_PACKAGE_KIND,
				checkedAt,
				fingerprint,
				schema,
				provenance,
				styleSetName,
				styleSetEntryCount,
				resolution: input.resolution,
				disposition: settled,
				targetStyleSetId,
				installedRevision,
				installedDraftRevision,
				affectedTemplates,
				publishIssues,
				issues: sorted,
				limits: GRAPHIC_STYLE_SET_PACKAGE_LIMITS,
				observed: {
					archiveByteLength,
					archiveEntryCount: observedArchiveEntryCount,
					expandedByteLength: observedExpandedByteLength,
				},
				outcome: hasError
					? 'rejected'
					// Nothing about an already-installed package is a decision: confirming it
					// would change nothing, so the author is told rather than asked.
					: sorted.length === 0 || settled === 'already-installed'
						? 'ready'
						: 'requires-confirmation',
			},
		};
	}

	if (archiveByteLength > GRAPHIC_STYLE_SET_PACKAGE_LIMITS.maximumArchiveByteLength) {
		issues.push(graphicStyleSetPackageEnvelopeIssue('package-archive-limit-exceeded', {
			message: `The received archive is ${archiveByteLength} bytes, beyond the ${GRAPHIC_STYLE_SET_PACKAGE_LIMITS.maximumArchiveByteLength}-byte limit`,
		}));
		return await finish();
	}

	// The received file name is a hint, and the manifest alone determines the artifact
	// type — so a package transferred without a name is not penalised for it. When one
	// is supplied it must not contradict the manifest.
	const receivedName = input.sourceFileName?.toLowerCase();
	if (receivedName !== undefined && !receivedName.endsWith(GRAPHIC_STYLE_SET_PACKAGE_EXTENSION)) {
		issues.push(graphicStyleSetPackageEnvelopeIssue('unsupported-package-artifact', {
			subject: input.sourceFileName,
			message: `A Graphic Style Set Package must be received as a "${GRAPHIC_STYLE_SET_PACKAGE_EXTENSION}" file`,
		}));
	}

	const archiveRead = await readTemplatePackageArchive({
		byteLength: archiveByteLength,
		read: async (offset, length) => input.archive.slice(offset, offset + length),
	});
	if (archiveRead.outcome === 'rejected') {
		for (const issue of archiveRead.issues) {
			issues.push(graphicStyleSetPackageEnvelopeIssue(
				graphicStyleSetPackageEnvelopeCode(issue.code),
				{ subject: issue.subject, message: issue.message },
			));
		}
		return await finish();
	}

	const archiveEntries = archiveRead.entries;
	observedArchiveEntryCount = archiveEntries.length;
	observedExpandedByteLength = archiveEntries.reduce((total, entry) => total + entry.byteLength, 0);
	if (observedArchiveEntryCount > GRAPHIC_STYLE_SET_PACKAGE_LIMITS.maximumEntryCount) {
		issues.push(graphicStyleSetPackageEnvelopeIssue('package-entry-limit-exceeded', {
			message: `The archive carries ${observedArchiveEntryCount} files; a Graphic Style Set Package carries ${GRAPHIC_STYLE_SET_PACKAGE_LIMITS.maximumEntryCount}`,
		}));
	}
	if (observedExpandedByteLength > GRAPHIC_STYLE_SET_PACKAGE_LIMITS.maximumExpandedByteLength) {
		issues.push(graphicStyleSetPackageEnvelopeIssue('package-expanded-limit-exceeded', {
			message: `The archive expands to ${observedExpandedByteLength} bytes`,
		}));
	}

	const entryByName = new Map(archiveEntries.map(entry => [entry.name, entry]));
	for (const entry of archiveEntries) {
		if (
			entry.name !== GRAPHIC_STYLE_SET_PACKAGE_MANIFEST_ENTRY
			&& entry.name !== GRAPHIC_STYLE_SET_PACKAGE_STYLE_SET_ENTRY
		) {
			issues.push(graphicStyleSetPackageEnvelopeIssue('undeclared-package-entry', {
				subject: entry.name,
				message: 'The archive carries a file a Graphic Style Set Package never declares',
			}));
		}
	}

	function readEntryDocument(name: string): unknown | undefined {
		const entry = entryByName.get(name);
		if (!entry || entry.byteLength > GRAPHIC_STYLE_SET_PACKAGE_LIMITS.maximumDocumentByteLength)
			return undefined;
		try {
			return JSON.parse(decoder.decode(
				input.archive.slice(entry.dataOffset, entry.dataOffset + entry.byteLength),
			));
		}
		catch {
			return undefined;
		}
	}

	if (!entryByName.has(GRAPHIC_STYLE_SET_PACKAGE_MANIFEST_ENTRY)) {
		issues.push(graphicStyleSetPackageEnvelopeIssue('missing-package-entry', {
			subject: GRAPHIC_STYLE_SET_PACKAGE_MANIFEST_ENTRY,
			message: 'The archive carries no package manifest',
		}));
		return await finish();
	}
	const manifestValue = readEntryDocument(GRAPHIC_STYLE_SET_PACKAGE_MANIFEST_ENTRY);
	if (manifestValue === undefined) {
		issues.push(graphicStyleSetPackageEnvelopeIssue('invalid-package-manifest', {
			subject: GRAPHIC_STYLE_SET_PACKAGE_MANIFEST_ENTRY,
			message: 'The package manifest is not readable JSON within the size a manifest may occupy',
		}));
		return await finish();
	}
	const manifestRead = readGraphicStyleSetPackageManifest(manifestValue);
	if (manifestRead.outcome === 'rejected') {
		for (const issue of manifestRead.issues) {
			issues.push(graphicStyleSetPackageEnvelopeIssue(issue.code, {
				subject: issue.subject,
				message: issue.message,
			}));
		}
		return await finish();
	}

	const { manifest, receivedSchemaVersion, migrated } = manifestRead.result;
	schema = {
		received: receivedSchemaVersion,
		supported: GRAPHIC_STYLE_SET_PACKAGE_SCHEMA_VERSION,
		migrated,
	};
	styleSetName = manifest.styleSet.name;
	styleSetEntryCount = manifest.styleSet.entryCount;
	provenance = {
		sourceStyleSetId: manifest.styleSet.identity,
		sourceRevision: manifest.styleSet.revision,
		contentDigest: manifest.styleSet.contentDigest,
	};
	// A migration changed nothing the sender chose, but the author still confirms the
	// result they are about to install.
	if (migrated) {
		issues.push(graphicStyleSetPackageIssue('package-schema-migrated', {
			message: `The package was migrated from schema version ${receivedSchemaVersion} to ${GRAPHIC_STYLE_SET_PACKAGE_SCHEMA_VERSION} while it was read`,
		}));
	}

	// Every declared font must be one this installation has. The check is the same one
	// publish applies, so a package this installation accepts is one it can publish.
	for (const capability of manifest.applicationCapabilities) {
		if (!(GRAPHIC_FONT_IDS as readonly string[]).includes(capability.identity)) {
			issues.push(graphicStyleSetPackageEnvelopeIssue('unsupported-application-capability', {
				subject: capability.requiredBy[0] ?? capability.identity,
				message: `This installation does not provide application font "${capability.identity}"`,
			}));
		}
	}

	if (!entryByName.has(GRAPHIC_STYLE_SET_PACKAGE_STYLE_SET_ENTRY)) {
		issues.push(graphicStyleSetPackageEnvelopeIssue('missing-package-entry', {
			subject: GRAPHIC_STYLE_SET_PACKAGE_STYLE_SET_ENTRY,
			message: 'The archive carries no Graphic Style Set document',
		}));
		return await finish();
	}
	const snapshotValue = readEntryDocument(GRAPHIC_STYLE_SET_PACKAGE_STYLE_SET_ENTRY);
	if (snapshotValue === undefined) {
		issues.push(graphicStyleSetPackageIssue('invalid-graphic-style-set-document', {
			subject: GRAPHIC_STYLE_SET_PACKAGE_STYLE_SET_ENTRY,
			message: 'The Graphic Style Set document is not readable JSON within the size one may occupy',
		}));
		return await finish();
	}

	// The envelope proves the document is *data*. Only reading it as a Graphic Style Set
	// proves it is the artifact the package claims.
	const inspected = inspectTemplateDocument(snapshotValue);
	for (const documentIssue of inspected.issues) {
		if (ENVELOPE_DOCUMENT_ISSUE_CODES.has(documentIssue.code)) {
			issues.push(graphicStyleSetPackageEnvelopeIssue(
				graphicStyleSetPackageEnvelopeCode(documentIssue.code),
				{ subject: documentIssue.slot, message: documentIssue.message },
			));
			continue;
		}
		issues.push(graphicStyleSetPackageIssue(
			documentIssue.code === 'executable-template-content'
				? 'executable-graphic-style-set-content'
				: 'invalid-graphic-style-set-document',
			{ subject: documentIssue.slot, message: documentIssue.message },
		));
	}
	for (const discovered of inspected.references) {
		issues.push(graphicStyleSetPackageEnvelopeIssue('undeclared-graphic-asset-dependency', {
			subject: discovered.path,
			message: 'This Graphic Style Set requires a Graphic Asset Revision the package never carried',
		}));
	}

	const parsed = graphicStyleSetSnapshotSchema.safeParse(snapshotValue);
	if (!parsed.success) {
		const problems = parsed.error.issues;
		for (const problem of problems.slice(0, MAXIMUM_REPORTED_SCHEMA_ISSUES)) {
			issues.push(graphicStyleSetPackageIssue('invalid-graphic-style-set-document', {
				subject: problem.path.length > 0 ? problem.path.join('.') : undefined,
				message: problem.message,
			}));
		}
		if (problems.length > MAXIMUM_REPORTED_SCHEMA_ISSUES) {
			issues.push(graphicStyleSetPackageIssue('invalid-graphic-style-set-document', {
				message: `The Graphic Style Set document has ${problems.length} validation problems; the first ${MAXIMUM_REPORTED_SCHEMA_ISSUES} are reported`,
			}));
		}
		return await finish();
	}

	snapshot = parsed.data as GraphicStyleSetSnapshot;
	styleSetEntryCount = snapshot.entries.length;

	// Provenance and the document describe one Style Set, so a package that disagrees
	// with itself about which one cannot be mapped to anything.
	if (
		manifest.styleSet.identity !== snapshot.id
		|| manifest.styleSet.name !== snapshot.name
		|| manifest.styleSet.revision !== snapshot.revision
		|| manifest.styleSet.entryCount !== snapshot.entries.length
	) {
		issues.push(graphicStyleSetPackageEnvelopeIssue('invalid-package-manifest', {
			subject: 'styleSet',
			message: 'The package manifest and the Graphic Style Set it carries describe different Style Sets',
		}));
	}
	const observedDigest = await graphicStyleSetContentDigest(snapshot.entries);
	if (observedDigest !== manifest.styleSet.contentDigest) {
		issues.push(graphicStyleSetPackageEnvelopeIssue('package-content-digest-mismatch', {
			subject: GRAPHIC_STYLE_SET_PACKAGE_STYLE_SET_ENTRY,
			message: 'The packaged Graphic Style Set does not match the content digest its manifest records',
		}));
	}

	// The manifest is held to what the document actually requires. A package needing a
	// font it never declares is one no exporter here could have produced, and accepting
	// it would install a Style Set whose fonts were never checked against anything.
	const declaredFonts = new Set(manifest.applicationCapabilities.map(
		capability => capability.identity,
	));
	for (const required of graphicStyleSetPackageCapabilities(snapshot.entries)) {
		if (declaredFonts.has(required.identity))
			continue;
		issues.push(graphicStyleSetPackageEnvelopeIssue('unsupported-application-capability', {
			subject: required.requiredBy[0],
			message: `This Graphic Style Set requires application font "${required.identity}", which the package never declares`,
		}));
	}

	// Everything publish proves, over the entries as they travelled. A package whose
	// entries do not resolve here would install a published Style Set that every linked
	// template resolves against and gets nothing from.
	const validation = validateGraphicStyleSetDraft(snapshot.entries);
	publishIssues = validation.issues;
	if (publishIssues.length > 0) {
		issues.push(graphicStyleSetPackageIssue('graphic-style-set-unpublishable', {
			message: `The packaged Graphic Style Set has ${publishIssues.length} ${
				publishIssues.length === 1 ? 'entry that does not' : 'entries that do not'
			} resolve on this installation`,
		}));
	}

	const installed = await input.findInstalled(snapshot.id);
	installedRevision = installed?.revision;
	// Recorded, and covered by the fingerprint, because installation writes conditional
	// on it rather than on whatever the draft revision has become by then.
	installedDraftRevision = installed?.draftRevision;
	const decided = graphicStyleSetPackageDisposition({
		packaged: snapshot,
		installed,
		resolution: input.resolution,
	});
	disposition = decided.disposition;
	issues.push(...decided.issues);
	// An independent copy takes a local identity minted at installation, which is
	// deliberately not decided here: preflight is a pure read, and a report that named
	// an identity would name a different one on every retry and never keep a
	// confirmation valid.
	targetStyleSetId = disposition === 'install-independent-copy' ? undefined : snapshot.id;

	if (disposition === 'update-installed') {
		affectedTemplates = await input.findLinkedTemplates(snapshot.id, snapshot.entries);
		for (const template of affectedTemplates) {
			if (!template.styleChanged)
				continue;
			issues.push(graphicStyleSetPackageIssue('graphic-style-set-template-affected', {
				subject: template.id,
				message: `“${template.name}” will be offered an available style update`,
			}));
		}
	}

	return await finish();
}
