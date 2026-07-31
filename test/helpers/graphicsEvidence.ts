import type {
	GraphicsAssetEvidenceEntry,
	GraphicsAssetEvidencePage,
	GraphicsAssetEvidenceQuery,
} from '~~/shared/types/graphicsAsset';

interface EvidenceReader {
	listGraphicsAssetEvidence: (
		input?: GraphicsAssetEvidenceQuery & { limit?: number },
	) => Promise<GraphicsAssetEvidencePage>;
}

/**
 * The entries on one page of the Evidence ledger.
 *
 * Most assertions are about what the ledger recorded, not about how it is
 * paged. Navigation is proved where it is the subject of the test, so those
 * tests read the page itself and everything else stays about the Evidence.
 */
export async function evidenceOf(
	library: EvidenceReader,
	query?: GraphicsAssetEvidenceQuery & { limit?: number },
): Promise<GraphicsAssetEvidenceEntry[]> {
	return (await library.listGraphicsAssetEvidence(query)).entries;
}
