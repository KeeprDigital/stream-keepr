import type {
	GraphicAsset,
	GraphicsAssetLibraryCapacity,
	GraphicsIngestionOperation,
} from '~~/shared/types/graphicsAsset';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { $fetch, fetch } from '@nuxt/test-utils/e2e';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGraphicsAuthorSessionCookie } from './graphicsAuthorSession';
import { graphicsIngestionRequest } from './graphicsIngestionRequest';

/**
 * Who may *read* the Graphics Asset Library, proved through the real routes.
 *
 * #90 made the graphics author session the only ingestion identity and #116
 * guarded the lifecycle actions, which between them left the library writable
 * only by an authenticated author — and readable by anybody who could reach the
 * API at all. #172 closes that asymmetry: the read surface answers `401` to a
 * caller carrying no graphics author session.
 *
 * **What the guard is, and what it is not.** The Graphics Asset Library is
 * deliberately installation-wide: `CONTEXT.md` states that graphics authors may
 * discover and reference every Graphic Asset, and #90 preserved that — its
 * guarantee is authentication, not ownership. So every case below pairs a
 * refusal with the same read succeeding for *an* author, and the author that
 * succeeds is never the one that published the subject. A suite that only
 * proved the refusals would pass just as well against a library that had been
 * narrowed to its own author's assets, which is a different rule nobody chose.
 *
 * **Why there is no SSR case here.** The ticket anticipated one: the Library
 * Workspace fetches the listing through `useFetch`, so gating it would strand
 * the Workspace unless the fetch forwarded the session cookie server-side. It
 * does not arise — `nuxt.config.ts` sets `ssr: false`, so the Workspace's
 * `useFetch` never runs on the server and the browser sends the `httpOnly`
 * cookie itself. What replaces it is the last case in this suite, which walks
 * the path the browser actually walks: the Workspace shell request mints the
 * session, and that session reads the library populated.
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

/** The header that used to name the graphics author. It must still buy nothing. */
const RETIRED_AUTHOR_HEADER = { 'x-graphics-author-id': 'read-authorisation-author' };

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
	/** A second, unrelated author. Every success below is read by this one. */
	let readingAuthorCookie: string;
	let subject: ReadSubject;
	let eventId: number;

	beforeAll(async () => {
		publishingAuthorCookie = await createGraphicsAuthorSessionCookie();
		readingAuthorCookie = await createGraphicsAuthorSessionCookie();
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

	describe('a caller carrying no graphics author session', () => {
		it.each(readRoutes)('is refused $label', async ({ path }) => {
			const response = await fetch(path(subject), { headers: { ...RETIRED_AUTHOR_HEADER } });
			expect(response.status).toBe(401);
		});
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

	/**
	 * What the guard actually admits, which is wider than its name suggests.
	 *
	 * Worth pinning because #178 mounts the Library's own picker on Live
	 * Control, an operator surface rather than an authoring one, and the
	 * obvious reading of "requires a graphics author session" is that an
	 * operator would be refused.
	 *
	 * They are not, and nothing here is special-cased to make that true. There
	 * is no login and no role in this codebase: `server/middleware/
	 * graphics-author-session.ts` mints a session on *any* non-`/api/` HTML
	 * `GET`, at cookie path `/`. A browser that has only ever opened an
	 * operator's Screen page therefore carries one exactly as an author's
	 * browser does, and `requireGraphicsAuthorSession` — which checks only that
	 * a session exists, and whose `authorId` these routes discard — admits it.
	 *
	 * So the guard this suite proves is "some browser has loaded this
	 * application", not "this caller is an author". That is the honest reading
	 * of what #90 built and what #172 extends to the read surface, and it is
	 * what makes the two branches compatible. Whether an operator *should*
	 * carry an authoring identity is a design question this suite does not
	 * answer and must not prejudge.
	 */
	describe('a browser that has only ever loaded an operator surface', () => {
		it('carries a session that reads the library', async () => {
			const operatorPage = await fetch(`/event/${eventId}/screens`, {
				headers: { accept: 'text/html' },
			});
			expect(operatorPage.status).toBe(200);
			const cookie = operatorPage.headers.get('set-cookie')?.split(';', 1)[0];
			expect(cookie).toMatch(/^stream_keepr_graphics_author_session=/);

			// The two routes #178's picker reaches: the listing behind
			// `GraphicsAssetFocusPicker`, and the revision status it resolves a
			// selection against.
			await expect($fetch<GraphicAsset[]>('/api/graphics-assets', {
				headers: { cookie: cookie! },
				query: { search: SUBJECT_NAME },
			})).resolves.toMatchObject([{ id: subject.assetId }]);
			const revisionStatus = await fetch(
				`/api/graphics-assets/${subject.assetId}/revisions/${subject.revisionId}/status`,
				{ headers: { cookie: cookie! } },
			);
			expect(revisionStatus.status).toBe(200);
			// And the thumbnail the picker renders one of per asset.
			const thumbnail = await fetch(
				`/api/graphics-assets/${subject.assetId}/thumbnail`,
				{ headers: { cookie: cookie! } },
			);
			expect(thumbnail.status).toBe(200);
		});
	});

	/**
	 * The path the browser walks, in place of the SSR forwarding the ticket
	 * anticipated. A deep link to the Workspace — not a visit to `/` first — is
	 * what has to mint the session, because that is what an author who
	 * bookmarked the library does.
	 */
	describe('the Library Workspace', () => {
		it('is served a session that reads the library populated', async () => {
			const shell = await fetch('/graphics-assets', { headers: { accept: 'text/html' } });
			expect(shell.status).toBe(200);
			const cookie = shell.headers.get('set-cookie')?.split(';', 1)[0];
			expect(cookie).toMatch(/^stream_keepr_graphics_author_session=/);

			await expect($fetch<GraphicAsset[]>('/api/graphics-assets', {
				headers: { cookie: cookie! },
				query: { search: SUBJECT_NAME },
			})).resolves.toMatchObject([{ id: subject.assetId }]);
			// The Workspace fetches the occupancy alongside the listing, so a guard
			// that stranded only the second would still render a broken library.
			await expect($fetch<GraphicsAssetLibraryCapacity>('/api/graphics-assets/capacity', {
				headers: { cookie: cookie! },
			})).resolves.toMatchObject({ canonical: { usedBytes: expect.any(Number) } });
		});
	});
});
