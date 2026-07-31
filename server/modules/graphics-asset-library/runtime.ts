import type { H3Event } from 'h3';
import type { GraphicsObjectStoreHealth } from './object-store';
import { db } from 'hub:db';
import { templatePackagePayloads } from '~~/server/modules/template-package-payload';
import { createGraphicsAssetLibrary } from '.';
import { createD1GraphicsAssetCatalogue } from './catalogue';
import {
	createR2CanonicalGraphicsObjectStore,
	createR2StagingGraphicsObjectStore,
} from './r2-object-store';
import { createGraphicsRemoteSourceFetcher } from './remote-source';
import { createDnsOverHttpsRemoteHostResolver } from './remote-source-resolver';
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

type GraphicsBindings = Partial<Env> & {
	SILENT_VIDEO_PLAYBACK_VALIDATOR?: {
		fetch: (request: Request) => Promise<Response>;
	};
};

/**
 * Builds the library from Worker bindings directly. Scheduled triggers have no
 * request, so they cannot go through the request-scoped factory.
 */
export function graphicsAssetLibraryForBindings(bindings: GraphicsBindings | undefined) {
	const validationBinding = bindings?.SILENT_VIDEO_PLAYBACK_VALIDATOR;
	return createGraphicsAssetLibrary({
		catalogue: createD1GraphicsAssetCatalogue(db.$client),
		staging: stagingObjectStore(bindings?.GRAPHICS_ASSET_STAGING),
		canonical: canonicalObjectStore(bindings?.GRAPHICS_ASSET_CANONICAL),
		silentVideoPlaybackValidator: validationBinding
			? createSilentVideoPlaybackServiceBindingValidator(validationBinding)
			: createUnavailableSilentVideoPlaybackValidator(),
		remoteSource: createGraphicsRemoteSourceFetcher({
			resolver: createDnsOverHttpsRemoteHostResolver(),
		}),
		// Every Template Package this installation receives is read as the artifact
		// its kind declares, not merely as data. Wiring it here rather than importing
		// it inside the library is what keeps the library from having to know what a
		// Broadcast Graphic is in order to carry one.
		templatePayloads: templatePackagePayloads,
	});
}

export function graphicsAssetLibraryForEvent(event: H3Event) {
	return graphicsAssetLibraryForBindings(
		event.context.cloudflare?.env as GraphicsBindings | undefined,
	);
}
