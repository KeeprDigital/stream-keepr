import type { H3Event } from 'h3';
import type { GraphicsObjectStoreHealth } from './object-store';
import { db } from 'hub:db';
import { createGraphicsAssetLibrary } from '.';
import { createD1GraphicsAssetCatalogue } from './catalogue';
import {
	createR2CanonicalGraphicsObjectStore,
	createR2StagingGraphicsObjectStore,
} from './r2-object-store';
import {
	createSilentVideoPlaybackServiceBindingValidator,
	createUnavailableSilentVideoPlaybackValidator,
} from './silent-video-playback-validator';

const unavailableObjectStore: GraphicsObjectStoreHealth = {
	async checkHealth() {
		return {
			outcome: 'unavailable',
			reason: {
				code: 'transient-object-store-failure',
				retryable: true,
			},
		};
	},
};

function stagingObjectStore(binding: R2Bucket | undefined): GraphicsObjectStoreHealth {
	return binding
		? createR2StagingGraphicsObjectStore(binding)
		: unavailableObjectStore;
}

function canonicalObjectStore(binding: R2Bucket | undefined): GraphicsObjectStoreHealth {
	return binding
		? createR2CanonicalGraphicsObjectStore(binding)
		: unavailableObjectStore;
}

export function graphicsAssetLibraryForEvent(event: H3Event) {
	const bindings = event.context.cloudflare?.env;
	const validationBinding = (
		bindings as typeof bindings & {
			SILENT_VIDEO_PLAYBACK_VALIDATOR?: {
				fetch: (request: Request) => Promise<Response>;
			};
		} | undefined
	)?.SILENT_VIDEO_PLAYBACK_VALIDATOR;
	return createGraphicsAssetLibrary({
		catalogue: createD1GraphicsAssetCatalogue(db.$client),
		staging: stagingObjectStore(bindings?.GRAPHICS_ASSET_STAGING),
		canonical: canonicalObjectStore(bindings?.GRAPHICS_ASSET_CANONICAL),
		silentVideoPlaybackValidator: validationBinding
			? createSilentVideoPlaybackServiceBindingValidator(validationBinding)
			: createUnavailableSilentVideoPlaybackValidator(),
	});
}
