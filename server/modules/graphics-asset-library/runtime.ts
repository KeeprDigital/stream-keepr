import type { H3Event } from 'h3';
import { db } from 'hub:db';
import { createGraphicsAssetLibrary } from '.';
import { createD1GraphicsAssetCatalogue } from './catalogue';
import { createR2GraphicsObjectStore } from './object-store';

function objectStoreForBinding(binding: R2Bucket | undefined) {
	return binding
		? createR2GraphicsObjectStore(binding)
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
			};
}

export function graphicsAssetLibraryForEvent(event: H3Event) {
	const bindings = event.context.cloudflare?.env;
	return createGraphicsAssetLibrary({
		catalogue: createD1GraphicsAssetCatalogue(db.$client),
		staging: objectStoreForBinding(bindings?.GRAPHICS_ASSET_STAGING),
		canonical: objectStoreForBinding(bindings?.GRAPHICS_ASSET_CANONICAL),
	});
}
