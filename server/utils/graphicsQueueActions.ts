import type { GraphicsQueueActionOutcome } from '~~/shared/utils/graphicsOperationalQueues';
import { GraphicsAssetLibraryError } from '~~/server/modules/graphics-asset-library';

/**
 * What a refused queue action reports.
 *
 * Every action an operational queue offers reports one of five outcomes, so a
 * refusal the library has already classified must arrive as one of them rather
 * than as a bare status an administrator has to interpret. That is what makes
 * running the same action twice read as `already-in-state` instead of as an
 * error, which is the whole of the idempotency promise these queues make.
 *
 * A library that cannot answer is `retryable-unavailable`: the same action is
 * worth running again, which is exactly what that outcome means.
 *
 * Invalid input is deliberately absent. It is a caller defect rather than a
 * state the subject is in, and reporting it as a domain outcome would tell an
 * administrator that the library considered their request and declined it.
 */
const LIBRARY_ERROR_OUTCOMES: Partial<Record<
	GraphicsAssetLibraryError['code'],
	GraphicsQueueActionOutcome
>> = {
	// The subject moved on before the action arrived: purged, restored, or past
	// the stage the action applies to.
	'ingestion-operation-not-found': 'already-in-state',
	'ingestion-operation-not-uploadable': 'already-in-state',
	'graphic-asset-lifecycle-action-not-allowed': 'already-in-state',
	'graphics-asset-library-unavailable': 'retryable-unavailable',
	'staging-capacity-exhausted': 'retryable-unavailable',
	'canonical-capacity-exhausted': 'retryable-unavailable',
};

/**
 * The outcome a thrown library error reports, or `undefined` when the error is
 * not a domain outcome at all and belongs to the ordinary API error mapping.
 */
export function graphicsQueueActionErrorOutcome(
	error: unknown,
): GraphicsQueueActionOutcome | undefined {
	return error instanceof GraphicsAssetLibraryError
		? LIBRARY_ERROR_OUTCOMES[error.code]
		: undefined;
}
