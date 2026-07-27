declare const graphicAssetIdBrand: unique symbol;
declare const graphicAssetRevisionIdBrand: unique symbol;
declare const graphicsIngestionOperationIdBrand: unique symbol;

export type GraphicAssetId = string & {
	readonly [graphicAssetIdBrand]: 'GraphicAssetId';
};

export type GraphicAssetRevisionId = string & {
	readonly [graphicAssetRevisionIdBrand]: 'GraphicAssetRevisionId';
};

export type GraphicsIngestionOperationId = string & {
	readonly [graphicsIngestionOperationIdBrand]: 'GraphicsIngestionOperationId';
};

export type GraphicsAssetLibraryComponentHealth
	= | { status: 'healthy' }
		| {
			status: 'unavailable';
			reason: {
				code: 'catalogue-unavailable' | 'byte-store-unavailable';
				retryable: true;
			};
		};

export interface GraphicsAssetLibraryHealth {
	status: 'healthy' | 'degraded';
	checkedAt: string;
	catalogue: GraphicsAssetLibraryComponentHealth;
	byteStores: {
		staging: GraphicsAssetLibraryComponentHealth;
		canonical: GraphicsAssetLibraryComponentHealth;
	};
}
