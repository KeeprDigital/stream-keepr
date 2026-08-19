import type {
	GraphicAsset,
	GraphicsIngestionOperation,
} from '~~/shared/types/graphicsAsset';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { $fetch, fetch, operatorSessionCookie } from './client';
import { graphicsIngestionRequest } from './graphicsIngestionRequest';
import { anotherUser } from './identities';

/**
 * Who may *read* the Graphics Asset Library, proved through the real routes.
 *
 * #90 made the graphics author session the only ingestion identity and #116
 * guarded the lifecycle actions, which between them left the library writable
 * only by an authenticated author — and readable by anybody who could reach the
 * API at all. #172 closed that asymmetry, and #398 moved the refusal itself to
 * ADR-0010's boundary: a caller with no session never reaches these handlers, and
 * `apiBoundary.test.ts` is where that is proved.
 *
 * **What is left here is the half the boundary cannot state.** The Graphics Asset
 * Library is deliberately installation-wide: `CONTEXT.md` says graphics authors
 * may discover and reference every Graphic Asset, and #90 preserved that — its
 * guarantee is authentication, not ownership. So every read below is made by a
 * different person* from the one who published the subject. A suite that only
 * proved the refusals would pass just as well against a library narrowed to its
 * own author's assets, which is a different rule nobody chose — and since the
 * cutover, ownership is per-person rather than per-browser, which is exactly the
 * scope that rule has to survive.
 */

const basePixelPng = Uint8Array.from(Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
	'base64',
));
const emptyTextChunk = Uint8Array.of(0, 0, 0, 0, 0x74, 0x45, 0x58, 0x74, 0x96, 0x42, 0xC5, 0x85);

/**
 * This suite's own still-image content, padded with a chunk count no other
 * suite uses. Integration suites share one database and identical bytes
 * deduplicate into one Graphic Asset by design, so the bare single-pixel PNG
 * would publish under whichever suite reached the library first and this
 * suite's read subject would be somebody else's asset, on somebody else's
 * lifecycle. `120` because every count this suite could collide with is
 * already spoken for.
 */
const readSubjectPng = Uint8Array.from(Buffer.concat([
	basePixelPng.slice(0, -12),
	...Array.from({ length: 120 }).fill(emptyTextChunk) as Uint8Array[],
	basePixelPng.slice(-12),
]));

const digest = createHash('sha256').update(readSubjectPng).digest('hex');

const SUBJECT_NAME = 'Read authorisation subject';

/** What identifies the subject, once `beforeAll` has published it. */
interface ReadSubject {
	assetId: string;
	revisionId: string;
}

interface ReadRoute {
	label: string;
	path: (subject: ReadSubject) => string;
}

/**
 * Every route that reads the Graphics Asset Library.
 *
 * Stated at module level, and taking its subject as an argument, because
 * `it.each` builds its cases while the file is collected — before any
 * `beforeAll` has published anything for them to name.
 */
const readRoutes: ReadRoute[] = [
	{
		label: 'listing every Graphic Asset',
		path: () => '/api/graphics-assets',
	},
	{
		label: 'reading the installation\'s storage occupancy',
		path: () => '/api/graphics-assets/capacity',
	},
	{
		label: 'reading a rendered thumbnail',
		path: ({ assetId }) => `/api/graphics-assets/${assetId}/thumbnail`,
	},
	{
		label: 'reading which Screens and Events reference an asset',
		path: ({ assetId }) => `/api/graphics-assets/${assetId}/usage`,
	},
	{
		label: 'reading retention state',
		path: ({ assetId }) => `/api/graphics-assets/${assetId}/retention`,
	},
	{
		// Not one of the five #172 lists. #55 created this route and its sibling
		// `content.get` together and guarded only that one, so the same revision's
		// bytes were authenticated while the facts describing them were not.
		label: 'inspecting a Graphic Asset Revision\'s delivery status',
		path: ({ assetId, revisionId }) =>
			`/api/graphics-assets/${assetId}/revisions/${revisionId}/status`,
	},
];

describe('the Graphics Asset Library read surface', () => {
	let publishingAuthorCookie: string;
	/** A second, unrelated **person**. Every success below is read by this one. */
	let readingAuthorCookie: string;
	let subject: ReadSubject;
	let eventId: number;

	beforeAll(async () => {
		publishingAuthorCookie = await operatorSessionCookie();
		readingAuthorCookie = await anotherUser('library-reader');
		expect(readingAuthorCookie).not.toBe(publishingAuthorCookie);

		// The subject carries an Event association because the usage route is the
		// one that names Screens and Events, and an asset attached to nothing
		// would let it answer with an empty list whatever the guard did.
		const event = await $fetch<{ id: number }>('/api/events', {
			method: 'POST',
			body: {
				name: 'Graphics Read Authorisation Event',
				game: 'mtg',
				featureMatchOrientation: 'horizontal',
			},
		});
		eventId = event.id;

		const initiated = await $fetch<GraphicsIngestionOperation>(
			'/api/graphics-assets/ingestion-operations',
			{
				method: 'POST',
				headers: { cookie: publishingAuthorCookie },
				body: graphicsIngestionRequest({
					idempotencyKey: 'read-authorisation-subject',
					name: SUBJECT_NAME,
					defaultEventId: eventId,
					declaredByteLength: readSubjectPng.byteLength,
					browserDecodeEvidence: {
						outcome: 'decoded',
						sourceDigest: digest,
						width: 1,
						height: 1,
					},
				}),
			},
		);
		const published = await $fetch<GraphicsIngestionOperation>(
			`/api/graphics-assets/ingestion-operations/${initiated.id}/content`,
			{
				method: 'PUT',
				headers: { 'cookie': publishingAuthorCookie, 'content-type': 'image/png' },
				body: readSubjectPng,
			},
		);
		expect(published.stage).toBe('completed');
		subject = {
			assetId: published.result!.assetId,
			revisionId: published.result!.revisionId,
		};
	});

	afterAll(async () => {
		try {
			await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
		}
		catch {}
	});

	describe('any authenticated graphics author', () => {
		it.each(readRoutes)('may still perform $label', async ({ path }) => {
			const response = await fetch(path(subject), { headers: { cookie: readingAuthorCookie } });
			expect(response.status).toBe(200);
		});

		/**
		 * The installation-wide guarantee, stated as a fact rather than as a
		 * status code: an author who published nothing sees an asset another
		 * author published, and sees what it is attached to.
		 */
		it('discovers a Graphic Asset published by a different author', async () => {
			await expect($fetch<GraphicAsset[]>('/api/graphics-assets', {
				headers: { cookie: readingAuthorCookie },
				query: { search: SUBJECT_NAME },
			})).resolves.toMatchObject([{ id: subject.assetId, eventIds: [eventId] }]);
		});
	});

	/*
	 * Two describes stood here until #398, and both were about a mechanism that is
	 * gone: a browser which had only ever loaded an operator's Screen page carried
	 * a Graphics Author Session anyway, because the middleware minted one on any
	 * HTML `GET` — so the guard admitted "some browser has loaded this
	 * application" rather than "this caller is an author". Nothing is minted by
	 * loading a page now. An operator working Live Control reads the library
	 * because they are signed in, which is the same reason everybody else does,
	 * and `apiBoundary.test.ts` covers the signed-out case once for every route.
	 */
});
