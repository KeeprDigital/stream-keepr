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
