import type { H3Event } from 'h3';
import {
	createGraphicsAssetLibrary,
	graphicAssetId,
	graphicAssetRevisionId,
} from '~~/server/modules/graphics-asset-library';
import { createD1GraphicsAssetCatalogue } from '~~/server/modules/graphics-asset-library/catalogue';
import { createR2CanonicalGraphicsObjectStore } from '~~/server/modules/graphics-asset-library/r2-object-store';
import { graphicsCatalogueClient } from '~~/server/modules/graphics-asset-library/runtime';
import { screenService } from '~~/server/services/screen';
import { ServiceConfigurationError } from '~~/server/utils/errors';
import { createScreenOutputAssetDelivery } from '.';
import { createD1ScreenOutputAssetAuthorizer } from './authorizer';
import { assertScreenOutputCapabilitySigningKey } from './capability';
import { createScreenOutputAssetCapabilityManager } from './manager';

/**
 * The environment name, not the runtimeConfig name, because the reader of this
 * message is the one who has to go and set something.
 */
const SIGNING_KEY_ENV_NAME = 'NUXT_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY';

function unavailable(reason: string) {
	// Both the H3 error and its cause: the status is right on its own, and the
	// cause is what carries the message past the 5xx sanitizer in
	// `mapPublicNitroError`.
	const cause = new ServiceConfigurationError(
		SIGNING_KEY_ENV_NAME,
		`${reason}, so Screen Output asset capabilities are unavailable`,
	);
	return createError({
		statusCode: 503,
		statusMessage: 'Service Unavailable',
		message: cause.message,
		cause,
	});
}

function signingKey(event: H3Event): string {
	const value = useRuntimeConfig(event).screenOutputCapabilitySigningKey;
	if (typeof value !== 'string' || value.length === 0)
		throw unavailable('is not set');
	try {
		assertScreenOutputCapabilitySigningKey(value);
	}
	catch {
		throw unavailable('is not 32-byte base64');
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
		catalogue: createD1GraphicsAssetCatalogue(graphicsCatalogueClient()),
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
		authorize: createD1ScreenOutputAssetAuthorizer(graphicsCatalogueClient()).authorize,
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
