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
 *
 * One failure is not like the others and is translated rather than passed on: a
 * refusal for want of a session. Every ingestion route resolves
 * the author from that session, so its lapse makes the operation unreachable to
 * whoever started it, and no amount of resuming brings it back. Callers get a
 * sentence saying that instead of a status code they cannot act on.
 */

/**
 * Whether re-sending the same part can end differently (#150, decided once for
 * every caller). A failure that never reached the server, a timeout, a 429, and
 * a 5xx are all about the moment rather than the bytes; every other 4xx is the
 * library refusing what was sent, and re-sending it spends attempts on the
 * same answer.
 */
function retryCanChangeTheAnswer(caught: unknown): boolean {
	const status = failureStatus(caught);
	if (status === undefined)
		return true;
	return status === 408 || status === 429 || status >= 500;
}
export function useGraphicsIngestionTransfer(options: {
	/**
	 * Observes every operation snapshot the transfer learns along the way: the
	 * started multipart transfer and each verified part's checkpoint. Snapshots
	 * may arrive out of order under concurrent parts, so a caller presenting
	 * progress judges freshness itself (`transferredByteLength` only grows).
	 */
	onOperation?: (operation: GraphicsIngestionOperation) => void;
} = {}) {
	const apiHeaders = useApiHeaders();
	const observe = (operation: GraphicsIngestionOperation) => options.onOperation?.(operation);

	function refuseWithoutSession(caught: unknown): never {
		if (!graphicsAuthorSignedOut(caught))
			throw caught;
		throw Object.assign(
			new Error(GRAPHICS_AUTHOR_SIGNED_OUT_MESSAGE),
			{ statusCode: 401 },
		);
	}

	/**
	 * Reports the operation's progress while one request is pending, by asking.
	 *
	 * A request that carries the whole body — the single-request transfer, the
	 * multipart completion — produces no checkpoints of its own, so while the
	 * library works the only progress to report is what a read returns. The
	 * in-flight request stays authoritative: a poll that fails says nothing,
	 * and the poller stops the moment the request settles.
	 */
	const observeOperationRequest = async <T>(
		operationId: GraphicsIngestionOperation['id'],
		request: Promise<T>,
	): Promise<T> => {
		let pollPending = false;
		const interval = setInterval(async () => {
			if (pollPending)
				return;
			pollPending = true;
			try {
				observe(await $fetch<GraphicsIngestionOperation>(`${ingestion}/${operationId}`));
			}
			catch {
				// The in-flight request remains authoritative; its response handles errors.
			}
			finally {
				pollPending = false;
			}
		}, 250);
		try {
			return await request;
		}
		finally {
			clearInterval(interval);
		}
	};

	const transferInOneRequest = async (
		operation: GraphicsIngestionOperation,
		source: Blob,
	): Promise<GraphicsIngestionOperation> => {
		return await observeOperationRequest(operation.id, $fetch<GraphicsIngestionOperation>(
			`${ingestion}/${operation.id}/content`,
			{ method: 'PUT', headers: apiHeaders.getHeaders(), body: source },
		));
	};

	const transferInParts = async (
		operation: GraphicsIngestionOperation,
		source: Blob,
	): Promise<GraphicsIngestionOperation> => {
		const started = await $fetch<GraphicsIngestionOperation>(
			`${ingestion}/${operation.id}/multipart`,
			{ method: 'POST', headers: apiHeaders.getHeaders() },
		);
		observe(started);
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
						observe(await $fetch<GraphicsIngestionOperation>(
							`${ingestion}/${operation.id}/multipart/parts/${partNumber}`,
							{ method: 'PUT', headers: apiHeaders.getHeaders(), body: part },
						));
						break;
					}
					catch (caught) {
						// The library holds a part only once it has verified it, so a
						// re-sent part is the same part rather than a second one. A
						// refusal a retry cannot change — an author lapse or any other
						// non-retryable 4xx — stops here: every remaining attempt would
						// be refused identically.
						if (
							graphicsAuthorSignedOut(caught)
							|| !retryCanChangeTheAnswer(caught)
							|| attempt === transfer.maximumPartAttempts
						) {
							throw caught;
						}
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

		return await observeOperationRequest(operation.id, $fetch<GraphicsIngestionOperation>(
			`${ingestion}/${operation.id}/multipart/complete`,
			{ method: 'POST', headers: apiHeaders.getHeaders() },
		));
	};

	const transfer = async (
		operation: GraphicsIngestionOperation,
		source: Blob,
	): Promise<GraphicsIngestionOperation> => {
		try {
			return source.size > GRAPHICS_MULTIPART_PART_BYTES
				? await transferInParts(operation, source)
				: await transferInOneRequest(operation, source);
		}
		catch (caught) {
			refuseWithoutSession(caught);
		}
	};

	return { transfer, observeOperationRequest };
}
