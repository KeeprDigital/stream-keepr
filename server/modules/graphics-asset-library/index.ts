import type {
	GraphicAssetId,
	GraphicAssetRevisionId,
	GraphicsAssetLibraryComponentHealth,
	GraphicsAssetLibraryHealth,
	GraphicsIngestionOperationId,
} from '~~/shared/types/graphicsAsset';
import type { GraphicsObjectStoreHealth } from './object-store';

export type {
	GraphicAssetId,
	GraphicAssetRevisionId,
	GraphicsAssetLibraryComponentHealth,
	GraphicsAssetLibraryHealth,
	GraphicsIngestionOperationId,
} from '~~/shared/types/graphicsAsset';

export interface GraphicsAssetCatalogue {
	checkHealth: () => Promise<{ outcome: 'healthy' }>;
}

export interface GraphicsAssetLibrary {
	getHealth: () => Promise<GraphicsAssetLibraryHealth>;
}

interface GraphicsAssetLibraryDependencies {
	catalogue: GraphicsAssetCatalogue;
	staging: GraphicsObjectStoreHealth;
	canonical: GraphicsObjectStoreHealth;
	now?: () => Date;
}

function requiredIdentity<T extends string>(value: string, label: string): T {
	if (value.length === 0)
		throw new Error(`${label} cannot be empty`);
	return value as T;
}

export function graphicAssetId(value: string): GraphicAssetId {
	return requiredIdentity<GraphicAssetId>(value, 'Graphic Asset identity');
}

export function graphicAssetRevisionId(value: string): GraphicAssetRevisionId {
	return requiredIdentity<GraphicAssetRevisionId>(value, 'Graphic Asset Revision identity');
}

export function graphicsIngestionOperationId(value: string): GraphicsIngestionOperationId {
	return requiredIdentity<GraphicsIngestionOperationId>(value, 'Graphics Ingestion Operation identity');
}

async function catalogueHealth(catalogue: GraphicsAssetCatalogue): Promise<GraphicsAssetLibraryComponentHealth> {
	try {
		await catalogue.checkHealth();
		return { status: 'healthy' };
	}
	catch {
		return {
			status: 'unavailable',
			reason: { code: 'catalogue-unavailable', retryable: true },
		};
	}
}

async function byteStoreHealth(
	store: GraphicsObjectStoreHealth,
): Promise<GraphicsAssetLibraryComponentHealth> {
	try {
		const outcome = await store.checkHealth();
		return outcome.outcome === 'healthy'
			? { status: 'healthy' }
			: {
					status: 'unavailable',
					reason: { code: 'byte-store-unavailable', retryable: true },
				};
	}
	catch {
		return {
			status: 'unavailable',
			reason: { code: 'byte-store-unavailable', retryable: true },
		};
	}
}

export function createGraphicsAssetLibrary(
	dependencies: GraphicsAssetLibraryDependencies,
): GraphicsAssetLibrary {
	const now = dependencies.now ?? (() => new Date());

	return {
		async getHealth() {
			const checkedAt = now().toISOString();
			const [catalogue, staging, canonical] = await Promise.all([
				catalogueHealth(dependencies.catalogue),
				byteStoreHealth(dependencies.staging),
				byteStoreHealth(dependencies.canonical),
			]);
			const status = catalogue.status === 'healthy'
				&& staging.status === 'healthy'
				&& canonical.status === 'healthy'
				? 'healthy'
				: 'degraded';

			return {
				status,
				checkedAt,
				catalogue,
				byteStores: { staging, canonical },
			};
		},
	};
}
