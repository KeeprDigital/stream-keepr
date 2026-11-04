import type { GraphicsAssetDeliveryCatalogue } from '~~/server/modules/graphics-asset-library';
import type { GraphicsAssetDelivery } from '~~/server/modules/graphics-asset-library/delivery';
import type { GraphicsCanonicalObjectStore, GraphicsObjectStoreHealth } from '~~/server/modules/graphics-asset-library/object-store';
import type { GraphicsObservedDisagreementCatalogue } from '~~/server/modules/graphics-asset-library/reconciliation';
import { createGraphicsAssetDelivery } from '~~/server/modules/graphics-asset-library/delivery';
import { createGraphicsDisagreementReporter } from '~~/server/modules/graphics-asset-library/reconciliation';

/**
 * The Graphics Asset delivery a Screen Output reads through: delivery alone,
 * since an output never ingests, with every contradiction it observes fed to
 * Graphics Reconciliation like any other reader's (ADR-0073).
 */
export function createScreenOutputGraphicsDelivery(dependencies: {
	catalogue: GraphicsAssetDeliveryCatalogue & GraphicsObservedDisagreementCatalogue;
	canonical: GraphicsObjectStoreHealth | GraphicsCanonicalObjectStore;
	/**
	 * Finishes a report after the read has answered (the Worker's `waitUntil`),
	 * so reconciling an observation never holds an on-air read. Without it the
	 * read waits for its report.
	 */
	defer?: (promise: Promise<unknown>) => void;
}): GraphicsAssetDelivery {
	const { catalogue, canonical, defer } = dependencies;
	// A store that can only report its health refuses every read, so it never
	// observes a contradiction.
	const report = 'readMetadata' in canonical
		? createGraphicsDisagreementReporter({ catalogue, canonical })
		: undefined;
	return createGraphicsAssetDelivery({
		catalogue,
		canonical,
		reportDisagreement: report && defer
			? async (observed) => {
				// Delivery swallows a failed report it awaits; this one it never sees.
				defer(report(observed).catch(() => undefined));
			}
			: report,
	});
}
