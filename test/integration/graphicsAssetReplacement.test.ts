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
	/**
	 * The scenarios below are one chain of state deliberately, in declaration
	 * order: a replacement can only be observed against an asset some Screen has
	 * already pinned, and the concurrency scenario needs a revision to race
	 * against. Splitting them is what makes a stall legible; sharing the chain is
	 * what keeps each one about a single operation.
	 *
	 * The chain's cost is that one failure reddens its successors, which read this
	 * state and will throw on it being unset. Read the FIRST red test: the ones
	 * below it are consequences, and their errors describe the missing state rather
	 * than anything about themselves.
	 */
	let config: FeatureMatchOverlayModeConfig;
	let originalReference: GraphicAssetReference;
	let replaced: GraphicsIngestionOperation;

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
					milliseconds === undefined ? 'never returned' : `${milliseconds}ms`
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

	it('publishes the Graphic Asset its owning Screen pins', async () => {
		const initiated = await step('initiate original ingestion', async () => await $fetch<GraphicsIngestionOperation>(
			'/api/graphics-assets/ingestion-operations',
			{
				method: 'POST',
				headers: authorHeaders,
				body: graphicsIngestionRequest({
					idempotencyKey: 'replacement-integration-original',
					name: 'Replaceable integration logo',
					defaultEventId: eventId,
					browserDecodeEvidence: decodeEvidence(pngPixel),
					declaredByteLength: pngPixel.byteLength,
				}),
			},
		));
		const original = await step('upload original content', async () => await fetch(
			`/api/graphics-assets/ingestion-operations/${initiated.id}/content`,
			{ method: 'PUT', headers: authorHeaders, body: pngPixel },
		).then(response => response.json() as Promise<GraphicsIngestionOperation>));
		expect(original.stage).toBe('completed');

		originalReference = {
			assetId: original.result!.assetId,
			revisionId: original.result!.revisionId,
		};
		config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
		config.layout.frame.backgroundImage = originalReference;
		// A Screen mutation, so this is one of the two operations #123 suspects: it
		// awaits a real Ably REST publish before it answers.
		// This is one of the two `$fetch` calls here with no explicit response type,
		// so `step`'s type parameter would be inferred through Nitro's route table —
		// which overflows the checker with TS2321, which surfaces about two at a
		// time. Annotating
		// the callback settles the type before it reaches the generic.
		await step('pin the original revision to the Screen', async (): Promise<void> => {
			await $fetch(
				`/api/events/${eventId}/screens/${screenId}/config/feature-match-overlay`,
				{ method: 'PATCH', body: { layout: config.layout } },
			);
		});
	});

	it('records replaced content as a new Graphic Asset Revision of the same Graphic Asset', async () => {
		const replacementOperation = await step('initiate replacement', async () => await $fetch<GraphicsIngestionOperation>(
			`/api/graphics-assets/${originalReference.assetId}/replacement-operations`,
			{
				method: 'POST',
				headers: authorHeaders,
				body: {
					idempotencyKey: 'replacement-integration-jpeg',
					sourceFileName: 'new-logo.png',
					declaredMime: 'image/png',
					browserDecodeEvidence: decodeEvidence(replacementPng),
					declaredByteLength: replacementPng.byteLength,
				},
			},
		));
		replaced = await step('upload replacement content', async () => await fetch(
			`/api/graphics-assets/ingestion-operations/${replacementOperation.id}/content`,
			{
				method: 'PUT',
				headers: { ...authorHeaders, 'content-type': 'image/png' },
				body: replacementPng,
			},
		).then(response => response.json() as Promise<GraphicsIngestionOperation>));
		expect(replaced.result).toMatchObject({
			outcome: 'revision-created',
			assetId: originalReference.assetId,
		});
	});

	it('keeps the Screen pinned to the Graphic Asset Revision it adopted, whose bytes still resolve', async () => {
		await expect(step('read usage after replacement', async () => await $fetch<GraphicAssetUsage[]>(
			`/api/graphics-assets/${originalReference.assetId}/usage`,
			{ headers: authorHeaders },
		))).resolves.toEqual([
			expect.objectContaining({
				reference: originalReference,
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
			`/api/graphics-assets/${originalReference.assetId}/revisions/${originalReference.revisionId}/content`,
			{ headers: authorHeaders },
		));
		expect(oldContent.status).toBe(200);
		expect(new Uint8Array(await oldContent.arrayBuffer())).toEqual(pngPixel);
	});

	it('reports the replacement as the current Graphic Asset Revision in the library', async () => {
		const [latest] = await step('search the library', async () => await $fetch<GraphicAsset[]>('/api/graphics-assets', {
			headers: authorHeaders,
			query: { search: 'Replaceable integration logo' },
		}));
		expect(latest).toMatchObject({
			id: originalReference.assetId,
			revisionId: replaced.result?.revisionId,
			revisionNumber: 2,
		});
	});

	it('keeps every Graphic Asset Reference pinned across a rename of the Graphic Asset', async () => {
		const renamed = await step('rename the asset', async () => await $fetch<GraphicAsset>(
			`/api/graphics-assets/${originalReference.assetId}`,
			{
				method: 'PATCH',
				headers: authorHeaders,
				body: { name: 'Renamed integration logo', eventIds: [] },
			},
		));
		expect(renamed).toMatchObject({
			revisionId: replaced.result?.revisionId,
			revisionNumber: 2,
			name: 'Renamed integration logo',
			eventIds: [],
		});
		await expect(step('read usage after rename', async () => await $fetch<GraphicAssetUsage[]>(
			`/api/graphics-assets/${originalReference.assetId}/usage`,
			{ headers: authorHeaders },
		))).resolves.toEqual([
			expect.objectContaining({ reference: originalReference }),
		]);
	});

	it('moves the pin only once its owning Screen explicitly adopts the newer Graphic Asset Revision', async () => {
		config.layout.frame.backgroundImage = {
			assetId: originalReference.assetId,
			revisionId: replaced.result!.revisionId,
		};
		// The second Screen mutation, and the second real Ably REST publish. Typed
		// like the pin above, and for the same TS2321 reason.
		await step('adopt the new revision on the Screen', async (): Promise<void> => {
			await $fetch(
				`/api/events/${eventId}/screens/${screenId}/config/feature-match-overlay`,
				{ method: 'PATCH', body: { layout: config.layout } },
			);
		});
		await expect(step('read usage after adoption', async () => await $fetch<GraphicAssetUsage[]>(
			`/api/graphics-assets/${originalReference.assetId}/usage`,
			{ headers: authorHeaders },
		))).resolves.toEqual([
			expect.objectContaining({
				reference: config.layout.frame.backgroundImage,
				owner: expect.objectContaining({ eventId, id: String(screenId) }),
			}),
		]);
	});

	/**
	 * The other operation #123 suspects of stalling, and the reason it has a test
	 * to itself: two replacements of one Graphic Asset are issued together on
	 * purpose, so whichever of the four steps below hangs is named by itself
	 * rather than by whatever the chain reached first.
	 */
	it('settles two concurrent replacements of one Graphic Asset into a single new Revision', async () => {
		const concurrentOperations = await step('initiate both replacements', async () => await Promise.all(
			['replacement-integration-concurrent-a', 'replacement-integration-concurrent-b'].map(
				async idempotencyKey => await $fetch<GraphicsIngestionOperation>(
					`/api/graphics-assets/${originalReference.assetId}/replacement-operations`,
					{
						method: 'POST',
						headers: authorHeaders,
						body: {
							idempotencyKey,
							sourceFileName: `${idempotencyKey}.png`,
							declaredMime: 'image/png',
							browserDecodeEvidence: decodeEvidence(pngPixel),
							declaredByteLength: pngPixel.byteLength,
						},
					},
				),
			),
		));
		const concurrentReplacements = await step('upload both replacements', async () => await Promise.all(
			concurrentOperations.map(
				async operation => await fetch(
					`/api/graphics-assets/ingestion-operations/${operation.id}/content`,
					{
						method: 'PUT',
						headers: { ...authorHeaders, 'content-type': 'image/png' },
						body: pngPixel,
					},
				).then(response => response.json() as Promise<GraphicsIngestionOperation>),
			),
		));
		expect(concurrentReplacements.map(operation => operation.result?.outcome).sort()).toEqual([
			'replacement-noop',
			'revision-created',
		]);
		expect(new Set(
			concurrentReplacements.map(operation => operation.result?.revisionId),
		).size).toBe(1);
		const [concurrentLatest] = await step('search the library again', async () => await $fetch<GraphicAsset[]>('/api/graphics-assets', {
			headers: authorHeaders,
			query: { search: 'Renamed integration logo' },
		}));
		expect(concurrentLatest).toMatchObject({
			id: originalReference.assetId,
			revisionId: concurrentReplacements[0]!.result?.revisionId,
			revisionNumber: 3,
		});
		await expect(step('read usage after the concurrent replacements', async () => await $fetch<GraphicAssetUsage[]>(
			`/api/graphics-assets/${originalReference.assetId}/usage`,
			{ headers: authorHeaders },
		))).resolves.toEqual([
			expect.objectContaining({
				reference: config.layout.frame.backgroundImage,
			}),
		]);
	});
});
