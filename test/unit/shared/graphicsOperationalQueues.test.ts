import type {
	GraphicAssetLifecycleActionOutcome,
	GraphicAssetPurgeOutcome,
	GraphicsDiscrepancyActionOutcome,
	GraphicsIngestionOperation,
} from '~~/shared/types/graphicsAsset';
import { describe, expect, it } from 'vitest';
import { GRAPHICS_REPAIR_REJECTION_CODES } from '~~/shared/utils/graphicsAssetReconciliation';
import {
	GRAPHICS_OPERATIONAL_QUEUES,
	GRAPHICS_QUEUE_ACTIONS,
	graphicsDiscrepancyQueueOutcome,
	graphicsIngestionRetryQueueOutcome,
	graphicsLifecycleQueueOutcome,
	graphicsPurgeQueueOutcome,
	graphicsQueueOutcomeFromStatus,
	graphicsQueueSeverity,
} from '~~/shared/utils/graphicsOperationalQueues';

describe('the operational queue vocabulary', () => {
	it('orders the queues by operational risk, so a surface can render them in declaration order', () => {
		const severities = GRAPHICS_OPERATIONAL_QUEUES.map(graphicsQueueSeverity);

		const rank = { critical: 0, warning: 1, info: 2 } as const;
		expect(severities.map(severity => rank[severity]))
			.toEqual([
				...severities.map(severity => rank[severity]),
			].sort());

		expect(graphicsQueueSeverity('critical-integrity-incident')).toBe('critical');
		expect(graphicsQueueSeverity('unavailable-content')).toBe('warning');
		expect(graphicsQueueSeverity('trashed-asset')).toBe('warning');
		expect(graphicsQueueSeverity('retired-asset')).toBe('info');
	});

	it('never offers to adopt an unexpected object', () => {
		expect(GRAPHICS_QUEUE_ACTIONS.join(' ')).not.toContain('adopt');
	});
});

describe('the queue action outcome vocabulary', () => {
	it('classifies every reconciliation action result', () => {
		expect(graphicsDiscrepancyQueueOutcome({
			outcome: 'resolved',
			resolution: 'repaired-with-exact-bytes',
		} as GraphicsDiscrepancyActionOutcome)).toBe('completed');

		// A recheck that changed nothing means the bytes are still gone, not that
		// the subject is as the administrator wanted.
		expect(graphicsDiscrepancyQueueOutcome({
			outcome: 'unchanged',
		} as GraphicsDiscrepancyActionOutcome)).toBe('retryable-unavailable');

		const rejections: Record<string, string> = {
			'discrepancy-already-resolved': 'already-in-state',
			'action-not-valid-in-state': 'already-in-state',
			'digest-mismatch': 'integrity-conflict',
			'byte-length-mismatch': 'integrity-conflict',
			'canonical-mime-mismatch': 'integrity-conflict',
			'validation-facts-mismatch': 'integrity-conflict',
			'integrity-incident-isolated': 'integrity-conflict',
			'source-content-unavailable': 'retryable-unavailable',
			'stored-bytes-missing': 'retryable-unavailable',
			'derivative-regeneration-unavailable': 'retryable-unavailable',
			'byte-store-unavailable': 'retryable-unavailable',
		};

		// Every rejection code is classified, so a new one cannot slip through unexplained.
		expect(Object.keys(rejections).sort())
			.toEqual([...GRAPHICS_REPAIR_REJECTION_CODES].sort());

		for (const [code, expected] of Object.entries(rejections)) {
			expect(graphicsDiscrepancyQueueOutcome({
				outcome: 'rejected',
				code,
				message: 'rejected',
			} as GraphicsDiscrepancyActionOutcome)).toBe(expected);
		}
	});

	it('reports a lifecycle action blocked by pinned usage as reference-blocked', () => {
		expect(graphicsLifecycleQueueOutcome({
			outcome: 'restored',
		} as GraphicAssetLifecycleActionOutcome)).toBe('completed');
		expect(graphicsLifecycleQueueOutcome({
			outcome: 'in-use',
			usage: [],
		} as unknown as GraphicAssetLifecycleActionOutcome)).toBe('reference-blocked');
	});

	it('reports a purge the fresh reference proof refused as reference-blocked', () => {
		expect(graphicsPurgeQueueOutcome({
			outcome: 'purged',
		} as GraphicAssetPurgeOutcome)).toBe('completed');
		expect(graphicsPurgeQueueOutcome({
			outcome: 'in-use',
			usage: [],
		} as unknown as GraphicAssetPurgeOutcome)).toBe('reference-blocked');
	});

	it('reports a retry that resumed, finished, or failed again distinctly', () => {
		const operation = (
			stage: GraphicsIngestionOperation['stage'],
			failure?: GraphicsIngestionOperation['failure'],
		) => ({ stage, failure } as GraphicsIngestionOperation);

		expect(graphicsIngestionRetryQueueOutcome(operation('completed')))
			.toBe('already-in-state');
		expect(graphicsIngestionRetryQueueOutcome(operation('cancelled')))
			.toBe('already-in-state');
		// Resumed from its retained verified input and now working again.
		expect(graphicsIngestionRetryQueueOutcome(operation('validating')))
			.toBe('completed');
		// A retry that failed again the same retryable way is worth another run.
		expect(graphicsIngestionRetryQueueOutcome(operation('failed', {
			code: 'staging-unavailable',
			retryable: true,
			message: 'staging is unavailable',
		}))).toBe('retryable-unavailable');
		// Expired staged input is permanent: a new operation is required.
		expect(graphicsIngestionRetryQueueOutcome(operation('failed', {
			code: 'staged-input-expired',
			retryable: false,
			message: 'staged input expired',
		}))).toBe('already-in-state');
	});

	it('classifies a refused request by the status the library answered with', () => {
		// The subject moved on before the action arrived: already purged, already
		// restored, or no longer retryable from its current stage.
		expect(graphicsQueueOutcomeFromStatus(404)).toBe('already-in-state');
		expect(graphicsQueueOutcomeFromStatus(409)).toBe('already-in-state');
		expect(graphicsQueueOutcomeFromStatus(503)).toBe('retryable-unavailable');
		expect(graphicsQueueOutcomeFromStatus(507)).toBe('retryable-unavailable');
		expect(graphicsQueueOutcomeFromStatus(500)).toBe('retryable-unavailable');
		expect(graphicsQueueOutcomeFromStatus(400)).toBe('integrity-conflict');
	});
});
