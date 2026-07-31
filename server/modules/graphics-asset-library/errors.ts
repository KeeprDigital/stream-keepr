export interface GraphicsCapacityExhaustedDetails {
	resource: 'canonical' | 'staging';
	limitBytes: number;
	usedBytes: number;
	reservedBytes: number;
	requestedBytes: number;
	availableBytes: number;
}

export class GraphicsAssetLibraryError extends Error {
	readonly capacity?: GraphicsCapacityExhaustedDetails;

	constructor(
		message: string,
		readonly code:
			| 'invalid-ingestion-input'
			| 'ingestion-operation-not-found'
			| 'ingestion-operation-not-uploadable'
			/**
			 * A durable operation another worker still holds the lease on. It is
			 * distinct from `ingestion-operation-not-uploadable` because the two
			 * call for opposite answers: this one resolves itself when the lease
			 * lapses and is worth retrying, while an operation that cannot resume
			 * from its stage never will be.
			 */
			| 'ingestion-operation-lease-held'
			/** A queue or inspector subject of any kind that no longer exists. */
			| 'graphics-subject-not-found'
			| 'graphic-asset-lifecycle-action-not-allowed'
			| 'staging-capacity-exhausted'
			| 'canonical-capacity-exhausted'
			| 'graphics-asset-library-unavailable',
		options?: ErrorOptions & {
			capacity?: GraphicsCapacityExhaustedDetails;
		},
	) {
		super(message, options);
		this.capacity = options?.capacity;
	}
}

export function graphicsCapacityErrorDescriptor(error: unknown) {
	if (
		!(error instanceof GraphicsAssetLibraryError)
		|| (
			error.code !== 'staging-capacity-exhausted'
			&& error.code !== 'canonical-capacity-exhausted'
		)
	) {
		return undefined;
	}
	return {
		statusCode: 507,
		statusMessage: 'Insufficient Storage',
	} as const;
}
