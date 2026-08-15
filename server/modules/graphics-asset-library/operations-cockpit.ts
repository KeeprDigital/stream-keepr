import type {
	GraphicsAssetEvidenceCategory,
	GraphicsAssetEvidenceEntry,
	GraphicsAssetLibraryCapacity,
	GraphicsAssetLibraryHealth,
	GraphicsCockpitCapacity,
	GraphicsDiscrepancyKind,
	GraphicsIngestionAttentionItem,
	GraphicsLibraryComponentCondition,
	GraphicsLibraryConditionStatus,
	GraphicsLibraryConditionSummary,
	GraphicsLifecycleSummary,
	GraphicsOperationsCockpit,
	GraphicsRecentOutcome,
	GraphicsRecentOutcomeSummary,
	GraphicsReconciliationBacklog,
	GraphicsStorageHealthAlert,
	GraphicsStorageHealthAlertSummary,
} from '~~/shared/types/graphicsAsset';
import type {
	GraphicsIngestionAttentionState,
	GraphicsRecentOutcomeGroup,
	GraphicsStorageHealthAlertCode,
	GraphicsStorageHealthAlertSeverity,
} from '~~/shared/utils/graphicsOperationsCockpit';
import type { GraphicsReconciliationStateRecord } from './reconciliation';
import { GRAPHICS_CANONICAL_QUOTA_BOUNDARY_FRACTIONS } from '~~/shared/utils/graphicsAssetCapacity';
import { GRAPHICS_RETENTION_GUARANTEES } from '~~/shared/utils/graphicsAssetRetention';
import {
	GRAPHICS_INGESTION_ATTENTION_STATES,
	GRAPHICS_RECENT_OUTCOME_CATEGORIES,
	GRAPHICS_RECENT_OUTCOME_GROUPS,
	GRAPHICS_STORAGE_HEALTH_ALERT_SEVERITIES,
	graphicsDiscrepancyAlertCode,
	graphicsDiscrepancyDegradesCondition,
	graphicsDiscrepancySeverity,
	graphicsRecentOutcomeGroup,
	graphicsStorageHealthAlertPersists,
	graphicsStorageHealthAlertSeverity,
} from '~~/shared/utils/graphicsOperationsCockpit';

/** How many operations the cockpit's risk-ordered ingestion sample carries. */
const INGESTION_SAMPLE_LIMIT = 20;

/**
 * How many recent Evidence entries the outcome counts are taken over, and how
 * many of them are carried in the reading. The window is deliberately bounded:
 * the cockpit reports what happened recently, and the Evidence ledger remains
 * the place to read further back.
 */
const RECENT_OUTCOME_WINDOW = 200;
const RECENT_OUTCOME_SAMPLE_LIMIT = 20;

/** The soonest deadline a lifecycle group is holding, absent when it holds none. */
export interface GraphicsDeadlineGroupSummary {
	count: number;
	nextDeadline?: string;
}

/**
 * Counts and nearest deadlines across every lifecycle group, taken as
 * aggregates rather than by expanding the rows behind them. The cockpit is
 * installation-wide, so a backlog of any one group must not decide how much of
 * every other group it can report.
 */
export interface GraphicsRetentionDeadlineSummary {
	retiredCount: number;
	trashed: GraphicsDeadlineGroupSummary;
	supersededRevisions: GraphicsDeadlineGroupSummary;
	frozenRevisionCount: number;
	quarantinedContent: GraphicsDeadlineGroupSummary;
	stagedInput: GraphicsDeadlineGroupSummary;
}

/**
 * What the catalogue returns for unfinished ingestion. The counts are partial
 * because the grouping query returns only the states that actually occur; the
 * reading fills the rest in with zero.
 */
export interface GraphicsIngestionAttentionRead {
	counts: Partial<Record<GraphicsIngestionAttentionState, number>>;
	operations: GraphicsIngestionAttentionItem[];
}

/**
 * The catalogue capabilities the Operations Cockpit reads. Every one is an
 * aggregate or a bounded, ordered sample, so the cost of one reading does not
 * grow with the size of the library.
 */
export interface GraphicsOperationsCockpitCatalogue {
	getCapacity: () => Promise<GraphicsAssetLibraryCapacity>;
	/** How many Graphic Asset Contents the catalogue records as unresolvable. */
	countUnavailableContent: () => Promise<number>;
	countOpenDiscrepancies: () => Promise<Record<GraphicsDiscrepancyKind, number>>;
	countIsolatedDiscrepancies: () => Promise<number>;
	getReconciliationState: () => Promise<GraphicsReconciliationStateRecord>;
	summariseIngestionAttention: (input: {
		now: string;
		limit: number;
	}) => Promise<GraphicsIngestionAttentionRead>;
	/** Terminal operations whose staged objects a failed release stranded (#358). */
	countUnreleasedStagedInput: () => Promise<number>;
	summariseRetentionDeadlines: () => Promise<GraphicsRetentionDeadlineSummary>;
	listGraphicsAssetEvidence: (input: {
		limit: number;
		categories?: readonly GraphicsAssetEvidenceCategory[];
	}) => Promise<GraphicsAssetEvidenceEntry[]>;
}

export interface GraphicsOperationsCockpitDependencies {
	/** Liveness of each component, probed before anything else is attempted. */
	probeHealth: () => Promise<GraphicsAssetLibraryHealth>;
	/**
	 * Resolved only once the catalogue is known to be answering, so a reading
	 * taken while D1 is down never has to reach a catalogue to say so.
	 */
	catalogue: () => GraphicsOperationsCockpitCatalogue;
	now: () => Date;
}

const CONDITION_RANK: Record<GraphicsLibraryConditionStatus, number> = {
	healthy: 0,
	degraded: 1,
	unavailable: 2,
};

const SEVERITY_RANK: Record<GraphicsStorageHealthAlertSeverity, number> = {
	critical: 0,
	warning: 1,
	info: 2,
};

function emptySeverityCounts(): Record<GraphicsStorageHealthAlertSeverity, number> {
	return Object.fromEntries(
		GRAPHICS_STORAGE_HEALTH_ALERT_SEVERITIES.map(severity => [severity, 0]),
	) as Record<GraphicsStorageHealthAlertSeverity, number>;
}

function emptyOutcomeCounts(): Record<GraphicsRecentOutcomeGroup, number> {
	return Object.fromEntries(
		GRAPHICS_RECENT_OUTCOME_GROUPS.map(group => [group, 0]),
	) as Record<GraphicsRecentOutcomeGroup, number>;
}

/**
 * Collects the alerts, ordered most severe first, and counts them by severity.
 * An alert with no open subject is never raised, so the presence of an alert is
 * itself the finding.
 *
 * The severity counts are counts of *subjects*, not of alert codes, and are the
 * same unit the reconciliation backlog counts in. Counting codes here would put
 * two different questions behind one identical-looking number: forty missing
 * derivatives and one unavailable content would read as "2 warning" beside the
 * backlog's "41 warning", and nothing on the surface would explain the gap.
 */
function summariseAlerts(
	raised: readonly { code: GraphicsStorageHealthAlertCode; openCount: number }[],
): GraphicsStorageHealthAlertSummary {
	const countsBySeverity = emptySeverityCounts();
	const open = raised
		.filter(alert => alert.openCount > 0)
		.map((alert): GraphicsStorageHealthAlert => ({
			code: alert.code,
			severity: graphicsStorageHealthAlertSeverity(alert.code),
			openCount: alert.openCount,
			persistent: graphicsStorageHealthAlertPersists(alert.code),
		}))
		.sort((first, second) =>
			SEVERITY_RANK[first.severity] - SEVERITY_RANK[second.severity]);
	for (const alert of open)
		countsBySeverity[alert.severity] += alert.openCount;
	return { countsBySeverity, open };
}

type GraphicsLibraryComponent = 'catalogue' | 'canonical' | 'staging';

/**
 * The alert each component's liveness raises. A component that cannot answer is
 * the most urgent thing an administrator can be told.
 */
const LIVENESS_ALERT_CODES: Record<GraphicsLibraryComponent, GraphicsStorageHealthAlertCode> = {
	catalogue: 'catalogue-unavailable',
	canonical: 'canonical-byte-store-unavailable',
	staging: 'staging-byte-store-unavailable',
};

const UNAVAILABLE_REASON_CODES: Record<
	GraphicsLibraryComponent,
	'catalogue-unavailable' | 'byte-store-unavailable'
> = {
	catalogue: 'catalogue-unavailable',
	canonical: 'byte-store-unavailable',
	staging: 'byte-store-unavailable',
};

function unavailableCondition(
	component: GraphicsLibraryComponent,
): GraphicsLibraryComponentCondition {
	return {
		status: 'unavailable',
		reason: { code: UNAVAILABLE_REASON_CODES[component], retryable: true },
	};
}

function worstStatus(
	conditions: readonly GraphicsLibraryComponentCondition[],
): GraphicsLibraryConditionStatus {
	return conditions.reduce<GraphicsLibraryConditionStatus>(
		(worst, condition) =>
			CONDITION_RANK[condition.status] > CONDITION_RANK[worst] ? condition.status : worst,
		'healthy',
	);
}

/**
 * Takes one Operations Cockpit reading.
 *
 * It composes readings the library already owns rather than holding state of
 * its own: component liveness, the durable disagreements reconciliation
 * recorded, capacity, ingestion stages, retention deadlines, and Evidence. A
 * cockpit reading is therefore always reproducible, and a critical incident it
 * reports stays reported until the incident itself is resolved.
 *
 * Liveness is probed first because a component that cannot answer cannot be
 * judged for agreement, and because a catalogue that cannot answer must still
 * produce the safety answer the cockpit exists to give.
 */
export async function readGraphicsOperationsCockpit(
	dependencies: GraphicsOperationsCockpitDependencies,
): Promise<GraphicsOperationsCockpit> {
	const { now, probeHealth } = dependencies;
	const health = await probeHealth();
	const checkedAt = now().toISOString();
	const stagingByteStore: GraphicsLibraryComponentCondition
		= health.byteStores.staging.status === 'healthy'
			? { status: 'healthy' }
			: unavailableCondition('staging');

	if (health.catalogue.status !== 'healthy') {
		const canonicalByteStore: GraphicsLibraryComponentCondition
			= health.byteStores.canonical.status === 'healthy'
				? { status: 'healthy' }
				: unavailableCondition('canonical');
		const condition: GraphicsLibraryConditionSummary = {
			status: 'unavailable',
			catalogue: unavailableCondition('catalogue'),
			canonicalByteStore,
			stagingByteStore,
		};
		return {
			outcome: 'catalogue-unavailable',
			checkedAt,
			condition,
			alerts: summariseAlerts([
				{ code: LIVENESS_ALERT_CODES.catalogue, openCount: 1 },
				{
					code: LIVENESS_ALERT_CODES.canonical,
					openCount: canonicalByteStore.status === 'unavailable' ? 1 : 0,
				},
				{
					code: LIVENESS_ALERT_CODES.staging,
					openCount: stagingByteStore.status === 'unavailable' ? 1 : 0,
				},
			]),
		};
	}

	const catalogue = dependencies.catalogue();
	const [
		capacity,
		unavailableContentCount,
		openCounts,
		isolatedIncidentCount,
		reconciliationState,
		ingestion,
		unreleasedStagedInputCount,
		retention,
		evidence,
	] = await Promise.all([
		catalogue.getCapacity(),
		catalogue.countUnavailableContent(),
		catalogue.countOpenDiscrepancies(),
		catalogue.countIsolatedDiscrepancies(),
		catalogue.getReconciliationState(),
		catalogue.summariseIngestionAttention({
			now: checkedAt,
			limit: INGESTION_SAMPLE_LIMIT,
		}),
		catalogue.countUnreleasedStagedInput(),
		catalogue.summariseRetentionDeadlines(),
		catalogue.listGraphicsAssetEvidence({
			limit: RECENT_OUTCOME_WINDOW,
			categories: GRAPHICS_RECENT_OUTCOME_CATEGORIES,
		}),
	]);

	const condition = describeCondition({
		health,
		stagingByteStore,
		unavailableContentCount,
		openCounts,
	});

	const attentionCounts = { ...emptyAttentionCounts(), ...ingestion.counts };

	return {
		outcome: 'complete',
		checkedAt,
		condition,
		alerts: summariseAlerts([
			{
				code: LIVENESS_ALERT_CODES.canonical,
				openCount: condition.canonicalByteStore.status === 'unavailable' ? 1 : 0,
			},
			{
				code: LIVENESS_ALERT_CODES.staging,
				openCount: stagingByteStore.status === 'unavailable' ? 1 : 0,
			},
			...Object.entries(openCounts).map(([kind, openCount]) => ({
				code: graphicsDiscrepancyAlertCode(kind as GraphicsDiscrepancyKind),
				openCount,
			})),
			...quotaAlerts(capacity),
			{
				code: 'graphics-ingestion-input-expired' as const,
				openCount: attentionCounts['input-expired'],
			},
			// Backed by the durable byte accounting itself, so it stands until
			// the release is proven and cannot be dismissed by a reload (#358).
			{
				code: 'graphics-staged-input-unreleased' as const,
				openCount: unreleasedStagedInputCount,
			},
		]),
		capacity: describeCapacity(capacity),
		ingestion: {
			counts: attentionCounts,
			operations: ingestion.operations,
		},
		reconciliation: describeBacklog({
			openCounts,
			isolatedIncidentCount,
			state: reconciliationState,
		}),
		lifecycle: describeLifecycle(retention),
		recentOutcomes: describeRecentOutcomes(evidence),
	};
}

function emptyAttentionCounts(): Record<GraphicsIngestionAttentionState, number> {
	return Object.fromEntries(
		GRAPHICS_INGESTION_ATTENTION_STATES.map(state => [state, 0]),
	) as Record<GraphicsIngestionAttentionState, number>;
}

/**
 * Judges each side against its own durable evidence.
 *
 * The catalogue is degraded by the Unavailable Graphic Asset Content it has
 * itself recorded; the canonical byte store is degraded by the disagreements
 * reconciliation observed in it.
 *
 * Reading the advisory availability flag as the catalogue's condition is
 * deliberate, and is not a breach of the authority contract. The contract
 * forbids treating that flag as a *reader* authority — nobody may serve or
 * withhold bytes on the strength of it. Here it is read as the catalogue's
 * self-knowledge: what D1 believes about its own contents, which is exactly
 * what a catalogue-condition question asks. The byte store is still asked
 * separately, and is still the only thing that decides which bytes exist.
 *
 * The two answers usually corroborate rather than diverge — one lost object
 * both flags the catalogue and opens a discrepancy — and that is the point.
 * They are sourced independently, so when they *do* disagree, the disagreement
 * is information: a flagged catalogue with a clean byte store means the flag is
 * stale, and a clean catalogue with open discrepancies means a sweep has not
 * caught up yet. One merged number could report neither.
 */
function describeCondition(input: {
	health: GraphicsAssetLibraryHealth;
	stagingByteStore: GraphicsLibraryComponentCondition;
	unavailableContentCount: number;
	openCounts: Record<GraphicsDiscrepancyKind, number>;
}): GraphicsLibraryConditionSummary {
	const catalogue: GraphicsLibraryComponentCondition = input.unavailableContentCount > 0
		? {
				status: 'degraded',
				reason: {
					code: 'catalogue-records-unavailable-content',
					retryable: true,
					openCount: input.unavailableContentCount,
				},
			}
		: { status: 'healthy' };

	const disagreementCount = Object.entries(input.openCounts)
		.filter(([kind]) => graphicsDiscrepancyDegradesCondition(kind as GraphicsDiscrepancyKind))
		.reduce((total, [, count]) => total + count, 0);
	const canonicalByteStore: GraphicsLibraryComponentCondition
		= input.health.byteStores.canonical.status !== 'healthy'
			? unavailableCondition('canonical')
			: disagreementCount > 0
				? {
						status: 'degraded',
						reason: {
							code: 'canonical-bytes-disagree-with-catalogue',
							retryable: true,
							openCount: disagreementCount,
						},
					}
				: { status: 'healthy' };

	return {
		status: worstStatus([catalogue, canonicalByteStore, input.stagingByteStore]),
		catalogue,
		canonicalByteStore,
		stagingByteStore: input.stagingByteStore,
	};
}

/**
 * The quota alert current use has crossed. Only the highest boundary crossed is
 * raised: telling an administrator that a full quota is also above 80% adds
 * nothing to the decision in front of them.
 */
function quotaAlerts(
	capacity: GraphicsAssetLibraryCapacity,
): { code: GraphicsStorageHealthAlertCode; openCount: number }[] {
	const canonical: GraphicsStorageHealthAlertCode | undefined
		= capacity.canonical.pressure === 'full'
			? 'canonical-quota-full'
			: capacity.canonical.pressure === 'critical'
				? 'canonical-quota-critical'
				: capacity.canonical.pressure === 'warning'
					? 'canonical-quota-warning'
					: undefined;
	return [
		...(canonical ? [{ code: canonical, openCount: 1 }] : []),
		...(capacity.staging.availableBytes <= 0
			? [{ code: 'staging-allowance-exhausted' as const, openCount: 1 }]
			: []),
	];
}

/**
 * Canonical use against its exact boundaries, and staging as its own budget.
 * The boundaries are stated in bytes as well as fractions so the surface
 * showing them never has to recompute where a threshold sits.
 */
function describeCapacity(capacity: GraphicsAssetLibraryCapacity): GraphicsCockpitCapacity {
	const limit = capacity.canonical.limitBytes;
	return {
		canonical: {
			...capacity.canonical,
			usedFraction: limit > 0 ? capacity.canonical.usedBytes / limit : 0,
			boundaries: {
				warningFraction: GRAPHICS_CANONICAL_QUOTA_BOUNDARY_FRACTIONS.warning,
				criticalFraction: GRAPHICS_CANONICAL_QUOTA_BOUNDARY_FRACTIONS.critical,
				fullFraction: GRAPHICS_CANONICAL_QUOTA_BOUNDARY_FRACTIONS.full,
				warningBytes: Math.round(limit * GRAPHICS_CANONICAL_QUOTA_BOUNDARY_FRACTIONS.warning),
				criticalBytes: Math.round(limit * GRAPHICS_CANONICAL_QUOTA_BOUNDARY_FRACTIONS.critical),
				fullBytes: limit,
			},
		},
		staging: {
			...capacity.staging,
			usedFraction: capacity.staging.limitBytes > 0
				? capacity.staging.usedBytes / capacity.staging.limitBytes
				: 0,
		},
	};
}

function describeBacklog(input: {
	openCounts: Record<GraphicsDiscrepancyKind, number>;
	isolatedIncidentCount: number;
	state: GraphicsReconciliationStateRecord;
}): GraphicsReconciliationBacklog {
	const countsBySeverity = emptySeverityCounts();
	for (const [kind, count] of Object.entries(input.openCounts)) {
		countsBySeverity[graphicsDiscrepancySeverity(kind as GraphicsDiscrepancyKind)]
			+= count;
	}
	return {
		authority: {
			expectedReachability: 'catalogue',
			presentBytes: 'byte-store',
			contentAvailabilityFlag: 'advisory-reconciliation-state',
		},
		...(input.state.lastSweepCorrelationId
			&& input.state.lastSweepStartedAt
			&& input.state.lastSweepCompletedAt
			? {
					lastSweep: {
						correlationId: input.state.lastSweepCorrelationId,
						startedAt: input.state.lastSweepStartedAt,
						completedAt: input.state.lastSweepCompletedAt,
					},
				}
			: {}),
		openCounts: input.openCounts,
		countsBySeverity,
		isolatedIncidentCount: input.isolatedIncidentCount,
	};
}

/**
 * Every lifecycle group with the guarantee it is held to. Retirement is the one
 * reversible state with no deadline, and saying so explicitly is the point:
 * an administrator must not read its absent deadline as an oversight.
 */
function describeLifecycle(
	retention: GraphicsRetentionDeadlineSummary,
): GraphicsLifecycleSummary {
	return {
		retired: { count: retention.retiredCount, reversibleWithoutDeadline: true },
		trashed: {
			...retention.trashed,
			guaranteeMilliseconds: GRAPHICS_RETENTION_GUARANTEES.trashRecoveryMilliseconds,
		},
		supersededRevisions: {
			...retention.supersededRevisions,
			guaranteeMilliseconds: GRAPHICS_RETENTION_GUARANTEES.supersededRevisionMilliseconds,
		},
		frozenRevisions: { count: retention.frozenRevisionCount },
		quarantinedContent: {
			...retention.quarantinedContent,
			guaranteeMilliseconds: GRAPHICS_RETENTION_GUARANTEES.orphanContentQuarantineMilliseconds,
		},
		stagedInput: {
			...retention.stagedInput,
			guaranteeMilliseconds: GRAPHICS_RETENTION_GUARANTEES.completedInputMilliseconds,
		},
		guaranteesShortenedUnderPressure: false,
	};
}

function describeRecentOutcomes(
	entries: readonly GraphicsAssetEvidenceEntry[],
): GraphicsRecentOutcomeSummary {
	const countsByGroup = emptyOutcomeCounts();
	const outcomes: GraphicsRecentOutcome[] = [];
	for (const entry of entries) {
		const group = graphicsRecentOutcomeGroup(entry.category);
		if (!group)
			continue;
		countsByGroup[group] += 1;
		outcomes.push({
			id: entry.id,
			recordedAt: entry.recordedAt,
			group,
			category: entry.category,
			subject: entry.subject,
			outcome: entry.outcome,
			reason: entry.reason,
		});
	}
	return {
		// Every entry the window offered, not the subset that mapped to a group.
		// Counting the mapped ones would make the denominator move whenever the
		// mapping changed, and silently claim a smaller window had been read.
		consideredEntryCount: entries.length,
		countsByGroup,
		entries: outcomes.slice(0, RECENT_OUTCOME_SAMPLE_LIMIT),
	};
}
