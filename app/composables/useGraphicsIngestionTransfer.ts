import type { GraphicsIngestionOperation } from '~~/shared/types/graphicsAsset';
import {
	GRAPHICS_MULTIPART_MAXIMUM_CONCURRENT_PARTS,
	GRAPHICS_MULTIPART_PART_BYTES,
} from '~~/shared/utils/graphicsAssetCompatibility';

const ingestion = '/api/graphics-assets/ingestion-operations';

/**
 * Hands the bytes of one already-initiated Graphics Ingestion Operation to the
 * Graphics Asset Library.
 *
 * How they travel is a property of their length, not of what they are: the
 * library accepts a single request only up to one part's worth of bytes, and
 * anything longer must arrive as a resumable multipart transfer. So a caller
 * hands over a source and gets the operation back without choosing between the
 * two, and a source too long for one request stops being a source the caller
 * cannot send.
 *
 * Resuming is free here because the started transfer states which parts the
 * library already holds, so only the outstanding ones are sent.
 */
export function useGraphicsIngestionTransfer() {
	const apiHeaders = useApiHeaders();

	const transferInOneRequest = async (
		operation: GraphicsIngestionOperation,
		source: Blob,
	): Promise<GraphicsIngestionOperation> => {
		return await $fetch<GraphicsIngestionOperation>(
			`${ingestion}/${operation.id}/content`,
			{ method: 'PUT', headers: apiHeaders.getHeaders(), body: source },
		);
	};

	const transferInParts = async (
		operation: GraphicsIngestionOperation,
		source: Blob,
	): Promise<GraphicsIngestionOperation> => {
		const started = await $fetch<GraphicsIngestionOperation>(
			`${ingestion}/${operation.id}/multipart`,
			{ method: 'POST', headers: apiHeaders.getHeaders() },
		);
		if (!started.transfer)
			throw new Error('Server did not return multipart transfer facts.');
		const transfer: NonNullable<GraphicsIngestionOperation['transfer']> = started.transfer;

		const held = new Set(transfer.completedParts.map(part => part.partNumber));
		const outstanding = Array.from(
			{ length: transfer.partCount },
			(_, index) => index + 1,
		).filter(partNumber => !held.has(partNumber));
		let nextOutstanding = 0;

		async function sendOutstandingParts() {
			while (nextOutstanding < outstanding.length) {
				const partNumber = outstanding[nextOutstanding++]!;
				const offset = (partNumber - 1) * transfer.partByteLength;
				const part = source.slice(
					offset,
					Math.min(source.size, offset + transfer.partByteLength),
				);
				for (let attempt = 1; attempt <= transfer.maximumPartAttempts; attempt++) {
					try {
						await $fetch(
							`${ingestion}/${operation.id}/multipart/parts/${partNumber}`,
							{ method: 'PUT', headers: apiHeaders.getHeaders(), body: part },
						);
						break;
					}
					catch (caught) {
						// The library holds a part only once it has verified it, so a
						// re-sent part is the same part rather than a second one.
						if (attempt === transfer.maximumPartAttempts)
							throw caught;
					}
				}
			}
		}

		const senderCount = Math.min(
			outstanding.length,
			transfer.maximumConcurrentParts,
			GRAPHICS_MULTIPART_MAXIMUM_CONCURRENT_PARTS,
		);
		await Promise.all(Array.from({ length: senderCount }, () => sendOutstandingParts()));

		return await $fetch<GraphicsIngestionOperation>(
			`${ingestion}/${operation.id}/multipart/complete`,
			{ method: 'POST', headers: apiHeaders.getHeaders() },
		);
	};

	const transfer = async (
		operation: GraphicsIngestionOperation,
		source: Blob,
	): Promise<GraphicsIngestionOperation> => {
		return source.size > GRAPHICS_MULTIPART_PART_BYTES
			? await transferInParts(operation, source)
			: await transferInOneRequest(operation, source);
	};

	return { transfer };
}
