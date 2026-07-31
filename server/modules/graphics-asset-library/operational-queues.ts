/**
 * The Graphics Asset Library's risk-ordered operational queues.
 *
 * The Operations Cockpit answers whether the library is safe. These queues
 * answer what to do about it: they organise the same durable state by the
 * operational meaning of the work rather than by the provider objects
 * underneath, order it so the most dangerous and the soonest-expiring work
 * comes first, and offer only the actions valid for the state each item is
 * actually in.
 *
 * Nothing here holds state of its own. Every reading is composed from
 * aggregates and bounded, ordered samples the catalogue already owns, so a
 * queue reading costs the same against any size of backlog and is always
 * reproducible from the catalogue.
 */
import type {
	GraphicAssetId,
	GraphicAssetRetentionView,
	GraphicAssetRevisionId,
	GraphicAssetRevisionRetention,
	GraphicAssetUsage,
	GraphicsAssetEvidenceEntry,
	GraphicsDiscrepancy,
	GraphicsDiscrepancyKind,
	GraphicsIngestionAttentionItem,
	GraphicsOperationalQueue,
	GraphicsOperationalQueueItem,
	GraphicsOperationalQueuesOverview,
	GraphicsQueueInspection,
	GraphicsReconciliationOverview,
	GraphicsRevisionPruningDeadline,
	GraphicsTrashDeadline,
} from '~~/shared/types/graphicsAsset';
import type {
	GraphicsOperationalQueueId,
	GraphicsQueueAction,
} from '~~/shared/utils/graphicsOperationalQueues';
import type { GraphicsIngestionAttentionState } from '~~/shared/utils/graphicsOperationsCockpit';
import type { GraphicsRetentionDeadlineSummary } from './operations-cockpit';
import type { RetiredGraphicAsset } from './retention';
import {
	GRAPHICS_OPERATIONAL_QUEUES,
	graphicsQueueSeverity,
} from '~~/shared/utils/graphicsOperationalQueues';
import { GraphicsAssetLibraryError } from './errors';

/**
 * How many items each queue carries.
 *
 * Every queue is sampled independently so a backlog of one kind cannot crowd
 * out another: an administrator with four thousand superseded revisions must
 * still see the critical incident. The complete size of each queue is reported
 * as a count regardless.
 */
export const GRAPHICS_QUEUE_ITEM_LIMIT = 50;

/** How many Evidence entries one inspection reads for its subject. */
export const GRAPHICS_QUEUE_INSPECTION_EVIDENCE_LIMIT = 50;

/**
 * The catalogue capabilities the queues read. Every one is an aggregate or a
 * bounded, ordered sample.
 */
export interface GraphicsOperationalQueuesCatalogue {
	countOpenDiscrepancies: () => Promise<Record<GraphicsDiscrepancyKind, number>>;
	/** Complete counts, plus one independent bounded sample per queued state. */
	summariseIngestionQueues: (input: {
		now: string;
		limit: number;
	}) => Promise<{
		counts: Partial<Record<GraphicsIngestionAttentionState, number>>;
		retryable: GraphicsIngestionAttentionItem[];
		expired: GraphicsIngestionAttentionItem[];
	}>;
	findIngestionAttentionItem: (input: {
		now: string;
		operationId: string;
	}) => Promise<GraphicsIngestionAttentionItem | undefined>;
	summariseRetentionDeadlines: () => Promise<GraphicsRetentionDeadlineSummary>;
	listTrashDeadlines: (input: { limit: number }) => Promise<GraphicsTrashDeadline[]>;
	listRevisionRetention: (input: {
		assetId?: GraphicAssetId;
		limit: number;
		prunableOnly?: boolean;
	}) => Promise<GraphicsRevisionPruningDeadline[]>;
	/** Retired assets, oldest first, with the pinned usage each still carries. */
	listRetiredGraphicAssets: (input: { limit: number }) => Promise<RetiredGraphicAsset[]>;
	findRevisionRetention: (
		revisionId: GraphicAssetRevisionId,
	) => Promise<GraphicsRevisionPruningDeadline | undefined>;
	findGraphicAssetName: (assetId: GraphicAssetId) => Promise<string | undefined>;
	listGraphicsAssetEvidence: (input: {
		limit: number;
		subject?: { kind: GraphicsAssetEvidenceEntry['subject']['kind']; id: string };
	}) => Promise<GraphicsAssetEvidenceEntry[]>;
	listGraphicAssetUsage: (assetId: GraphicAssetId) => Promise<GraphicAssetUsage[]>;
}

export interface GraphicsOperationalQueuesDependencies {
	catalogue: () => GraphicsOperationalQueuesCatalogue;
	reconciliation: () => {
		overview: () => Promise<GraphicsReconciliationOverview>;
		inspect: (input: { discrepancyId: string }) => Promise<GraphicsDiscrepancy | undefined>;
	};
	/** One Graphic Asset's lifecycle and per-revision retention. */
	inspectRetention: (assetId: GraphicAssetId) => Promise<GraphicAssetRetentionView | undefined>;
	now: () => Date;
}

/** Which queue each open discrepancy kind belongs in. */
const DISCREPANCY_QUEUES: Record<GraphicsDiscrepancyKind, GraphicsOperationalQueueId> = {
	'critical-integrity-incident': 'critical-integrity-incident',
	'unavailable-content': 'unavailable-content',
	'missing-derivative': 'missing-derivative',
	'unexpected-object': 'quarantined-object',
};

/** The queues whose subject is a Graphics Discrepancy rather than a domain record. */
const DISCREPANCY_QUEUE_IDS = new Set<GraphicsOperationalQueueId>(
	Object.values(DISCREPANCY_QUEUES),
);

/** Which queue each unfinished ingestion state belongs in, where one applies. */
const INGESTION_QUEUES: Partial<
	Record<GraphicsIngestionAttentionState, GraphicsOperationalQueueId>
> = {
	'retryable': 'retryable-ingestion',
	'input-expired': 'expired-ingestion-input',
};

/** A selection key that survives navigation, reload, and the next poll. */
export function graphicsQueueItemKey(
	queue: GraphicsOperationalQueueId,
	subjectId: string,
): string {
	return `${queue}:${subjectId}`;
}

/**
 * Orders work by how little time is left to act on it.
 *
 * Severity already separates the queues, so within one queue the deadline is
 * the whole of the risk. An item with no deadline sorts last: it is the only
 * kind of work nothing takes away.
 */
function byDeadline(
	first: { deadline?: string },
	second: { deadline?: string },
): number {
	if (first.deadline === second.deadline)
		return 0;
	if (first.deadline === undefined)
		return 1;
	if (second.deadline === undefined)
		return -1;
	return first.deadline < second.deadline ? -1 : 1;
}

function buildQueue(
	id: GraphicsOperationalQueueId,
	totalCount: number,
	items: GraphicsOperationalQueueItem[],
): GraphicsOperationalQueue {
	const ordered = [...items].sort(byDeadline).slice(0, GRAPHICS_QUEUE_ITEM_LIMIT);
	return {
		id,
		severity: graphicsQueueSeverity(id),
		totalCount,
		...(ordered[0]?.deadline === undefined ? {} : { nextDeadline: ordered[0].deadline }),
		items: ordered,
	};
}

/**
 * How a discrepancy describes itself in a queue.
 *
 * The affected asset names it, because an administrator triages by the thing
 * that is broken rather than by the opaque identity of the disagreement about
 * it. A discrepancy that affects nothing nameable is titled by its own reason
 * code, which is still a stable domain fact.
 */
function discrepancyTitle(discrepancy: GraphicsDiscrepancy): string {
	const affected = discrepancy.affectedUsage[0];
	if (affected)
		return `${affected.assetName} · revision ${affected.revisionNumber}`;
	if (discrepancy.derivative)
		return `Graphics Derivative · ${discrepancy.derivative.kind}`;
	return discrepancy.reasonCode;
}

function discrepancyItem(discrepancy: GraphicsDiscrepancy): GraphicsOperationalQueueItem {
	// Strictly by kind, so the items in a queue and the count beside them are
	// the same population. Reconciliation opens a separate critical incident
	// when it isolates something, so an isolated row never needs re-routing —
	// and re-routing it would count it in two queues at once.
	const queue = DISCREPANCY_QUEUES[discrepancy.kind];
	return {
		key: graphicsQueueItemKey(queue, discrepancy.id),
		queue,
		subject: { kind: 'graphics-discrepancy', id: discrepancy.id },
		title: discrepancyTitle(discrepancy),
		...(discrepancy.quarantine ? { deadline: discrepancy.quarantine.deleteAfter } : {}),
		referenceCount: discrepancy.affectedUsage
			.reduce((total, usage) => total + usage.referenceCount, 0),
		// Carried through unchanged: the library decides which actions are valid
		// and re-proves that decision before writing anything.
		actions: [...discrepancy.actions] as GraphicsQueueAction[],
	};
}

function trashItem(deadline: GraphicsTrashDeadline): GraphicsOperationalQueueItem {
	return {
		key: graphicsQueueItemKey('trashed-asset', deadline.assetId),
		queue: 'trashed-asset',
		subject: { kind: 'graphic-asset', id: deadline.assetId },
		title: deadline.name,
		deadline: deadline.recoverableUntil,
		referenceCount: deadline.referenceCount,
		// Purge is offered even while usage is pinned: the library proves usage
		// afresh inside the purge transaction and reports what it found, and
		// hiding the action would hide that answer.
		actions: ['restore-graphic-asset', 'purge-now'],
	};
}

/** A revision with an actual pruning deadline, rather than one merely retained. */
type PrunableRevision = GraphicsRevisionPruningDeadline & {
	retention: Extract<GraphicAssetRevisionRetention, { policy: 'unreferenced-superseded' }>;
};

function isPrunableRevision(
	deadline: GraphicsRevisionPruningDeadline,
): deadline is PrunableRevision {
	return deadline.retention.policy === 'unreferenced-superseded';
}

function supersededItem(deadline: PrunableRevision): GraphicsOperationalQueueItem {
	return {
		key: graphicsQueueItemKey('superseded-revision', deadline.revisionId),
		queue: 'superseded-revision',
		subject: { kind: 'graphic-asset-revision', id: deadline.revisionId },
		title: `Revision ${deadline.revisionNumber}`,
		deadline: deadline.retention.pruneAfter,
		referenceCount: 0,
		// Pruning is the retention sweep's own decision, and a new reference
		// cancels it. Nothing an administrator can do here is valid.
		actions: [],
	};
}

function ingestionItem(
	item: GraphicsIngestionAttentionItem,
	queue: GraphicsOperationalQueueId,
): GraphicsOperationalQueueItem {
	return {
		key: graphicsQueueItemKey(queue, item.operationId),
		queue,
		subject: { kind: 'graphics-ingestion-operation', id: item.operationId },
		title: item.name,
		deadline: item.inputExpiresAt,
		// Expired staged input cannot be resumed: a new operation is required.
		actions: queue === 'retryable-ingestion' ? ['retry-ingestion'] : [],
	};
}

function retiredItem(asset: RetiredGraphicAsset): GraphicsOperationalQueueItem {
	return {
		key: graphicsQueueItemKey('retired-asset', asset.assetId),
		queue: 'retired-asset',
		subject: { kind: 'graphic-asset', id: asset.assetId },
		title: asset.name,
		// Retirement is reversible and never expires, so it has no deadline at
		// all. An administrator must not read that absence as an oversight.
		referenceCount: asset.referenceCount,
		actions: ['restore-graphic-asset'],
	};
}

function notFound(message: string): never {
	throw new GraphicsAssetLibraryError(message, 'graphics-subject-not-found');
}

export function createGraphicsOperationalQueues(
	dependencies: GraphicsOperationalQueuesDependencies,
) {
	const { now } = dependencies;

	return {
		/**
		 * One risk-ordered reading of every queue.
		 *
		 * Every queue is always present so an empty one reads as empty rather
		 * than as missing, and they arrive in the order the work should be
		 * done: severity first, then deadline proximity within each queue.
		 */
		async overview(): Promise<GraphicsOperationalQueuesOverview> {
			const catalogue = dependencies.catalogue();
			const checkedAt = now().toISOString();
			const [
				reconciliation,
				ingestion,
				retentionCounts,
				trashDeadlines,
				revisionDeadlines,
				retiredAssets,
			] = await Promise.all([
				dependencies.reconciliation().overview(),
				// Each queued state gets its own budget: one shared sample ordered
				// expired-before-retryable empties the retryable queue behind any
				// backlog of expired input, and a queue whose only action is
				// unreachable is the same as no queue at all.
				catalogue.summariseIngestionQueues({
					now: checkedAt,
					limit: GRAPHICS_QUEUE_ITEM_LIMIT,
				}),
				catalogue.summariseRetentionDeadlines(),
				catalogue.listTrashDeadlines({ limit: GRAPHICS_QUEUE_ITEM_LIMIT }),
				// Frozen and referenced revisions are excluded at the query rather
				// than after the slice, so the sample budget is spent on revisions
				// that are actually being pruned and matches the count beside it.
				catalogue.listRevisionRetention({
					limit: GRAPHICS_QUEUE_ITEM_LIMIT,
					prunableOnly: true,
				}),
				catalogue.listRetiredGraphicAssets({ limit: GRAPHICS_QUEUE_ITEM_LIMIT }),
			]);

			const discrepancyItems = new Map<GraphicsOperationalQueueId, GraphicsOperationalQueueItem[]>();
			for (const discrepancy of reconciliation.discrepancies) {
				const item = discrepancyItem(discrepancy);
				const existing = discrepancyItems.get(item.queue);
				if (existing)
					existing.push(item);
				else
					discrepancyItems.set(item.queue, [item]);
			}

			const totals: Record<GraphicsOperationalQueueId, number> = {
				'critical-integrity-incident':
					reconciliation.openCounts['critical-integrity-incident'],
				'unavailable-content': reconciliation.openCounts['unavailable-content'],
				'missing-derivative': reconciliation.openCounts['missing-derivative'],
				'quarantined-object': reconciliation.openCounts['unexpected-object'],
				'retryable-ingestion': ingestion.counts.retryable ?? 0,
				'expired-ingestion-input': ingestion.counts['input-expired'] ?? 0,
				'trashed-asset': retentionCounts.trashed.count,
				'superseded-revision': retentionCounts.supersededRevisions.count,
				'retired-asset': retentionCounts.retiredCount,
			};

			const itemsByQueue: Record<GraphicsOperationalQueueId, GraphicsOperationalQueueItem[]> = {
				'critical-integrity-incident': discrepancyItems.get('critical-integrity-incident') ?? [],
				'unavailable-content': discrepancyItems.get('unavailable-content') ?? [],
				'missing-derivative': discrepancyItems.get('missing-derivative') ?? [],
				'quarantined-object': discrepancyItems.get('quarantined-object') ?? [],
				'retryable-ingestion': ingestion.retryable
					.map(operation => ingestionItem(operation, 'retryable-ingestion')),
				'expired-ingestion-input': ingestion.expired
					.map(operation => ingestionItem(operation, 'expired-ingestion-input')),
				'trashed-asset': trashDeadlines.map(trashItem),
				'superseded-revision': revisionDeadlines
					.filter(isPrunableRevision)
					.map(supersededItem),
				'retired-asset': retiredAssets.map(retiredItem),
			};

			return {
				checkedAt,
				// The same contract reconciliation states, restated so a queue
				// reader never has to infer which side decides what.
				authority: reconciliation.authority,
				queues: GRAPHICS_OPERATIONAL_QUEUES.map(id =>
					buildQueue(id, totals[id], itemsByQueue[id])),
			};
		},

		/**
		 * Everything the persistent inspector shows for one selected item.
		 *
		 * The queue is part of the request rather than inferred, so an inspection
		 * fails loudly when a subject has moved on instead of quietly describing
		 * it in a state it left. The Evidence ledger is read filtered to exactly
		 * this subject, not to the newest rows the installation happens to hold.
		 */
		async inspect(input: {
			queue: GraphicsOperationalQueueId;
			subjectId: string;
		}): Promise<GraphicsQueueInspection> {
			const catalogue = dependencies.catalogue();
			const authority = {
				expectedReachability: 'catalogue',
				presentBytes: 'byte-store',
				contentAvailabilityFlag: 'advisory-reconciliation-state',
			} as const;

			const base = {
				key: graphicsQueueItemKey(input.queue, input.subjectId),
				queue: input.queue,
				severity: graphicsQueueSeverity(input.queue),
				authority,
			};

			async function evidenceFor(
				kind: GraphicsAssetEvidenceEntry['subject']['kind'],
				id: string,
			) {
				return await catalogue.listGraphicsAssetEvidence({
					limit: GRAPHICS_QUEUE_INSPECTION_EVIDENCE_LIMIT,
					subject: { kind, id },
				});
			}

			if (DISCREPANCY_QUEUE_IDS.has(input.queue)) {
				const discrepancy = await dependencies.reconciliation()
					.inspect({ discrepancyId: input.subjectId });
				if (!discrepancy)
					notFound('Graphics discrepancy not found');
				const item = discrepancyItem(discrepancy);
				if (item.queue !== input.queue)
					notFound('Graphics discrepancy is no longer in that queue');
				return {
					...base,
					subject: item.subject,
					title: item.title,
					...(item.deadline === undefined ? {} : { deadline: item.deadline }),
					referenceCount: item.referenceCount ?? 0,
					actions: item.actions,
					detail: { kind: 'graphics-discrepancy', discrepancy },
					evidence: await evidenceFor('graphics-discrepancy', discrepancy.id),
				};
			}

			if (input.queue === 'trashed-asset' || input.queue === 'retired-asset') {
				const assetId = input.subjectId as GraphicAssetId;
				const retention = await dependencies.inspectRetention(assetId);
				if (!retention)
					notFound('Graphic Asset not found');
				const expected = input.queue === 'trashed-asset' ? 'trashed' : 'retired';
				if (retention.lifecycle.state !== expected)
					notFound('Graphic Asset is no longer in that queue');
				const [usage, name] = await Promise.all([
					catalogue.listGraphicAssetUsage(assetId),
					catalogue.findGraphicAssetName(assetId),
				]);
				return {
					...base,
					subject: { kind: 'graphic-asset', id: assetId },
					title: name ?? assetId,
					...(retention.lifecycle.state === 'trashed'
						? { deadline: retention.lifecycle.recoverableUntil }
						: {}),
					referenceCount: usage.length,
					actions: input.queue === 'trashed-asset'
						? ['restore-graphic-asset', 'purge-now']
						: ['restore-graphic-asset'],
					detail: {
						kind: 'graphic-asset',
						lifecycle: retention.lifecycle,
						revisions: retention.revisions,
						usage,
					},
					evidence: await evidenceFor('graphic-asset', assetId),
				};
			}

			if (input.queue === 'superseded-revision') {
				const revisionId = input.subjectId as GraphicAssetRevisionId;
				const deadline = await catalogue.findRevisionRetention(revisionId);
				if (!deadline || !isPrunableRevision(deadline))
					notFound('Graphic Asset Revision is no longer in that queue');
				return {
					...base,
					subject: { kind: 'graphic-asset-revision', id: revisionId },
					title: `Revision ${deadline.revisionNumber}`,
					deadline: deadline.retention.pruneAfter,
					referenceCount: 0,
					actions: [],
					detail: {
						kind: 'graphic-asset-revision',
						assetId: deadline.assetId,
						revisionNumber: deadline.revisionNumber,
						retention: deadline.retention,
						// A superseded revision is prunable precisely because no
						// artifact pins it; stating the empty list is the proof.
						usage: [],
					},
					evidence: await evidenceFor('graphic-asset-revision', revisionId),
				};
			}

			const operation = await catalogue.findIngestionAttentionItem({
				now: now().toISOString(),
				operationId: input.subjectId,
			});
			if (!operation || INGESTION_QUEUES[operation.attention] !== input.queue)
				notFound('Graphics Ingestion Operation is no longer in that queue');
			const item = ingestionItem(operation, input.queue);
			return {
				...base,
				subject: item.subject,
				title: item.title,
				...(item.deadline === undefined ? {} : { deadline: item.deadline }),
				referenceCount: 0,
				actions: item.actions,
				detail: { kind: 'graphics-ingestion-operation', operation },
				evidence: await evidenceFor('graphics-ingestion-operation', operation.operationId),
			};
		},
	};
}
