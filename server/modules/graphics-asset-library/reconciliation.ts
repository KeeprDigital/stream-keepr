import type {
	GraphicAssetId,
	GraphicAssetRevisionId,
	GraphicsAssetEvidenceEntry,
	GraphicsDerivativeId,
	GraphicsDiscrepancy,
	GraphicsDiscrepancyAction,
	GraphicsDiscrepancyActionOutcome,
	GraphicsDiscrepancyKind,
	GraphicsDiscrepancyReasonCode,
	GraphicsDiscrepancyResolution,
	GraphicsDiscrepancyState,
	GraphicsDiscrepancyUsage,
	GraphicsIngestionOperationId,
	GraphicsReconciliationEvidenceCategory,
	GraphicsReconciliationOverview,
	GraphicsReconciliationSweepResult,
	GraphicsRepairRejectionCode,
} from '~~/shared/types/graphicsAsset';
import type {
	BoundedByteStream,
	GraphicsCanonicalObjectStore,
	GraphicsObjectIdentity,
	GraphicsStagingObjectStore,
	ReadGraphicsObjectOutcome,
} from './object-store';
import {
	canonicalObjectDigest,
	GRAPHICS_CANONICAL_OBJECT_PREFIX,
	GRAPHICS_DISCREPANCY_KINDS,
	GRAPHICS_RECONCILIATION_ACTOR,
	GRAPHICS_RECONCILIATION_STAGE_BATCH,
	GRAPHICS_WORKING_COPY_LEASE_MILLISECONDS,
} from '~~/shared/utils/graphicsAssetReconciliation';
import {
	GRAPHICS_RETENTION_GUARANTEES,
	graphicsRetentionDeadline,
} from '~~/shared/utils/graphicsAssetRetention';
import { canonicalContentIdentity, canonicalObjectAgreement } from './canonical-integrity';
import { graphicsObjectIdentity } from './object-store';
import { stagedIngestionObjectIdentities } from './operation';

/**
 * The staged working copy one repair or regeneration owns.
 *
 * It is an ordinary staged-source identity under a reserved operation name, so
 * the pinned validation runtime can read it exactly as it reads any staged
 * source, and one identity is claimed, cleaned up, and leased everywhere.
 */
export function reconciliationWorkingCopyOperationId(discrepancyId: string): GraphicsIngestionOperationId {
	return `reconciliation-${discrepancyId}` as GraphicsIngestionOperationId;
}

export function reconciliationWorkingCopyIdentity(discrepancyId: string): GraphicsObjectIdentity {
	return stagedIngestionObjectIdentities(
		reconciliationWorkingCopyOperationId(discrepancyId),
	)[0]!;
}

/**
 * What the catalogue expects the byte store to hold for one Graphic Asset
 * Content, and what currently reaches it. Reachability decides which kind of
 * discrepancy a missing object is: content a revision reaches must be repaired
 * with exact bytes, while content only a Graphics Derivative reaches can be
 * regenerated from its source.
 */
export interface ExpectedGraphicAssetContent {
	digest: string;
	byteLength: number;
	canonicalMime: string;
	availability: 'available' | 'unavailable';
	revisionReach: number;
	derivativeReach: number;
	/**
	 * The validated source facts one retained revision recorded for these exact
	 * bytes. Every revision reaching one digest recorded the same facts, because
	 * the facts are derived from the bytes.
	 */
	source?: {
		kind: 'image' | 'silent-video' | 'font';
		facts: Record<string, unknown>;
	};
	derivative?: {
		id: GraphicsDerivativeId;
		kind: 'thumbnail' | 'video-poster' | 'font-specimen';
		sourceAssetId: GraphicAssetId;
		sourceRevisionId: GraphicAssetRevisionId;
		sourceDigest: string;
		sourceByteLength: number;
		sourceCanonicalMime: string;
		sourceKind: 'image' | 'silent-video' | 'font';
		sourceFacts: Record<string, unknown>;
	};
}

export interface GraphicsDiscrepancyRecord {
	id: string;
	kind: GraphicsDiscrepancyKind;
	subjectKey: string;
	digest?: string;
	objectKey?: string;
	derivativeId?: GraphicsDerivativeId;
	state: GraphicsDiscrepancyState;
	reasonCode: GraphicsDiscrepancyReasonCode;
	isolated: boolean;
	expected: GraphicsDiscrepancy['expected'];
	observed: GraphicsDiscrepancy['observed'];
	detectedAt: string;
	lastCheckedAt: string;
	resolvedAt?: string;
	resolution?: GraphicsDiscrepancyResolution;
	workingCopyKey?: string;
	workingCopySince?: string;
	correlationId: string;
}

export interface OpenGraphicsDiscrepancyInput {
	id: string;
	kind: GraphicsDiscrepancyKind;
	subjectKey: string;
	digest?: string;
	objectKey?: string;
	derivativeId?: GraphicsDerivativeId;
	reasonCode: GraphicsDiscrepancyReasonCode;
	isolated: boolean;
	expected: GraphicsDiscrepancy['expected'];
	observed: GraphicsDiscrepancy['observed'];
	observedAt: string;
	correlationId: string;
}

export interface GraphicsReconciliationStateRecord {
	canonicalScanCursor?: string;
	canonicalScanStartedAt?: string;
	lastSweepCorrelationId?: string;
	lastSweepStartedAt?: string;
	lastSweepCompletedAt?: string;
}

/**
 * The catalogue capabilities reconciliation needs. Like the retention
 * catalogue, each one is a transactional proof or a bounded observation rather
 * than a read followed by an unguarded write.
 */
export interface GraphicsAssetReconciliationCatalogue {
	/**
	 * Content the catalogue expects to reach, least recently reconciled first,
	 * so one bounded sweep eventually covers every expectation.
	 */
	listExpectedContent: (input: {
		limit: number;
	}) => Promise<ExpectedGraphicAssetContent[]>;
	findExpectedContent: (input: { digest: string }) => Promise<ExpectedGraphicAssetContent | undefined>;
	/** One set-based read for a whole queue, rather than one read per row. */
	findExpectedContents: (input: {
		digests: readonly string[];
	}) => Promise<Map<string, ExpectedGraphicAssetContent>>;
	listContentUsageForDigests: (input: {
		digests: readonly string[];
	}) => Promise<Map<string, GraphicsDiscrepancyUsage[]>>;
	findQuarantinedDigests: (input: {
		digests: readonly string[];
	}) => Promise<Map<string, { quarantinedAt: string; deleteAfter: string }>>;
	findRevisionContentDigest: (input: {
		assetId: GraphicAssetId;
		revisionId: GraphicAssetRevisionId;
	}) => Promise<string | undefined>;
	/** Records that a sweep compared this content against the byte store. */
	recordContentReconciled: (input: { digest: string; checkedAt: string }) => Promise<void>;
	/**
	 * Clears an advisory unavailable flag once the byte store has agreed again.
	 * It refuses while an isolated incident is open, so a critical integrity
	 * conflict can never be cleared by an ordinary observation.
	 */
	markContentAvailable: (input: { digest: string; restoredAt: string }) => Promise<boolean>;
	markContentUnavailable: (input: {
		digest: string;
		reasonCode: string;
		since: string;
	}) => Promise<void>;
	/** The digests, of those given, that the catalogue already accounts for. */
	filterAccountedDigests: (input: { digests: readonly string[] }) => Promise<Set<string>>;
	/**
	 * Quarantines bytes the catalogue never expected. It refuses if the digest
	 * became accounted for in the meantime, so an unexpected object is never
	 * quarantined out from under a publication that has just claimed it.
	 */
	quarantineUnexpectedObject: (input: {
		id: string;
		digest: string;
		byteLength: number;
		quarantinedAt: string;
		deleteAfter: string;
	}) => Promise<boolean>;
	findContentQuarantine: (input: { digest: string }) => Promise<
		{ id: string; quarantinedAt: string; deleteAfter: string } | undefined
	>;
	/** Releases quarantined bytes an administrator has just verified and restored. */
	releaseContentQuarantine: (input: { digest: string }) => Promise<boolean>;
	listContentUsage: (input: { digest: string }) => Promise<GraphicsDiscrepancyUsage[]>;
	openDiscrepancy: (input: OpenGraphicsDiscrepancyInput) => Promise<GraphicsDiscrepancyRecord>;
	findDiscrepancy: (input: { id: string }) => Promise<GraphicsDiscrepancyRecord | undefined>;
	/**
	 * Whether any isolated critical integrity incident is open against one
	 * content. Every action that would write bytes asks this first, so a repair
	 * can never land and then be reported as refused.
	 */
	hasOpenIsolatedIncident: (input: { digest: string }) => Promise<boolean>;
	listDiscrepancies: (input: {
		limit: number;
		states?: readonly GraphicsDiscrepancyState[];
		kinds?: readonly GraphicsDiscrepancyKind[];
	}) => Promise<GraphicsDiscrepancyRecord[]>;
	countOpenDiscrepancies: () => Promise<Record<GraphicsDiscrepancyKind, number>>;
	recordDiscrepancyObservation: (input: {
		id: string;
		observedAt: string;
		observed: GraphicsDiscrepancy['observed'];
	}) => Promise<void>;
	resolveDiscrepancy: (input: {
		id: string;
		resolvedAt: string;
		resolution: GraphicsDiscrepancyResolution;
	}) => Promise<boolean>;
	/** Resolves every open discrepancy about one digest, for a verified recovery. */
	resolveDiscrepanciesForDigest: (input: {
		digest: string;
		resolvedAt: string;
		resolution: GraphicsDiscrepancyResolution;
	}) => Promise<string[]>;
	/**
	 * Takes the exclusive right to stage a working copy for one discrepancy. The
	 * claim is durable so a crashed action leaves a trace a later sweep reclaims
	 * rather than leaking staged bytes.
	 */
	claimDiscrepancyWorkingCopy: (input: {
		id: string;
		workingCopyKey: string;
		claimedAt: string;
		staleClaimsBefore: string;
	}) => Promise<boolean>;
	releaseDiscrepancyWorkingCopy: (input: { id: string }) => Promise<void>;
	listStaleDiscrepancyWorkingCopies: (input: {
		staleClaimsBefore: string;
		limit: number;
	}) => Promise<{ id: string; workingCopyKey: string }[]>;
	getReconciliationState: () => Promise<GraphicsReconciliationStateRecord>;
	recordCanonicalScanProgress: (input: {
		cursor?: string;
		startedAt?: string;
	}) => Promise<void>;
	recordReconciliationSweep: (input: {
		correlationId: string;
		startedAt: string;
		completedAt: string;
	}) => Promise<void>;
	recordGraphicsAssetEvidence: (
		entries: readonly GraphicsAssetEvidenceEntry[],
	) => Promise<void>;
}

/** What an administrator's supplied or stored bytes must prove before reuse. */
export type GraphicsContentExpectation
	= | {
		kind: 'source';
		canonicalMime: string;
		sourceKind: 'image' | 'silent-video' | 'font';
		facts: Record<string, unknown>;
	}
	| {
		kind: 'derivative';
		canonicalMime: string;
	};

export type VerifyGraphicsContentBytesOutcome
	= | { outcome: 'verified' }
		| { outcome: 'rejected'; code: GraphicsRepairRejectionCode; message: string };

export type RegenerateGraphicsDerivativeOutcome
	= | { outcome: 'generated'; bytes: Uint8Array }
		| { outcome: 'unavailable'; code: GraphicsRepairRejectionCode; message: string };

/**
 * The media-aware seams reconciliation delegates to. Compatibility profiles,
 * validators, and the pinned silent-video validation runtime stay outside this
 * module; reconciliation only decides what must be proven and what happens to
 * catalogue state once it is.
 */
export interface GraphicsReconciliationMedia {
	/**
	 * Proves that the bytes behind `read` are exactly the expected content:
	 * the same application SHA-256, byte size, canonical media type, and — for
	 * source content — the same validation facts the revision recorded.
	 */
	verifyContentBytes: (input: {
		read: (range?: { offset: number; length: number }) => Promise<ReadGraphicsObjectOutcome>;
		expectedDigest: string;
		expectedByteLength: number;
		expectation: GraphicsContentExpectation;
	}) => Promise<VerifyGraphicsContentBytesOutcome>;
	/**
	 * Reproduces one deterministic Graphics Derivative from canonical source
	 * content. The discrepancy identity is supplied so a generator that cannot
	 * read canonical bytes directly can stage its own copy under the working
	 * copy this module has already claimed and will clean up.
	 */
	regenerateDerivative: (input: {
		discrepancyId: string;
		derivativeKind: 'thumbnail' | 'video-poster' | 'font-specimen';
		sourceKind: 'image' | 'silent-video' | 'font';
		sourceDigest: string;
		sourceByteLength: number;
		sourceCanonicalMime: string;
		sourceFacts: Record<string, unknown>;
	}) => Promise<RegenerateGraphicsDerivativeOutcome>;
	sha256Hex: (bytes: Uint8Array) => Promise<string>;
}

interface GraphicsReconciliationDependencies {
	catalogue: GraphicsAssetReconciliationCatalogue;
	canonical: GraphicsCanonicalObjectStore;
	staging: GraphicsStagingObjectStore;
	media: GraphicsReconciliationMedia;
	now: () => Date;
	generateIdentity: () => string;
}

/** How many discrepancies of each kind one operational view lists. */
const OVERVIEW_KIND_LIMIT = 50;

const EMPTY_OPEN_COUNTS: Record<GraphicsDiscrepancyKind, number> = {
	'unavailable-content': 0,
	'missing-derivative': 0,
	'unexpected-object': 0,
	'critical-integrity-incident': 0,
};

export function createGraphicsReconciliation(dependencies: GraphicsReconciliationDependencies) {
	const { catalogue, canonical, staging, media, now, generateIdentity } = dependencies;

	function timestamp() {
		return now().toISOString();
	}

	function evidence(input: {
		recordedAt: string;
		correlationId: string;
		category: GraphicsReconciliationEvidenceCategory;
		actor?: string;
		subject: GraphicsAssetEvidenceEntry['subject'];
		outcome: string;
		reason: string;
		detail?: GraphicsAssetEvidenceEntry['detail'];
	}): GraphicsAssetEvidenceEntry {
		return {
			id: generateIdentity(),
			recordedAt: input.recordedAt,
			category: input.category,
			actor: input.actor ?? GRAPHICS_RECONCILIATION_ACTOR,
			subject: input.subject,
			outcome: input.outcome,
			reason: input.reason,
			correlationId: input.correlationId,
			detail: input.detail ?? {},
			expiresAt: graphicsRetentionDeadline(
				input.recordedAt,
				GRAPHICS_RETENTION_GUARANTEES.evidenceMilliseconds,
			),
		};
	}

	/**
	 * The actions valid in one discrepancy's exact state.
	 *
	 * An isolated critical integrity incident offers only a recheck: repairing
	 * it would mean overwriting bytes or mutating metadata, which is precisely
	 * what must not happen. An unexpected object offers only a recheck too,
	 * because adopting it would invent catalogue state from a byte observation.
	 */
	function validActions(
		record: GraphicsDiscrepancyRecord,
		context: { regenerable: boolean; sourceAvailable: boolean },
	): GraphicsDiscrepancyAction[] {
		if (record.state === 'resolved')
			return [];
		// An isolated incident offers no action that writes. Deep verification is
		// offered because it is the only way to settle one: it either proves the
		// stored bytes are exactly what the catalogue expects, or proves they are
		// not, without overwriting anything.
		//
		// It is offered whenever there is catalogued content to verify against,
		// deliberately without first checking whether bytes are there. Reading
		// the store for every row would put an operational view back into the
		// hundreds of subrequests, and answering from the last recorded
		// observation would hide the action at the exact moment it is wanted —
		// right after an operator restores bytes, when nothing has re-observed
		// them yet. The action itself reports honestly when there is nothing to
		// verify.
		if (record.isolated || record.kind === 'critical-integrity-incident')
			return record.digest ? ['recheck', 'verify-stored-bytes'] : ['recheck'];
		// An unexpected object is never adopted, so nothing here writes catalogue
		// state for it either.
		if (record.kind === 'unexpected-object')
			return ['recheck'];
		const actions: GraphicsDiscrepancyAction[] = [
			'recheck',
			'verify-stored-bytes',
			'repair-with-exact-bytes',
		];
		// Regeneration needs a Graphics Derivative to reproduce and a source to
		// reproduce it from. Content nothing reaches at all has neither, so it is
		// repaired with exact bytes like any other missing content.
		if (record.kind === 'missing-derivative' && context.regenerable && context.sourceAvailable)
			actions.push('regenerate-derivative');
		return actions;
	}

	/**
	 * Everything a queue of discrepancies needs to be described, read in a fixed
	 * number of set-based queries rather than a few per row.
	 *
	 * A queue of 200 incidents used to cost hundreds of subrequests, which is a
	 * real ceiling on a Worker; this keeps one operational view to a handful
	 * regardless of queue depth.
	 */
	interface DiscrepancyContext {
		expectations: Map<string, ExpectedGraphicAssetContent>;
		usage: Map<string, GraphicsDiscrepancyUsage[]>;
		quarantine: Map<string, { quarantinedAt: string; deleteAfter: string }>;
	}

	async function loadDiscrepancyContext(
		records: readonly GraphicsDiscrepancyRecord[],
	): Promise<DiscrepancyContext> {
		const digests = [...new Set(
			records.map(record => record.digest).filter((digest): digest is string => Boolean(digest)),
		)];
		if (digests.length === 0)
			return { expectations: new Map(), usage: new Map(), quarantine: new Map() };
		const [expectations, usage, quarantine] = await Promise.all([
			catalogue.findExpectedContents({ digests }),
			catalogue.listContentUsageForDigests({ digests }),
			catalogue.findQuarantinedDigests({ digests }),
		]);
		// A missing Graphics Derivative is judged against its source, which is a
		// different digest, so those are resolved in one further set-based read.
		const sourceDigests = [...new Set(
			[...expectations.values()]
				.map(expectation => expectation.derivative?.sourceDigest)
				.filter((digest): digest is string => Boolean(digest) && !expectations.has(digest!)),
		)];
		if (sourceDigests.length > 0) {
			for (const [digest, expectation] of await catalogue.findExpectedContents({
				digests: sourceDigests,
			})) {
				expectations.set(digest, expectation);
			}
		}
		return { expectations, usage, quarantine };
	}

	/**
	 * Expands one durable record into the administrator-facing view: the
	 * structured evidence behind the disagreement, the pinned usage it affects,
	 * and only the actions valid in that state. No digest or object key crosses
	 * this boundary.
	 *
	 * This reads no bytes. Whether an object is currently present comes from the
	 * discrepancy's own last observation, and whether a derivative's source can
	 * be reproduced comes from the catalogue's advisory availability state —
	 * which is exactly what advisory state is for. Deciding what to *offer* may
	 * use it; every action that acts re-proves it against the byte store first.
	 */
	function describeWith(
		record: GraphicsDiscrepancyRecord,
		context: DiscrepancyContext,
	): GraphicsDiscrepancy {
		const expectation = record.digest ? context.expectations.get(record.digest) : undefined;
		const quarantine = record.digest && record.state === 'open'
			? context.quarantine.get(record.digest)
			: undefined;
		const affectedUsage = (record.digest && context.usage.get(record.digest)) || [];
		const derivative = expectation?.derivative;
		const sourceAvailable = derivative !== undefined
			&& context.expectations.get(derivative.sourceDigest)?.availability === 'available';
		return {
			id: record.id,
			kind: record.kind,
			state: record.state,
			reasonCode: record.reasonCode,
			isolated: record.isolated,
			detectedAt: record.detectedAt,
			lastCheckedAt: record.lastCheckedAt,
			...(record.resolvedAt ? { resolvedAt: record.resolvedAt } : {}),
			...(record.resolution ? { resolution: record.resolution } : {}),
			expected: record.expected,
			observed: record.observed,
			affectedUsage,
			...(derivative
				? {
						derivative: {
							id: derivative.id,
							kind: derivative.kind,
							sourceAssetId: derivative.sourceAssetId,
							sourceRevisionId: derivative.sourceRevisionId,
							sourceAvailable,
						},
					}
				: {}),
			...(quarantine
				? {
						quarantine: {
							quarantinedAt: quarantine.quarantinedAt,
							deleteAfter: quarantine.deleteAfter,
						},
					}
				: {}),
			actions: validActions(record, {
				regenerable: derivative !== undefined,
				sourceAvailable,
			}),
		};
	}

	async function describe(record: GraphicsDiscrepancyRecord): Promise<GraphicsDiscrepancy> {
		return describeWith(record, await loadDiscrepancyContext([record]));
	}

	type CanonicalObservation
		= | { outcome: 'agrees'; byteLength: number; canonicalMime?: string }
			| { outcome: 'missing' }
			| {
				outcome: 'mismatched';
				reasonCode: Extract<
					GraphicsDiscrepancyReasonCode,
					'canonical-object-facts-mismatch' | 'canonical-object-redundant-metadata-mismatch'
				>;
				byteLength: number;
				canonicalMime?: string;
			}
			| { outcome: 'byte-store-unavailable' };

	/**
	 * Compares one stored object against the catalogue's record of it.
	 *
	 * Canonical objects are written with the digest that owns their key repeated
	 * in their metadata, so a missing or contradicting copy of it is a genuine
	 * integrity conflict rather than a cosmetic difference — it is the same
	 * proof publication requires before it will reuse an existing object.
	 */
	async function observeCanonicalObject(content: {
		digest: string;
		byteLength: number;
		canonicalMime: string;
	}): Promise<CanonicalObservation> {
		const result = await canonical.readMetadata(canonicalContentIdentity(content.digest));
		if (result.outcome === 'missing')
			return { outcome: 'missing' };
		if (result.outcome === 'unavailable')
			return { outcome: 'byte-store-unavailable' };
		const observed = {
			byteLength: result.object.byteLength,
			canonicalMime: result.object.contentType,
		};
		const agreement = canonicalObjectAgreement(content, result.object);
		return agreement.outcome === 'agrees'
			? { outcome: 'agrees', ...observed }
			: { outcome: 'mismatched', reasonCode: agreement.reasonCode, ...observed };
	}

	/**
	 * Whether the byte store currently holds an object that agrees with the
	 * catalogue in every respect. Disagreement is never treated as agreement, so
	 * a mismatched object can only ever read as unavailable.
	 */
	async function canonicalObjectAgrees(content: {
		digest: string;
		byteLength: number;
		canonicalMime: string;
	}): Promise<boolean> {
		return (await observeCanonicalObject(content)).outcome === 'agrees';
	}

	function observationFacts(observation: CanonicalObservation): GraphicsDiscrepancy['observed'] {
		switch (observation.outcome) {
			case 'missing':
				return { present: false };
			case 'byte-store-unavailable':
				return { present: false, byteStoreUnavailable: true };
			default:
				return {
					present: true,
					byteLength: observation.byteLength,
					...(observation.canonicalMime ? { canonicalMime: observation.canonicalMime } : {}),
				};
		}
	}

	/**
	 * Records one comparison of an expectation against the byte store.
	 *
	 * Missing bytes become Unavailable Graphic Asset Content with a persistent
	 * open discrepancy; every identity, revision, and reference stays exactly as
	 * it was. Bytes whose redundant size or media type contradicts the catalogue
	 * are a critical integrity incident: they fail closed, are isolated, and are
	 * never overwritten or re-labelled.
	 */
	async function reconcileExpectation(
		content: ExpectedGraphicAssetContent,
		correlationId: string,
		records: GraphicsAssetEvidenceEntry[],
	): Promise<{
		observed: CanonicalObservation['outcome'];
		unavailableDetected: boolean;
		derivativeMissing: boolean;
		availabilityRestored: boolean;
		criticalIncident: boolean;
	}> {
		const observation = await observeCanonicalObject(content);
		const observedAt = timestamp();
		const unchanged = {
			observed: observation.outcome,
			unavailableDetected: false,
			derivativeMissing: false,
			availabilityRestored: false,
			criticalIncident: false,
		};
		if (observation.outcome === 'byte-store-unavailable')
			return unchanged;

		await catalogue.recordContentReconciled({ digest: content.digest, checkedAt: observedAt });

		if (observation.outcome === 'agrees') {
			// Agreement closes every non-isolated incident about these bytes,
			// including an unexpected-object incident the catalogue has since
			// caught up with. An isolated conflict is deliberately not closed
			// here: only deep verification can settle one.
			const resolved = await catalogue.resolveDiscrepanciesForDigest({
				digest: content.digest,
				resolvedAt: observedAt,
				resolution: 'byte-store-agrees',
			});
			// A resolution always earns a ledger entry; a flag that was never
			// raised has nothing to explain.
			for (const discrepancyId of resolved) {
				records.push(evidence({
					recordedAt: observedAt,
					correlationId,
					category: 'content-availability-restored',
					subject: { kind: 'graphics-discrepancy', id: discrepancyId },
					outcome: 'content-available',
					reason: 'byte-store-agrees-with-catalogue',
					detail: {
						discrepancyId,
						affectedRevisionCount: content.revisionReach,
					},
				}));
			}
			if (content.availability === 'available')
				return unchanged;
			// Clearing the advisory alert is refused while an isolated incident is
			// open, so a fact-level agreement can never reopen a conflict.
			if (!await catalogue.markContentAvailable({
				digest: content.digest,
				restoredAt: observedAt,
			})) {
				return unchanged;
			}
			return { ...unchanged, availabilityRestored: true };
		}

		const critical = observation.outcome === 'mismatched';
		// Only content a Graphics Derivative actually reaches can be regenerated.
		// Content nothing reaches at all is still catalogued content whose bytes
		// are gone, so it is reported as unavailable and repaired with exact
		// bytes rather than offered a regeneration it has no source for.
		const regenerable = content.revisionReach === 0
			&& content.derivativeReach > 0
			&& content.derivative !== undefined;
		const reasonCode: GraphicsDiscrepancyReasonCode = observation.outcome === 'mismatched'
			? observation.reasonCode
			: regenerable
				? 'derivative-object-missing'
				: 'canonical-object-missing';
		const kind: GraphicsDiscrepancyKind = critical
			? 'critical-integrity-incident'
			: regenerable
				? 'missing-derivative'
				: 'unavailable-content';

		await catalogue.markContentUnavailable({
			digest: content.digest,
			reasonCode,
			since: observedAt,
		});
		const discrepancy = await catalogue.openDiscrepancy({
			id: generateIdentity(),
			kind,
			subjectKey: content.digest,
			digest: content.digest,
			derivativeId: regenerable ? content.derivative?.id : undefined,
			reasonCode,
			isolated: critical,
			expected: { byteLength: content.byteLength, canonicalMime: content.canonicalMime },
			observed: observationFacts(observation),
			observedAt,
			correlationId,
		});
		// A discrepancy that was already open is re-observed, not re-announced:
		// an hourly sweep must not fill the ledger with the same incident.
		if (discrepancy.detectedAt === observedAt) {
			records.push(evidence({
				recordedAt: observedAt,
				correlationId,
				category: critical
					? 'critical-integrity-incident'
					: kind === 'missing-derivative'
						? 'derivative-missing-detected'
						: 'content-unavailable-detected',
				subject: { kind: 'graphics-discrepancy', id: discrepancy.id },
				outcome: critical ? 'integrity-incident-isolated' : 'content-unavailable',
				reason: reasonCode,
				detail: {
					discrepancyId: discrepancy.id,
					discrepancyKind: kind,
					reasonCode,
					isolated: critical,
					affectedRevisionCount: content.revisionReach,
				},
			}));
		}
		return {
			observed: observation.outcome,
			unavailableDetected: !critical && !regenerable,
			derivativeMissing: !critical && regenerable,
			availabilityRestored: false,
			criticalIncident: critical,
		};
	}

	/**
	 * Compares the catalogue's expectations against the byte store, oldest
	 * comparison first. The byte store going away stops the stage rather than
	 * marking healthy content unavailable: an unreachable store proves nothing
	 * about any individual object.
	 */
	async function reconcileExpectedContent(correlationId: string) {
		const records: GraphicsAssetEvidenceEntry[] = [];
		const candidates = await catalogue.listExpectedContent({
			limit: GRAPHICS_RECONCILIATION_STAGE_BATCH,
		});
		let checked = 0;
		let unavailableDetected = 0;
		let availabilityRestored = 0;
		let missingDetected = 0;
		let criticalIncidents = 0;
		for (const content of candidates) {
			const outcome = await reconcileExpectation(content, correlationId, records);
			if (outcome.observed === 'byte-store-unavailable')
				break;
			checked++;
			if (outcome.criticalIncident)
				criticalIncidents++;
			if (outcome.unavailableDetected)
				unavailableDetected++;
			if (outcome.derivativeMissing)
				missingDetected++;
			if (outcome.availabilityRestored)
				availabilityRestored++;
		}
		return {
			records,
			checked,
			unavailableDetected,
			availabilityRestored,
			missingDetected,
			criticalIncidents,
		};
	}

	/**
	 * Looks for bytes the catalogue never expected.
	 *
	 * Nothing here is adopted: an unexpected digest-owned object is quarantined
	 * for the same seven-day recheck the retention path already enforces, and an
	 * object whose key is not a digest-owned identity is isolated as a critical
	 * integrity incident rather than deleted on a guess.
	 */
	async function scanForUnexpectedObjects(correlationId: string) {
		const records: GraphicsAssetEvidenceEntry[] = [];
		const state = await catalogue.getReconciliationState();
		const page = await canonical.list({
			cursor: state.canonicalScanCursor,
			limit: GRAPHICS_RECONCILIATION_STAGE_BATCH,
		});
		if (page.outcome !== 'listed')
			return { records, scanned: 0, quarantined: 0, criticalIncidents: 0 };

		const startedAt = state.canonicalScanStartedAt ?? timestamp();
		const digestedObjects = new Map<string, { key: string; byteLength: number }>();
		let criticalIncidents = 0;
		for (const object of page.listing.objects) {
			const digest = canonicalObjectDigest(object.identity);
			if (!digest) {
				const observedAt = timestamp();
				const incident = await catalogue.openDiscrepancy({
					id: generateIdentity(),
					kind: 'critical-integrity-incident',
					subjectKey: object.identity,
					objectKey: object.identity,
					reasonCode: 'foreign-canonical-object',
					isolated: true,
					expected: { byteLength: 0 },
					observed: {
						present: true,
						byteLength: object.byteLength,
						...(object.contentType ? { canonicalMime: object.contentType } : {}),
					},
					observedAt,
					correlationId,
				});
				if (incident.detectedAt === observedAt) {
					criticalIncidents++;
					records.push(evidence({
						recordedAt: observedAt,
						correlationId,
						category: 'critical-integrity-incident',
						subject: { kind: 'graphics-discrepancy', id: incident.id },
						outcome: 'integrity-incident-isolated',
						reason: 'foreign-canonical-object',
						detail: {
							discrepancyId: incident.id,
							discrepancyKind: 'critical-integrity-incident',
							reasonCode: 'foreign-canonical-object',
							isolated: true,
						},
					}));
				}
				continue;
			}
			digestedObjects.set(digest, {
				key: object.identity,
				byteLength: object.byteLength,
			});
		}

		const accounted = await catalogue.filterAccountedDigests({
			digests: [...digestedObjects.keys()],
		});
		let quarantined = 0;
		for (const [digest, object] of digestedObjects) {
			if (accounted.has(digest))
				continue;
			const quarantinedAt = timestamp();
			const deleteAfter = graphicsRetentionDeadline(
				quarantinedAt,
				GRAPHICS_RETENTION_GUARANTEES.orphanContentQuarantineMilliseconds,
			);
			if (!await catalogue.quarantineUnexpectedObject({
				id: generateIdentity(),
				digest,
				byteLength: object.byteLength,
				quarantinedAt,
				deleteAfter,
			})) {
				continue;
			}
			const discrepancy = await catalogue.openDiscrepancy({
				id: generateIdentity(),
				kind: 'unexpected-object',
				subjectKey: digest,
				digest,
				objectKey: object.key,
				reasonCode: 'unexpected-canonical-object',
				isolated: false,
				expected: { byteLength: 0 },
				observed: { present: true, byteLength: object.byteLength },
				observedAt: quarantinedAt,
				correlationId,
			});
			quarantined++;
			records.push(evidence({
				recordedAt: quarantinedAt,
				correlationId,
				category: 'unexpected-object-quarantined',
				subject: { kind: 'graphics-discrepancy', id: discrepancy.id },
				outcome: 'unexpected-object-quarantined',
				reason: 'catalogue-does-not-expect-these-bytes',
				detail: {
					discrepancyId: discrepancy.id,
					discrepancyKind: 'unexpected-object',
					reasonCode: 'unexpected-canonical-object',
					bytesReserved: object.byteLength,
					deadline: deleteAfter,
				},
			}));
		}

		// A finished pass restarts from the beginning next time, so an object
		// added behind the cursor is still eventually seen.
		await catalogue.recordCanonicalScanProgress({
			cursor: page.listing.cursor,
			startedAt: page.listing.cursor === undefined ? undefined : startedAt,
		});
		return {
			records,
			scanned: page.listing.objects.length,
			quarantined,
			criticalIncidents,
		};
	}

	/**
	 * Closes unexpected-object incidents that have settled themselves.
	 *
	 * The scan that opened them is a forward cursor and will not revisit an
	 * object that is gone, so without this an incident the retention path has
	 * already resolved by deleting the bytes would stay on the queue forever.
	 */
	async function settleUnexpectedObjects(correlationId: string) {
		const records: GraphicsAssetEvidenceEntry[] = [];
		// Asking for the kind being settled means a backlog of any other kind
		// cannot starve this stage of the rows it exists to close.
		const open = await catalogue.listDiscrepancies({
			limit: GRAPHICS_RECONCILIATION_STAGE_BATCH,
			states: ['open'],
			kinds: ['unexpected-object'],
		});
		let settled = 0;
		for (const record of open) {
			const identity = graphicsObjectIdentity(
				record.objectKey ?? `${GRAPHICS_CANONICAL_OBJECT_PREFIX}${record.digest}`,
			);
			const metadata = await canonical.readMetadata(identity);
			if (metadata.outcome !== 'missing')
				continue;
			const resolvedAt = timestamp();
			if (!await catalogue.resolveDiscrepancy({
				id: record.id,
				resolvedAt,
				resolution: 'object-deleted-after-recheck',
			})) {
				continue;
			}
			settled++;
			records.push(evidence({
				recordedAt: resolvedAt,
				correlationId,
				category: 'discrepancy-rechecked',
				subject: { kind: 'graphics-discrepancy', id: record.id },
				outcome: 'object-deleted-after-recheck',
				reason: 'unexpected-object-removed-after-quarantine-recheck',
				detail: {
					discrepancyId: record.id,
					discrepancyKind: 'unexpected-object',
				},
			}));
		}
		return { records, settled };
	}

	/**
	 * Reclaims staged working copies whose repair or regeneration never finished.
	 * The claim outlives the byte work it authorised, so nothing is ever left
	 * staged with no catalogue trace.
	 */
	async function reclaimStaleWorkingCopies() {
		const stale = await catalogue.listStaleDiscrepancyWorkingCopies({
			staleClaimsBefore: graphicsRetentionDeadline(
				timestamp(),
				-GRAPHICS_WORKING_COPY_LEASE_MILLISECONDS,
			),
			limit: GRAPHICS_RECONCILIATION_STAGE_BATCH,
		});
		let reclaimed = 0;
		for (const claim of stale) {
			// eslint-disable-next-line drizzle/enforce-delete-with-where -- Object-store deletion is scoped by immutable identity.
			const removal = await staging.delete(graphicsObjectIdentity(claim.workingCopyKey));
			if (removal.outcome === 'unavailable')
				continue;
			await catalogue.releaseDiscrepancyWorkingCopy({ id: claim.id });
			reclaimed++;
		}
		return reclaimed;
	}

	async function releaseWorkingCopy(discrepancyId: string, identity: GraphicsObjectIdentity) {
		// eslint-disable-next-line drizzle/enforce-delete-with-where -- Object-store deletion is scoped by immutable identity.
		const removal = await staging.delete(identity);
		if (removal.outcome !== 'unavailable')
			await catalogue.releaseDiscrepancyWorkingCopy({ id: discrepancyId });
	}

	/**
	 * The one gate every byte-writing action passes before it does anything.
	 *
	 * Refusing here rather than after the write is what keeps the Evidence ledger
	 * honest: a repair that has already stored bytes must never be recorded as a
	 * refusal, and the only way to guarantee that is to decide before writing.
	 */
	async function isolationRefusal(
		record: GraphicsDiscrepancyRecord,
		actor: string,
	): Promise<GraphicsDiscrepancyActionOutcome | undefined> {
		if (record.isolated || record.kind === 'critical-integrity-incident') {
			return await rejected(
				record,
				'integrity-incident-isolated',
				'A critical integrity incident is isolated and is never resolved by overwriting bytes or mutating metadata.',
				actor,
			);
		}
		if (record.digest && await catalogue.hasOpenIsolatedIncident({ digest: record.digest })) {
			return await rejected(
				record,
				'integrity-incident-isolated',
				'An isolated critical integrity incident is open for this content, so it cannot be repaired or restored until that incident is resolved.',
				actor,
			);
		}
		return undefined;
	}

	async function rejected(
		record: GraphicsDiscrepancyRecord,
		code: GraphicsRepairRejectionCode,
		message: string,
		actor: string,
	): Promise<GraphicsDiscrepancyActionOutcome> {
		const recordedAt = timestamp();
		await catalogue.recordGraphicsAssetEvidence([evidence({
			recordedAt,
			correlationId: record.correlationId,
			actor,
			category: 'repair-rejected',
			subject: { kind: 'graphics-discrepancy', id: record.id },
			outcome: 'repair-refused',
			reason: code,
			detail: {
				discrepancyId: record.id,
				discrepancyKind: record.kind,
				rejectionCode: code,
				isolated: record.isolated,
			},
		})]);
		return {
			outcome: 'rejected',
			code,
			message,
			discrepancy: await describe(record),
		};
	}

	/**
	 * Publishes verified bytes under their digest-owned identity and clears the
	 * advisory alert. The write is create-if-absent, so it can only ever add the
	 * exact bytes the catalogue already expected: it never replaces an object,
	 * creates a revision, or touches a reference.
	 */
	async function publishVerifiedContent(input: {
		digest: string;
		byteLength: number;
		canonicalMime: string;
		bytes: BoundedByteStream;
	}): Promise<{ outcome: 'published' } | { outcome: 'rejected'; code: GraphicsRepairRejectionCode; message: string }> {
		// Repaired content is written exactly as publication writes it, including
		// the redundant digest metadata every canonical object carries, so a
		// repair leaves nothing a later sweep would read as a conflict.
		const write = await canonical.createImmutable({
			identity: canonicalContentIdentity(input.digest),
			bytes: input.bytes,
			metadata: {
				contentType: input.canonicalMime,
				custom: { sha256: input.digest },
			},
		});
		if (write.outcome === 'unavailable') {
			return {
				outcome: 'rejected',
				code: 'byte-store-unavailable',
				message: 'The canonical byte store is temporarily unavailable.',
			};
		}
		// An object that was already there must still match, otherwise this is the
		// same digest-key conflict that must fail closed rather than be reused.
		if (
			write.object.byteLength !== input.byteLength
			|| write.object.contentType !== input.canonicalMime
			|| write.object.customMetadata.sha256 !== input.digest
		) {
			return {
				outcome: 'rejected',
				code: 'byte-length-mismatch',
				message: 'The stored object does not match the exact expected size, canonical media type, and integrity metadata.',
			};
		}
		return { outcome: 'published' };
	}

	async function completeRecovery(input: {
		record: GraphicsDiscrepancyRecord;
		digest: string;
		resolution: GraphicsDiscrepancyResolution;
		category: GraphicsReconciliationEvidenceCategory;
		reason: string;
		actor: string;
	}): Promise<GraphicsDiscrepancyActionOutcome> {
		const recordedAt = timestamp();
		// The incident is settled before the alert is cleared. Clearing refuses
		// while any isolated incident is open on this content, and deep
		// verification settles exactly such an incident — so resolving second
		// would leave the content permanently unavailable after proving its bytes
		// are correct.
		await catalogue.resolveDiscrepancy({
			id: input.record.id,
			resolvedAt: recordedAt,
			resolution: input.resolution,
		});
		// Every caller refuses an isolated incident before doing byte work, so
		// this can only fail if another one is still open. The bytes are already
		// restored by that point, and the ledger records what actually happened
		// rather than calling a completed recovery a refusal.
		const cleared = await catalogue.markContentAvailable({
			digest: input.digest,
			restoredAt: recordedAt,
		});
		const usage = await catalogue.listContentUsage({ digest: input.digest });
		await catalogue.recordGraphicsAssetEvidence([evidence({
			recordedAt,
			correlationId: input.record.correlationId,
			actor: input.actor,
			category: input.category,
			subject: { kind: 'graphics-discrepancy', id: input.record.id },
			outcome: input.resolution,
			reason: input.reason,
			detail: {
				discrepancyId: input.record.id,
				discrepancyKind: input.record.kind,
				affectedRevisionCount: usage.length,
				// An alert left standing over restored bytes is the one thing an
				// administrator must not have to infer from a success.
				...(cleared ? {} : { isolated: true }),
			},
		})]);
		const updated = await catalogue.findDiscrepancy({ id: input.record.id });
		return {
			outcome: 'resolved',
			resolution: input.resolution,
			discrepancy: await describe(updated ?? {
				...input.record,
				state: 'resolved',
				resolvedAt: recordedAt,
				resolution: input.resolution,
			}),
		};
	}

	/**
	 * Records that verified bytes hash to something other than the digest that
	 * owns their key. This is the conflict that must never be repaired in place:
	 * the incident is isolated and the bytes are left exactly as they are.
	 */
	async function isolateIntegrityConflict(input: {
		record: GraphicsDiscrepancyRecord;
		digest: string;
		reasonCode: GraphicsDiscrepancyReasonCode;
		observed: GraphicsDiscrepancy['observed'];
		actor: string;
	}) {
		const observedAt = timestamp();
		await catalogue.markContentUnavailable({
			digest: input.digest,
			reasonCode: input.reasonCode,
			since: observedAt,
		});
		const incident = await catalogue.openDiscrepancy({
			id: generateIdentity(),
			kind: 'critical-integrity-incident',
			subjectKey: input.digest,
			digest: input.digest,
			reasonCode: input.reasonCode,
			isolated: true,
			expected: input.record.expected,
			observed: input.observed,
			observedAt,
			correlationId: input.record.correlationId,
		});
		await catalogue.recordGraphicsAssetEvidence([evidence({
			recordedAt: observedAt,
			correlationId: input.record.correlationId,
			actor: input.actor,
			category: 'critical-integrity-incident',
			subject: { kind: 'graphics-discrepancy', id: incident.id },
			outcome: 'integrity-incident-isolated',
			reason: input.reasonCode,
			detail: {
				discrepancyId: incident.id,
				discrepancyKind: 'critical-integrity-incident',
				reasonCode: input.reasonCode,
				isolated: true,
			},
		})]);
	}

	async function reconcileObservedDigest(input: { digest: string }): Promise<void> {
		const expectation = await catalogue.findExpectedContent({ digest: input.digest });
		if (!expectation)
			return;
		const correlationId = generateIdentity();
		const records: GraphicsAssetEvidenceEntry[] = [];
		await reconcileExpectation(expectation, correlationId, records);
		if (records.length > 0)
			await catalogue.recordGraphicsAssetEvidence(records);
	}

	/**
	 * Lists open discrepancies with a budget per kind.
	 *
	 * One shared limit lets whichever kind sorts first fill the whole page: a
	 * backlog of isolated incidents would hide every repairable one behind it.
	 */
	async function listOpenDiscrepanciesPerKind() {
		const perKind = await Promise.all(
			GRAPHICS_DISCREPANCY_KINDS.map(kind => catalogue.listDiscrepancies({
				limit: OVERVIEW_KIND_LIMIT,
				states: ['open'],
				kinds: [kind],
			})),
		);
		return perKind.flat();
	}

	return {
		/**
		 * The scheduled reconciliation pass. D1 decides what should be reachable,
		 * the byte store reports only what it holds, and nothing here creates,
		 * redirects, or removes a Graphic Asset identity or reference.
		 */
		async run(): Promise<GraphicsReconciliationSweepResult> {
			const correlationId = generateIdentity();
			const startedAt = timestamp();
			const content = await reconcileExpectedContent(correlationId);
			const unexpected = await scanForUnexpectedObjects(correlationId);
			const settled = await settleUnexpectedObjects(correlationId);
			const reclaimed = await reclaimStaleWorkingCopies();
			const records = [...content.records, ...unexpected.records, ...settled.records];
			if (records.length > 0)
				await catalogue.recordGraphicsAssetEvidence(records);
			const completedAt = timestamp();
			await catalogue.recordReconciliationSweep({ correlationId, startedAt, completedAt });
			return {
				correlationId,
				startedAt,
				completedAt,
				content: {
					checked: content.checked,
					unavailableDetected: content.unavailableDetected,
					availabilityRestored: content.availabilityRestored,
				},
				derivatives: { missingDetected: content.missingDetected },
				unexpectedObjects: {
					scanned: unexpected.scanned,
					quarantined: unexpected.quarantined,
				},
				criticalIntegrityIncidents: content.criticalIncidents + unexpected.criticalIncidents,
				workingCopies: { reclaimed },
				evidence: { recorded: records.length },
			};
		},
		/**
		 * Reconciles exactly the content a caller just observed failing, without
		 * waiting for the next scheduled pass. Readers use this so an integrity
		 * failure they hit becomes durable operational state immediately.
		 */
		async reconcileObservedContent(input: {
			assetId: GraphicAssetId;
			revisionId: GraphicAssetRevisionId;
		}): Promise<void> {
			const digest = await catalogue.findRevisionContentDigest(input);
			if (digest)
				await reconcileObservedDigest({ digest });
		},
		/**
		 * Reconciles exactly the content behind one digest a caller just observed
		 * failing. A Graphics Derivative has no revision of its own, so a reader
		 * resolving a preview reaches reconciliation through this rather than
		 * through an asset and revision.
		 */
		reconcileObservedDigest,
		async overview(): Promise<GraphicsReconciliationOverview> {
			const [state, openCounts, discrepancies] = await Promise.all([
				catalogue.getReconciliationState(),
				catalogue.countOpenDiscrepancies(),
				// Per-kind budgets, so a large backlog of one kind — isolated
				// incidents in particular, which sort first — cannot push every
				// other kind off the queue an administrator is working from.
				listOpenDiscrepanciesPerKind(),
			]);
			const context = await loadDiscrepancyContext(discrepancies);
			return {
				checkedAt: timestamp(),
				authority: {
					expectedReachability: 'catalogue',
					presentBytes: 'byte-store',
					contentAvailabilityFlag: 'advisory-reconciliation-state',
				},
				...(state.lastSweepCorrelationId
					&& state.lastSweepStartedAt
					&& state.lastSweepCompletedAt
					? {
							lastSweep: {
								correlationId: state.lastSweepCorrelationId,
								startedAt: state.lastSweepStartedAt,
								completedAt: state.lastSweepCompletedAt,
							},
						}
					: {}),
				openCounts: { ...EMPTY_OPEN_COUNTS, ...openCounts },
				discrepancies: discrepancies.map(
					record => describeWith(record, context),
				),
			};
		},
		async inspect(input: { discrepancyId: string }): Promise<GraphicsDiscrepancy | undefined> {
			const record = await catalogue.findDiscrepancy({ id: input.discrepancyId });
			return record ? await describe(record) : undefined;
		},
		/**
		 * Re-observes one discrepancy now. A byte store that has come back into
		 * agreement resolves the incident; anything else only refreshes what the
		 * administrator is looking at.
		 */
		async recheck(input: {
			discrepancyId: string;
			actor: string;
		}): Promise<GraphicsDiscrepancyActionOutcome | undefined> {
			const record = await catalogue.findDiscrepancy({ id: input.discrepancyId });
			if (!record)
				return undefined;
			if (record.state === 'resolved')
				return { outcome: 'unchanged', discrepancy: await describe(record) };

			const observedAt = timestamp();
			if (record.kind === 'unexpected-object' || !record.digest) {
				const identity = graphicsObjectIdentity(
					record.objectKey ?? `${GRAPHICS_CANONICAL_OBJECT_PREFIX}${record.digest}`,
				);
				const metadata = await canonical.readMetadata(identity);
				if (metadata.outcome === 'missing') {
					await catalogue.resolveDiscrepancy({
						id: record.id,
						resolvedAt: observedAt,
						resolution: 'object-deleted-after-recheck',
					});
					const updated = await catalogue.findDiscrepancy({ id: record.id });
					return {
						outcome: 'resolved',
						resolution: 'object-deleted-after-recheck',
						discrepancy: await describe(updated ?? record),
					};
				}
				if (metadata.outcome === 'available') {
					await catalogue.recordDiscrepancyObservation({
						id: record.id,
						observedAt,
						observed: {
							present: true,
							byteLength: metadata.object.byteLength,
							...(metadata.object.contentType
								? { canonicalMime: metadata.object.contentType }
								: {}),
						},
					});
					// The catalogue may have caught up with these bytes since the scan
					// found them, which settles the disagreement without adopting
					// anything: an ordinary publication claimed them.
					const expectation = record.digest
						? await catalogue.findExpectedContent({ digest: record.digest })
						: undefined;
					if (expectation && await canonicalObjectAgrees(expectation)) {
						await catalogue.resolveDiscrepancy({
							id: record.id,
							resolvedAt: observedAt,
							resolution: 'byte-store-agrees',
						});
						const settled = await catalogue.findDiscrepancy({ id: record.id });
						return {
							outcome: 'resolved',
							resolution: 'byte-store-agrees',
							discrepancy: await describe(settled ?? record),
						};
					}
				}
				const refreshed = await catalogue.findDiscrepancy({ id: record.id });
				return { outcome: 'unchanged', discrepancy: await describe(refreshed ?? record) };
			}

			const expectation = await catalogue.findExpectedContent({ digest: record.digest });
			if (!expectation) {
				// The catalogue stopped expecting these bytes entirely, so there is
				// nothing left to repair.
				await catalogue.resolveDiscrepancy({
					id: record.id,
					resolvedAt: observedAt,
					resolution: 'content-no-longer-expected',
				});
				const updated = await catalogue.findDiscrepancy({ id: record.id });
				return {
					outcome: 'resolved',
					resolution: 'content-no-longer-expected',
					discrepancy: await describe(updated ?? record),
				};
			}
			const observation = await observeCanonicalObject(expectation);
			await catalogue.recordDiscrepancyObservation({
				id: record.id,
				observedAt,
				observed: observationFacts(observation),
			});
			// An isolated incident is never cleared by a metadata-level agreement:
			// only deep verification can settle a digest conflict.
			if (observation.outcome === 'agrees' && !record.isolated) {
				return await completeRecovery({
					record,
					digest: record.digest,
					resolution: 'byte-store-agrees',
					category: 'discrepancy-rechecked',
					reason: 'byte-store-agrees-with-catalogue',
					actor: input.actor,
				});
			}
			const refreshed = await catalogue.findDiscrepancy({ id: record.id });
			return { outcome: 'unchanged', discrepancy: await describe(refreshed ?? record) };
		},
		/**
		 * Exact-byte repair. The supplied bytes must prove the same application
		 * SHA-256, byte size, canonical media type, and validation facts before a
		 * single byte reaches the canonical store; a successful repair creates no
		 * revision and changes no reference.
		 */
		async repair(input: {
			discrepancyId: string;
			actor: string;
			bytes: BoundedByteStream;
		}): Promise<GraphicsDiscrepancyActionOutcome | undefined> {
			const record = await catalogue.findDiscrepancy({ id: input.discrepancyId });
			if (!record)
				return undefined;
			if (record.state === 'resolved')
				return await rejected(record, 'discrepancy-already-resolved', 'This discrepancy is already resolved.', input.actor);
			const refusal = await isolationRefusal(record, input.actor);
			if (refusal)
				return refusal;
			if (!record.digest || (record.kind !== 'unavailable-content' && record.kind !== 'missing-derivative'))
				return await rejected(record, 'action-not-valid-in-state', 'Exact-byte repair is not valid for this discrepancy.', input.actor);

			const expectation = await catalogue.findExpectedContent({ digest: record.digest });
			if (!expectation)
				return await rejected(record, 'action-not-valid-in-state', 'The catalogue no longer expects this content.', input.actor);

			const workingCopy = reconciliationWorkingCopyIdentity(record.id);
			const claimedAt = timestamp();
			if (!await catalogue.claimDiscrepancyWorkingCopy({
				id: record.id,
				workingCopyKey: workingCopy,
				claimedAt,
				staleClaimsBefore: graphicsRetentionDeadline(claimedAt, -GRAPHICS_WORKING_COPY_LEASE_MILLISECONDS),
			})) {
				return await rejected(record, 'action-not-valid-in-state', 'Another repair is already in progress for this discrepancy.', input.actor);
			}

			try {
				// A previous attempt whose lease expired before a sweep reclaimed it
				// could still be staged here, and staged objects are create-if-absent,
				// so this repair would otherwise verify someone else's bytes.
				// eslint-disable-next-line drizzle/enforce-delete-with-where -- Object-store deletion is scoped by immutable identity.
				await staging.delete(workingCopy);
				// Supplied bytes are staged first. Nothing unverified is ever written
				// under a digest-owned canonical identity, because that identity is
				// the library's only proof of what the bytes are.
				const staged = await staging.createImmutable({
					identity: workingCopy,
					bytes: input.bytes,
					metadata: { contentType: expectation.canonicalMime },
				});
				if (staged.outcome === 'unavailable') {
					return await rejected(record, 'byte-store-unavailable', 'The staging byte store is temporarily unavailable.', input.actor);
				}
				if (staged.object.byteLength !== expectation.byteLength) {
					return await rejected(
						record,
						'byte-length-mismatch',
						`Repair requires exactly ${expectation.byteLength} bytes; the supplied content is ${staged.object.byteLength}.`,
						input.actor,
					);
				}

				const verification = await media.verifyContentBytes({
					read: range => staging.read(workingCopy, range),
					expectedDigest: record.digest,
					expectedByteLength: expectation.byteLength,
					// Source content must re-prove the validation facts its revision
					// recorded. A Graphics Derivative has no revision of its own, so an
					// exact digest, size, and canonical media type is its complete proof.
					expectation: expectation.source
						? {
								kind: 'source',
								canonicalMime: expectation.canonicalMime,
								sourceKind: expectation.source.kind,
								facts: expectation.source.facts,
							}
						: { kind: 'derivative', canonicalMime: expectation.canonicalMime },
				});
				if (verification.outcome === 'rejected')
					return await rejected(record, verification.code, verification.message, input.actor);

				const stagedBytes = await staging.read(workingCopy);
				if (stagedBytes.outcome !== 'available')
					return await rejected(record, 'byte-store-unavailable', 'The verified working copy could not be read back.', input.actor);

				const published = await publishVerifiedContent({
					digest: record.digest,
					byteLength: expectation.byteLength,
					canonicalMime: expectation.canonicalMime,
					bytes: {
						body: stagedBytes.body,
						byteLength: expectation.byteLength,
						maximumByteLength: expectation.byteLength,
					},
				});
				if (published.outcome === 'rejected')
					return await rejected(record, published.code, published.message, input.actor);

				return await completeRecovery({
					record,
					digest: record.digest,
					resolution: 'repaired-with-exact-bytes',
					category: 'content-repaired',
					reason: 'exact-verified-bytes-restored',
					actor: input.actor,
				});
			}
			finally {
				await releaseWorkingCopy(record.id, workingCopy);
			}
		},
		/**
		 * Deep verification of the bytes the store currently holds.
		 *
		 * The sweep compares only what a listing and a head request can see, which
		 * cannot detect bytes that changed behind metadata that still agrees.
		 * This re-reads and re-hashes the object in full against the complete
		 * chain — digest, size, canonical media type, redundant integrity
		 * metadata, and, for source content, the validation facts its revision
		 * recorded.
		 *
		 * It is the only action valid on an isolated critical integrity incident,
		 * because it is the only one that can actually settle one: it either
		 * proves the bytes are exactly what the catalogue expects, or it proves
		 * they are not. It never writes, so it cannot repair a conflict by
		 * overwriting or by mutating metadata.
		 *
		 * Verified bytes held under a Content Quarantine record are restored by
		 * releasing that record. The verification is deliberately stronger than
		 * the conditional-create reuse rule an exact-byte repair relies on: a
		 * create-if-absent against an object already present under its
		 * digest-owned identity would return `already-exists` and hand back the
		 * very object being judged, so proving the bytes directly is the only
		 * check that adds anything.
		 */
		async verifyStoredBytes(input: {
			discrepancyId: string;
			actor: string;
		}): Promise<GraphicsDiscrepancyActionOutcome | undefined> {
			const record = await catalogue.findDiscrepancy({ id: input.discrepancyId });
			if (!record)
				return undefined;
			if (record.state === 'resolved')
				return await rejected(record, 'discrepancy-already-resolved', 'This discrepancy is already resolved.', input.actor);
			if (!record.digest)
				return await rejected(record, 'action-not-valid-in-state', 'This discrepancy is not about catalogued content.', input.actor);

			const expectation = await catalogue.findExpectedContent({ digest: record.digest });
			if (!expectation)
				return await rejected(record, 'action-not-valid-in-state', 'The catalogue no longer expects this content.', input.actor);

			const identity = canonicalContentIdentity(record.digest);
			const observation = await observeCanonicalObject(expectation);
			await catalogue.recordDiscrepancyObservation({
				id: record.id,
				observedAt: timestamp(),
				observed: observationFacts(observation),
			});
			if (observation.outcome === 'missing')
				return await rejected(record, 'stored-bytes-missing', 'The canonical store does not hold these bytes.', input.actor);
			if (observation.outcome === 'byte-store-unavailable')
				return await rejected(record, 'byte-store-unavailable', 'The canonical byte store is temporarily unavailable.', input.actor);
			if (observation.outcome === 'mismatched') {
				await isolateIntegrityConflict({
					record,
					digest: record.digest,
					reasonCode: observation.reasonCode,
					observed: observationFacts(observation),
					actor: input.actor,
				});
				return await rejected(
					record,
					'canonical-mime-mismatch',
					'The stored object does not match its recorded size, canonical media type, and integrity metadata; it has been isolated as a critical integrity incident.',
					input.actor,
				);
			}

			// Source content re-proves the validation facts its revision recorded.
			// A Graphics Derivative has no revision of its own, so an exact digest,
			// size, and canonical media type is its complete proof.
			const verification = await media.verifyContentBytes({
				read: range => canonical.read(identity, range),
				expectedDigest: record.digest,
				expectedByteLength: expectation.byteLength,
				expectation: expectation.source
					? {
							kind: 'source',
							canonicalMime: expectation.canonicalMime,
							sourceKind: expectation.source.kind,
							facts: expectation.source.facts,
						}
					: { kind: 'derivative', canonicalMime: expectation.canonicalMime },
			});
			if (verification.outcome === 'rejected') {
				if (verification.code === 'digest-mismatch') {
					await isolateIntegrityConflict({
						record,
						digest: record.digest,
						reasonCode: 'canonical-object-digest-mismatch',
						observed: observationFacts(observation),
						actor: input.actor,
					});
				}
				return await rejected(record, verification.code, verification.message, input.actor);
			}

			// Verified bytes a quarantine record was holding are restored to the
			// catalogue by releasing that record rather than by copying anything.
			const released = await catalogue.releaseContentQuarantine({ digest: record.digest });
			return await completeRecovery({
				record,
				digest: record.digest,
				resolution: released ? 'restored-from-quarantine' : 'byte-store-agrees',
				category: released
					? 'content-restored-from-quarantine'
					: 'discrepancy-rechecked',
				reason: released
					? 'exact-verified-quarantine-copy'
					: 'stored-bytes-verified-against-expected-content',
				actor: input.actor,
			});
		},
		/**
		 * Regenerates one missing deterministic Graphics Derivative from available
		 * canonical source content. The source revision is never touched, and the
		 * result must reproduce the exact bytes the catalogue already recorded —
		 * anything else is a determinism failure, not a repair.
		 */
		async regenerateDerivative(input: {
			discrepancyId: string;
			actor: string;
		}): Promise<GraphicsDiscrepancyActionOutcome | undefined> {
			const record = await catalogue.findDiscrepancy({ id: input.discrepancyId });
			if (!record)
				return undefined;
			if (record.state === 'resolved')
				return await rejected(record, 'discrepancy-already-resolved', 'This discrepancy is already resolved.', input.actor);
			const regenerationRefusal = await isolationRefusal(record, input.actor);
			if (regenerationRefusal)
				return regenerationRefusal;
			if (record.kind !== 'missing-derivative' || !record.digest)
				return await rejected(record, 'action-not-valid-in-state', 'Derivative regeneration is not valid for this discrepancy.', input.actor);

			const expectation = await catalogue.findExpectedContent({ digest: record.digest });
			const derivative = expectation?.derivative;
			if (!expectation || !derivative)
				return await rejected(record, 'action-not-valid-in-state', 'The catalogue no longer expects this Graphics Derivative.', input.actor);
			if (!await canonicalObjectAgrees({
				digest: derivative.sourceDigest,
				byteLength: derivative.sourceByteLength,
				canonicalMime: derivative.sourceCanonicalMime,
			})) {
				return await rejected(record, 'source-content-unavailable', 'The canonical source content is not currently available.', input.actor);
			}

			const workingCopy = reconciliationWorkingCopyIdentity(record.id);
			const claimedAt = timestamp();
			if (!await catalogue.claimDiscrepancyWorkingCopy({
				id: record.id,
				workingCopyKey: workingCopy,
				claimedAt,
				staleClaimsBefore: graphicsRetentionDeadline(claimedAt, -GRAPHICS_WORKING_COPY_LEASE_MILLISECONDS),
			})) {
				return await rejected(record, 'action-not-valid-in-state', 'Another regeneration is already in progress for this discrepancy.', input.actor);
			}

			try {
				const generated = await media.regenerateDerivative({
					discrepancyId: record.id,
					derivativeKind: derivative.kind,
					sourceKind: derivative.sourceKind,
					sourceDigest: derivative.sourceDigest,
					sourceByteLength: derivative.sourceByteLength,
					sourceCanonicalMime: derivative.sourceCanonicalMime,
					sourceFacts: derivative.sourceFacts,
				});
				if (generated.outcome === 'unavailable')
					return await rejected(record, generated.code, generated.message, input.actor);

				const producedDigest = await media.sha256Hex(generated.bytes);
				if (producedDigest !== record.digest) {
					// Regeneration is defined as deterministic. Bytes that differ mean
					// the recorded derivative can no longer be reproduced, which is an
					// integrity conflict rather than something to write anyway.
					await isolateIntegrityConflict({
						record,
						digest: record.digest,
						reasonCode: 'derivative-regeneration-mismatch',
						observed: { present: false, byteLength: generated.bytes.byteLength },
						actor: input.actor,
					});
					return await rejected(
						record,
						'validation-facts-mismatch',
						'Regeneration did not reproduce the exact recorded derivative; the conflict has been isolated and nothing was written.',
						input.actor,
					);
				}

				const published = await publishVerifiedContent({
					digest: record.digest,
					byteLength: expectation.byteLength,
					canonicalMime: expectation.canonicalMime,
					bytes: {
						body: new ReadableStream<Uint8Array>({
							start(controller) {
								controller.enqueue(generated.bytes);
								controller.close();
							},
						}),
						byteLength: generated.bytes.byteLength,
						maximumByteLength: generated.bytes.byteLength,
					},
				});
				if (published.outcome === 'rejected')
					return await rejected(record, published.code, published.message, input.actor);

				return await completeRecovery({
					record,
					digest: record.digest,
					resolution: 'derivative-regenerated',
					category: 'derivative-regenerated',
					reason: 'deterministic-derivative-reproduced-from-source',
					actor: input.actor,
				});
			}
			finally {
				await releaseWorkingCopy(record.id, workingCopy);
			}
		},
	};
}
