import type { GraphicsDiscrepancyKind } from '~~/shared/types/graphicsAsset';
import { describe, expect, it, vi } from 'vitest';
import { createGraphicsAssetLibrary } from '~~/server/modules/graphics-asset-library';

const GIB = 1024 * 1024 * 1024;

function capacity() {
	return {
		canonical: {
			limitBytes: 100 * GIB,
			usedBytes: 0,
			reservedBytes: 0,
			availableBytes: 100 * GIB,
			pressure: 'normal' as const,
			breakdown: {
				retainedSourceBytes: 0,
				retainedDerivativeBytes: 0,
				metadataBytes: 0,
				providerCacheBytes: 0,
				unreachableQuarantineBytes: 0,
			},
		},
		staging: {
			limitBytes: 10 * GIB,
			usedBytes: 0,
			reservedBytes: 0,
			availableBytes: 10 * GIB,
		},
	};
}

const NO_DEADLINES = {
	retiredCount: 0,
	trashed: { count: 0 },
	supersededRevisions: { count: 0 },
	frozenRevisionCount: 0,
	quarantinedContent: { count: 0 },
	stagedInput: { count: 0 },
};

/**
 * A catalogue that answers every cockpit read, so a test can state exactly how
 * many subjects are open without arranging real assets to produce them.
 */
function cockpitCatalogue(openCounts: Partial<Record<GraphicsDiscrepancyKind, number>>) {
	const counts: Record<GraphicsDiscrepancyKind, number> = {
		'unavailable-content': 0,
		'missing-derivative': 0,
		'unexpected-object': 0,
		'critical-integrity-incident': 0,
		...openCounts,
	};
	return {
		checkHealth: vi.fn().mockResolvedValue({ outcome: 'healthy' }),
		// Present so the library recognises this as a full catalogue.
		initiateGraphicsIngestion: vi.fn(),
		getCapacity: vi.fn().mockResolvedValue(capacity()),
		countUnavailableContent: vi.fn().mockResolvedValue(0),
		countOpenDiscrepancies: vi.fn().mockResolvedValue(counts),
		countIsolatedDiscrepancies: vi.fn()
			.mockResolvedValue(counts['critical-integrity-incident']),
		getReconciliationState: vi.fn().mockResolvedValue({}),
		summariseIngestionAttention: vi.fn()
			.mockResolvedValue({ counts: {}, operations: [] }),
		countUnreleasedStagedInput: vi.fn().mockResolvedValue(0),
		summariseRetentionDeadlines: vi.fn().mockResolvedValue(NO_DEADLINES),
		listGraphicsAssetEvidence: vi.fn().mockResolvedValue([]),
	};
}

function libraryWith(openCounts: Partial<Record<GraphicsDiscrepancyKind, number>>) {
	return createGraphicsAssetLibrary({
		catalogue: cockpitCatalogue(openCounts) as never,
		staging: { checkHealth: vi.fn().mockResolvedValue({ outcome: 'healthy' }) },
		canonical: { checkHealth: vi.fn().mockResolvedValue({ outcome: 'healthy' }) },
		now: () => new Date('2026-07-30T09:00:00.000Z'),
	});
}

describe('the Operations Cockpit reading', () => {
	it('still answers whether the library is safe when the catalogue cannot answer', async () => {
		const library = createGraphicsAssetLibrary({
			catalogue: { checkHealth: vi.fn().mockRejectedValue(new Error('D1 unavailable')) },
			staging: { checkHealth: vi.fn().mockResolvedValue({ outcome: 'healthy' }) },
			canonical: { checkHealth: vi.fn().mockResolvedValue({ outcome: 'healthy' }) },
			now: () => new Date('2026-07-30T09:00:00.000Z'),
		});

		const cockpit = await library.getOperationsCockpit();

		expect(cockpit).toEqual({
			outcome: 'catalogue-unavailable',
			checkedAt: '2026-07-30T09:00:00.000Z',
			condition: {
				status: 'unavailable',
				catalogue: {
					status: 'unavailable',
					reason: { code: 'catalogue-unavailable', retryable: true },
				},
				canonicalByteStore: { status: 'healthy' },
				stagingByteStore: { status: 'healthy' },
			},
			alerts: {
				countsBySeverity: { critical: 1, warning: 0, info: 0 },
				open: [
					{
						code: 'catalogue-unavailable',
						severity: 'critical',
						openCount: 1,
						persistent: false,
					},
				],
			},
		});
	});

	it('counts alerts and backlog in the same unit when one code covers many subjects', async () => {
		// Forty missing derivatives and one unavailable content are forty-one
		// warning subjects behind two alert codes. Counting codes in one summary
		// and subjects in the other would print "2 warning" beside "41 warning"
		// with nothing on the surface explaining the gap.
		const cockpit = await libraryWith({
			'missing-derivative': 40,
			'unavailable-content': 1,
		}).getOperationsCockpit();
		if (cockpit.outcome !== 'complete')
			throw new Error('The cockpit could not read the catalogue');

		expect(cockpit.alerts.countsBySeverity).toEqual({ critical: 0, warning: 41, info: 0 });
		expect(cockpit.reconciliation.countsBySeverity)
			.toEqual({ critical: 0, warning: 41, info: 0 });
		expect(cockpit.alerts.open.map(alert => [alert.code, alert.openCount])).toEqual([
			['unavailable-content-open', 1],
			['missing-derivative-open', 40],
		]);
	});

	it('does not let a quarantined unexpected object degrade the headline', async () => {
		// Unexpected bytes are held safely in Content Quarantine and rechecked
		// before anything is deleted, so nothing the library is expected to serve
		// is affected. A "Degraded" badge above a row reporting only info would
		// teach an administrator to stop trusting the badge.
		const cockpit = await libraryWith({ 'unexpected-object': 1 }).getOperationsCockpit();
		if (cockpit.outcome !== 'complete')
			throw new Error('The cockpit could not read the catalogue');

		expect(cockpit.condition.status).toBe('healthy');
		expect(cockpit.condition.canonicalByteStore).toEqual({ status: 'healthy' });
		expect(cockpit.alerts.countsBySeverity).toEqual({ critical: 0, warning: 0, info: 1 });
		expect(cockpit.alerts.open).toEqual([
			{
				code: 'unexpected-object-quarantined',
				severity: 'info',
				openCount: 1,
				persistent: true,
			},
		]);
	});

	it('still degrades the byte store for a warning-severity disagreement', async () => {
		const cockpit = await libraryWith({
			'unavailable-content': 2,
			'unexpected-object': 5,
		}).getOperationsCockpit();
		if (cockpit.outcome !== 'complete')
			throw new Error('The cockpit could not read the catalogue');

		// Only the two warning subjects hold it degraded; the five info ones do not.
		expect(cockpit.condition.canonicalByteStore).toEqual({
			status: 'degraded',
			reason: {
				code: 'canonical-bytes-disagree-with-catalogue',
				retryable: true,
				openCount: 2,
			},
		});
	});
});
