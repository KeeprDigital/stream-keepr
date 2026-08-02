import type { H3Event } from 'h3';
import type { GraphicsObjectStoreHealth } from './object-store';
import { db } from 'hub:db';
import { templatePackagePayloads } from '~~/server/modules/template-package-payload';
import { createGraphicsAssetLibrary } from '.';
import { createD1GraphicsAssetCatalogue } from './catalogue';
import { GraphicsAssetLibraryError } from './errors';
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

/**
 * The catalogue's D1 client, resolved when it is used rather than when the
 * library is built.
 *
 * A missing binding and a failing query are the same thing to a caller — the
 * catalogue cannot answer — but they were not the same thing here. `hub:db`
 * throws from its `$client` getter, so an absent binding failed while the
 * library was still being assembled: before the guards that turn a catalogue
 * failure into the settled retryable outcome, and so outside every route's
 * mapping. A delivery route answered a raw 500 with no `Retry-After` for a
 * database that was merely unreachable, while the same outage arriving as a
 * query error answered 503 correctly.
 *
 * Resolving lazily puts a missing binding exactly where a failing query already
 * is — inside the call — and raising the library's own unavailable error there
 * means the handling that was already right for one is now right for both.
 * Nothing downstream needed a new case.
 */
export function graphicsCatalogueClient(): D1Database {
	function resolve(): D1Database {
		try {
			return db.$client as unknown as D1Database;
		}
		catch (error) {
			throw new GraphicsAssetLibraryError(
				'Graphics Asset Library catalogue is unavailable',
				'graphics-asset-library-unavailable',
				{ cause: error },
			);
		}
	}

	// Every trap resolves the same way. Trapping only `get` would leave `in`,
	// `Object.keys`, and spreading to answer from the empty target instead, so an
	// unreachable catalogue would present as a reachable one holding no methods
	// — a lie, and one that reads as an entirely different fault.
	return new Proxy({} as D1Database, {
		get(_target, property) {
			const client = resolve();
			const value = Reflect.get(client as object, property);
			return typeof value === 'function' ? value.bind(client) : value;
		},
		has: (_target, property) => Reflect.has(resolve() as object, property),
		ownKeys: () => Reflect.ownKeys(resolve() as object),
		getOwnPropertyDescriptor(_target, property) {
			const descriptor = Reflect.getOwnPropertyDescriptor(resolve() as object, property);
			// The target is an empty extensible object, so any descriptor reported
			// for it has to be configurable for the proxy invariants to hold.
			return descriptor && { ...descriptor, configurable: true };
		},
	});
}

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
		catalogue: createD1GraphicsAssetCatalogue(graphicsCatalogueClient()),
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
