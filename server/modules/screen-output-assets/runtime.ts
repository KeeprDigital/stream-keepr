import type { H3Event } from 'h3';
import { db } from 'hub:db';
import {
	createGraphicsAssetLibrary,
	graphicAssetId,
	graphicAssetRevisionId,
} from '~~/server/modules/graphics-asset-library';
import { createD1GraphicsAssetCatalogue } from '~~/server/modules/graphics-asset-library/catalogue';
import { createR2CanonicalGraphicsObjectStore } from '~~/server/modules/graphics-asset-library/r2-object-store';
import { screenService } from '~~/server/services/screen';
import { createScreenOutputAssetDelivery } from '.';
import { createD1ScreenOutputAssetAuthorizer } from './authorizer';
import { assertScreenOutputCapabilitySigningKey } from './capability';
import { createScreenOutputAssetCapabilityManager } from './manager';

function signingKey(event: H3Event): string {
	const value = useRuntimeConfig(event).screenOutputCapabilitySigningKey;
	if (typeof value !== 'string' || value.length === 0) {
		throw createError({
			statusCode: 503,
			statusMessage: 'Service Unavailable',
			message: 'Screen Output asset capabilities are unavailable',
		});
	}
	try {
		assertScreenOutputCapabilitySigningKey(value);
	}
	catch {
		throw createError({
			statusCode: 503,
			statusMessage: 'Service Unavailable',
			message: 'Screen Output asset capabilities are unavailable',
		});
	}
	return value;
}

export function screenOutputAssetCapabilityManagerForEvent(event: H3Event) {
	return createScreenOutputAssetCapabilityManager({
		signingKey: signingKey(event),
		screens: screenService(),
	});
}

export async function screenOutputAssetDeliveryForEvent(event: H3Event) {
	const bindings = event.context.cloudflare?.env;
	const canonical = bindings?.GRAPHICS_ASSET_CANONICAL;
	const library = createGraphicsAssetLibrary({
		catalogue: createD1GraphicsAssetCatalogue(db.$client),
		staging: {
			async checkHealth() {
				return { outcome: 'healthy' as const };
			},
		},
		canonical: canonical
			? createR2CanonicalGraphicsObjectStore(canonical)
			: {
					async checkHealth() {
						return {
							outcome: 'unavailable' as const,
							reason: {
								code: 'transient-object-store-failure' as const,
								retryable: true as const,
							},
						};
					},
				},
	});
	const cache = typeof caches === 'undefined'
		? undefined
		: await caches.open('screen-output-assets').catch(() => undefined);
	const executionContext = event.context.cloudflare?.context;
	return createScreenOutputAssetDelivery({
		signingKey: signingKey(event),
		authorize: createD1ScreenOutputAssetAuthorizer(db.$client).authorize,
		inspect: async ({ assetId, revisionId }) => await library.inspectGraphicAssetRevisionContent({
			assetId: graphicAssetId(assetId),
			revisionId: graphicAssetRevisionId(revisionId),
		}),
		resolve: async ({ assetId, revisionId, range }) => await library.resolveGraphicAssetRevision({
			assetId: graphicAssetId(assetId),
			revisionId: graphicAssetRevisionId(revisionId),
			range,
		}),
		cache,
		defer: executionContext
			? promise => executionContext.waitUntil(promise)
			: undefined,
	});
}
