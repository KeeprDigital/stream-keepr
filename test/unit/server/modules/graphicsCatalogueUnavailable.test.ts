import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GraphicsAssetLibraryError } from '~~/server/modules/graphics-asset-library/errors';

/**
 * `db` throws from its `$client` getter when the D1 binding is absent —
 * the shape a removed binding takes in a deployed Worker, and the one a failing
 * query does not.
 */
let bindingPresent = true;
const query = vi.fn();

vi.mock('~~/server/db', () => ({
	db: {
		get $client() {
			if (!bindingPresent)
				throw new Error('DB binding not found');
			return { prepare: query, batch: query };
		},
	},
}));

const { graphicsAssetLibraryForBindings, graphicsCatalogueClient } = await import(
	'~~/server/modules/graphics-asset-library/runtime',
);
const { screenOutputAssetDeliveryForEvent } = await import(
	'~~/server/modules/screen-output-assets/runtime',
);

/** 32 zero bytes, base64: enough for the signing key to be well formed. */
const SIGNING_KEY = `${'A'.repeat(43)}=`;

describe('a catalogue whose D1 binding is gone', () => {
	beforeEach(() => {
		bindingPresent = true;
	});

	it('is acquired when it is used, not when the library is built', () => {
		bindingPresent = false;

		// Building must not throw. A library that fails to construct fails outside
		// every guard that knows what a catalogue failure means, which is how a
		// missing binding escaped as a raw 500 while a failing query did not.
		expect(() => graphicsCatalogueClient()).not.toThrow();
	});

	it('reports itself unavailable in the library\'s own vocabulary when reached', () => {
		bindingPresent = false;
		const client = graphicsCatalogueClient();

		// Thrown where a query failure is thrown, so every existing guard that
		// turns a catalogue failure into the settled retryable outcome applies.
		expect(() => client.prepare('select 1')).toThrowError(
			expect.objectContaining({ code: 'graphics-asset-library-unavailable' }),
		);
		expect(() => client.prepare('select 1')).toThrowError(GraphicsAssetLibraryError);
	});

	it('passes the real client through untouched while the binding is there', () => {
		const client = graphicsCatalogueClient();
		client.prepare('select 1');

		expect(query).toHaveBeenCalledWith('select 1');
	});

	it('does not lie about what it has when it cannot answer at all', () => {
		bindingPresent = false;
		const client = graphicsCatalogueClient();

		// Inspecting the client structurally must reach the same conclusion as
		// calling it. A proxy that only trapped `get` would answer these from its
		// empty target, so an unreachable catalogue would look like a reachable
		// one with no methods — a lie that reads as a different fault entirely.
		expect(() => 'prepare' in client).toThrowError(GraphicsAssetLibraryError);
		expect(() => Object.keys(client)).toThrowError(GraphicsAssetLibraryError);
		expect(() => ({ ...client })).toThrowError(GraphicsAssetLibraryError);
	});

	it('describes the real client structurally while the binding is there', () => {
		const client = graphicsCatalogueClient();

		expect('prepare' in client).toBe(true);
		expect(Object.keys(client)).toContain('prepare');
	});

	// The call sites, not just the helper. Without these, a change reverting one
	// of them to `db.$client` would leave every test above green while the
	// delivery routes went back to answering a raw 500.
	it('lets the library be built while the binding is absent', () => {
		bindingPresent = false;

		expect(() => graphicsAssetLibraryForBindings(undefined)).not.toThrow();
	});

	it('lets Screen Output delivery be built while the binding is absent', async () => {
		bindingPresent = false;
		vi.stubGlobal('useRuntimeConfig', () => ({ screenOutputCapabilitySigningKey: SIGNING_KEY }));

		await expect(
			screenOutputAssetDeliveryForEvent({ context: {} } as never),
		).resolves.toBeDefined();
	});
});
