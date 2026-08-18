import type { GraphicAssetReference, GraphicAssetReferenceStatus } from '~~/shared/types/graphicsAsset';
import { graphicAssetRevisionStatusPath } from '~~/shared/utils/graphicsAssetReferences';

/**
 * Ask the Graphics Asset Library whether one exact Graphic Asset Revision resolves.
 *
 * The one question every surface that reports on a pinned reference asks — the picker
 * about the revision it holds, Live Control before staging one, and both eligibility
 * composables about every reference a Screen or an overlay publishes. It was written
 * out four times, each with its own error mapping, which is how #178's remediation
 * came to fix a mislabelled 401 in one of them and leave the other three (#204).
 *
 * It throws rather than absorbing a failure, because what a failed request means is
 * the caller's to decide: a browser whose session has ended is not the library saying
 * anything about the revision, and calling it Unavailable Graphic Asset Content would
 * prescribe the one action that provably cannot work.
 */
export async function graphicAssetReferenceStatus(
	reference: GraphicAssetReference,
): Promise<GraphicAssetReferenceStatus> {
	return await $fetch<GraphicAssetReferenceStatus>(graphicAssetRevisionStatusPath(reference));
}

/**
 * The same question, with the answer a caller gives when it could not be asked.
 *
 * Unavailable and retryable, because a library that did not answer has not said the
 * revision is gone — and a Missing Graphic Asset Reference is an integrity failure
 * that no retry resolves, so guessing it from a failed request would name a permanent
 * fault from a temporary one. For a caller that reports many references at once this
 * is the whole of the error handling; a caller that can distinguish *why* the request
 * failed asks the question above instead.
 */
export async function graphicAssetReferenceStatusOrUnavailable(
	reference: GraphicAssetReference,
): Promise<GraphicAssetReferenceStatus> {
	return await graphicAssetReferenceStatus(reference)
		.catch((): GraphicAssetReferenceStatus => ({ outcome: 'unavailable', retryable: true }));
}
