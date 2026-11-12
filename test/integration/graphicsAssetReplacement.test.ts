import type {
	GraphicAsset,
	GraphicAssetReference,
	GraphicAssetUsage,
	GraphicsIngestionOperation,
} from '~~/shared/types/graphicsAsset';
import type { FeatureMatchOverlayModeConfig } from '../../shared/types/screenConfig';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '../../shared/types/screenConfig';
import { $fetch, fetch, operatorSessionCookie } from './client';
import { graphicsIngestionRequest } from './graphicsIngestionRequest';
import { expectOperationResult } from './responseStatus';

const basePixelPng = Uint8Array.from(Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
	'base64',
));
const emptyTextChunk = Uint8Array.of(0, 0, 0, 0, 0x74, 0x45, 0x58, 0x74, 0x96, 0x42, 0xC5, 0x85);

/**
 * This suite's own content, padded with chunk counts no other suite uses —
 * 110 and 111, claimed in the padding-count registry in `helpers.ts`.
 *
 * One chunk was `graphicsAssetReferences`' content, and this suite padded by one
 * and two until #368, so its first fixture was byte-identical to that suite's
 * (#123 found it during the replacement split). Neither suite asserts
 * published-vs-reused, so the collision never went red — but both suites ran
 * against one Graphic Asset Content, and either one retiring, Trashing or
 * purging its asset takes the other's bytes with it.
 */
function pngWithTextChunks(count: number) {
	return Uint8Array.from(Buffer.concat([
		basePixelPng.slice(0, -12),
		...Array.from({ length: count }).fill(emptyTextChunk) as Uint8Array[],
		basePixelPng.slice(-12),
	]));
}

const pngPixel = pngWithTextChunks(110);
const replacementPng = pngWithTextChunks(111);

function decodeEvidence(bytes: Uint8Array) {
	return {
		outcome: 'decoded' as const,
		sourceDigest: createHash('sha256').update(bytes).digest('hex'),
		width: 1,
		height: 1,
	};
}

/**
 * Every round trip inside a test below is wrapped in `step` so a failure names the
 * operation it was on. The `beforeAll` and `afterAll` round trips are not: a stall
 * creating the Event or the Screen still reports as a bare hook timeout with
 * nothing named, and would take the whole file's tests with it as skips.
 *
 * #123 carries a 30,000 ms timeout in this suite whose cause was never found
 * across six full integration runs, and the reason it stayed unfound is the shape
 * of the test that produced it: one `it` making about twenty round trips, which
 * on a stall reports only that the chain as a whole ran out of time. The tests
 * are now one per scenario, which narrows a recurrence to a handful of
 * operations; this narrows it to one. A stalled operation never resolves, so its
 * `finally` never runs and it is the step printed as `never returned` — the two
 * candidate stall sites #123 names (a real Ably REST publish behind every Screen
 * mutation, and two concurrent replacements of one asset) are separate steps
 * here, and the second has a test to itself.
 */
const steps: { label: string; milliseconds?: number }[] = [];

async function step<T>(label: string, run: () => Promise<T>): Promise<T> {
	const record: { label: string; milliseconds?: number } = { label };
	steps.push(record);
	const startedAt = Date.now();
	try {
		return await run();
	}
	finally {
		record.milliseconds = Date.now() - startedAt;
	}
}

describe('the Graphic Asset replacement and explicit adoption', () => {
	let eventId: number;
	let screenId: number;
	let authorHeaders: Record<string, string>;

	beforeAll(async () => {
		authorHeaders = { cookie: await operatorSessionCookie() };
		const event = await $fetch('/api/events', {
			method: 'POST',
			body: {
				name: 'Graphic Asset Replacement Event',
				game: 'mtg',
				featureMatchOrientation: 'horizontal',
			},
		});
		eventId = event.id;
		const screen = await $fetch(`/api/events/${eventId}/screens`, {
			method: 'POST',
			body: {
				name: 'Replacement overlay',
				slug: `replacement-overlay-${eventId}`,
				currentMode: 'feature-match-overlay',
			},
		});
		screenId = screen.id;
	});

	beforeEach((context) => {
		steps.length = 0;
		context.onTestFailed(() => {
			console.error([
				`[graphicsAssetReplacement] operations during "${context.task.name}":`,
				...steps.map(({ label, milliseconds }) => `  ${label}: ${
					milliseconds === undefined
						? 'never returned'
						: `${milliseconds}ms`
				}`),
			].join('\n'));
		});
	});

	afterAll(async () => {
		try {
			await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
		}
		catch {}
	});

	/**
	 * Each scenario publishes a Graphic Asset of its own and replaces that one, so
	 * none reads a revision another left behind and any of them runs alone. They
	 * share the one Screen, which pins whichever asset the running scenario gives it.
	 */
	async function publish(key: string): Promise<{ reference: GraphicAssetReference; name: string }> {
		const name = `Replaceable integration logo ${key}`;
		const initiated = await step('initiate original ingestion', async () => await $fetch<GraphicsIngestionOperation>(
			'/api/graphics-assets/ingestion-operations',
			{
				method: 'POST',
				headers: authorHeaders,
				body: graphicsIngestionRequest({
					idempotencyKey: `replacement-integration-original-${key}`,
					name,
					defaultEventId: eventId,
					browserDecodeEvidence: decodeEvidence(pngPixel),
					declaredByteLength: pngPixel.byteLength,
				}),
			},
		));
		const original = await step('upload original content', async () => await fetch(
			`/api/graphics-assets/ingestion-operations/${initiated.id}/content`,
			{ method: 'PUT', headers: authorHeaders, body: pngPixel },
		).then(expectOperationResult));
		expect(original.stage).toBe('completed');

		return {
			reference: { assetId: original.result.assetId, revisionId: original.result.revisionId },
			name,
		};
	}

	/**
	 * A Screen mutation, so this is one of the two operations #123 suspects: it
	 * awaits a real Ably REST publish before it answers.
	 *
	 * The `$fetch` here has no explicit response type, so `step`'s type parameter
	 * would be inferred through Nitro's route table — which overflows the checker
	 * with TS2321. Annotating the callback settles the type before it reaches the
	 * generic.
	 */
	async function pin(reference: GraphicAssetReference): Promise<void> {
		const config: FeatureMatchOverlayModeConfig = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
		config.layout.frame.backgroundImage = { kind: 'asset', ...reference };
		await step('pin the revision to the Screen', async (): Promise<void> => {
			await $fetch(
				`/api/events/${eventId}/screens/${screenId}/config/feature-match-overlay`,
				{
					method: 'PATCH',
					body: { layout: config.layout },
				},
			);
		});
	}

	async function initiateReplacement(assetId: string, idempotencyKey: string): Promise<GraphicsIngestionOperation> {
		return await $fetch<GraphicsIngestionOperation>(
			`/api/graphics-assets/${assetId}/replacement-operations`,
			{
				method: 'POST',
				headers: authorHeaders,
				body: {
					idempotencyKey,
					sourceFileName: `${idempotencyKey}.png`,
					declaredMime: 'image/png',
					browserDecodeEvidence: decodeEvidence(replacementPng),
					declaredByteLength: replacementPng.byteLength,
				},
			},
		);
	}

	async function uploadReplacement(operation: GraphicsIngestionOperation) {
		return await fetch(
			`/api/graphics-assets/ingestion-operations/${operation.id}/content`,
			{
				method: 'PUT',
				headers: { ...authorHeaders, 'content-type': 'image/png' },
				body: replacementPng,
			},
		).then(expectOperationResult);
	}

	async function replace(assetId: string, key: string) {
		const operation = await step('initiate replacement', async () => await initiateReplacement(assetId, `replacement-integration-${key}`));
		return await step('upload replacement content', async () => await uploadReplacement(operation));
	}

	async function usageOf(assetId: string): Promise<GraphicAssetUsage[]> {
		return await step('read usage', async () => await $fetch<GraphicAssetUsage[]>(
			`/api/graphics-assets/${assetId}/usage`,
			{ headers: authorHeaders },
		));
	}

	async function inLibrary(name: string, assetId: string): Promise<GraphicAsset | undefined> {
		const found = await step('search the library', async () => await $fetch<GraphicAsset[]>('/api/graphics-assets', {
			headers: authorHeaders,
			query: { search: name },
		}));
		return found.find(asset => asset.id === assetId);
	}

	it('records replaced content as a new Graphic Asset Revision of the same Graphic Asset, current in the library', async () => {
		const { reference, name } = await publish('revision');

		const replaced = await replace(reference.assetId, 'revision');

		expect(replaced.result).toMatchObject({
			outcome: 'revision-created',
			assetId: reference.assetId,
		});
		expect(await inLibrary(name, reference.assetId)).toMatchObject({
			id: reference.assetId,
			revisionId: replaced.result.revisionId,
			revisionNumber: 2,
		});
	});

	it('keeps the Screen pinned to the Graphic Asset Revision it adopted, whose bytes still resolve', async () => {
		const { reference } = await publish('pinned');
		await pin(reference);

		await replace(reference.assetId, 'pinned');

		expect(await usageOf(reference.assetId)).toEqual([
			expect.objectContaining({
				reference,
				owner: {
					kind: 'screen',
					id: String(screenId),
					name: 'Replacement overlay',
					slot: 'layout.frame.backgroundImage',
					eventId,
				},
			}),
		]);
		const oldContent = await step('read superseded revision content', async () => await fetch(
			`/api/graphics-assets/${reference.assetId}/revisions/${reference.revisionId}/content`,
			{ headers: authorHeaders },
		));
		expect(oldContent.status).toBe(200);
		expect(new Uint8Array(await oldContent.arrayBuffer())).toEqual(pngPixel);
	});

	it('keeps every Graphic Asset Reference pinned across a rename of the Graphic Asset', async () => {
		const { reference } = await publish('renamed');
		await pin(reference);
		const replaced = await replace(reference.assetId, 'renamed');

		const renamed = await step('rename the asset', async () => await $fetch<GraphicAsset>(
			`/api/graphics-assets/${reference.assetId}`,
			{
				method: 'PATCH',
				headers: authorHeaders,
				body: { name: 'Renamed integration logo', eventIds: [] },
			},
		));

		expect(renamed).toMatchObject({
			revisionId: replaced.result.revisionId,
			revisionNumber: 2,
			name: 'Renamed integration logo',
			eventIds: [],
		});
		expect(await usageOf(reference.assetId)).toEqual([
			expect.objectContaining({ reference }),
		]);
	});

	it('moves the pin only once its owning Screen explicitly adopts the newer Graphic Asset Revision', async () => {
		const { reference } = await publish('adopted');
		await pin(reference);
		const replaced = await replace(reference.assetId, 'adopted');
		const adopted: GraphicAssetReference = { assetId: reference.assetId, revisionId: replaced.result.revisionId };

		// The second Screen mutation, and the second real Ably REST publish.
		await pin(adopted);

		expect(await usageOf(reference.assetId)).toEqual([
			expect.objectContaining({
				reference: adopted,
				owner: expect.objectContaining({
					eventId,
					id: String(screenId),
				}),
			}),
		]);
	});

	/**
	 * The other operation #123 suspects of stalling, and the reason it has a test
	 * to itself: two replacements of one Graphic Asset are issued together on
	 * purpose, so whichever of the steps below hangs is named by itself rather than
	 * by whatever a chain reached first.
	 */
	it('settles two concurrent replacements of one Graphic Asset into a single new Revision', async () => {
		const { reference, name } = await publish('concurrent');
		await pin(reference);

		const concurrentOperations = await step('initiate both replacements', async () => await Promise.all(
			['replacement-integration-concurrent-a', 'replacement-integration-concurrent-b'].map(
				async idempotencyKey => await initiateReplacement(reference.assetId, idempotencyKey),
			),
		));
		const concurrentReplacements = await step('upload both replacements', async () => await Promise.all(
			concurrentOperations.map(async operation => await uploadReplacement(operation)),
		));

		expect(concurrentReplacements.map(operation => operation.result.outcome).sort()).toEqual([
			'replacement-noop',
			'revision-created',
		]);
		expect(new Set(
			concurrentReplacements.map(operation => operation.result.revisionId),
		).size).toBe(1);
		expect(await inLibrary(name, reference.assetId)).toMatchObject({
			id: reference.assetId,
			revisionId: concurrentReplacements[0]!.result.revisionId,
			revisionNumber: 2,
		});
		// The Screen adopted neither: its pin is still the revision it was given.
		expect(await usageOf(reference.assetId)).toEqual([
			expect.objectContaining({ reference }),
		]);
	});
});
