import { relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
	apiPathRequiresSession,
	SESSION_EXEMPT_API_PATHS,
	SESSION_EXEMPT_API_PREFIXES,
} from '~~/server/utils/apiBoundary';
import { scanRouteRefusals, typeScriptFilesUnder } from '~~/test/helpers/routeRefusalScan';

/**
 * The deny-by-default API boundary's path policy (#396, ADR-0010).
 *
 * Two halves, and the second is the one that keeps the first honest. The rows
 * below establish what the function answers for the spellings that matter; the
 * census after them reads **every route file on disk** through it and pins the
 * public side against a literal, so a route added public — or a private route
 * that a widened prefix quietly captures — fails here rather than being
 * discovered from the internet.
 */

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const API_DIRECTORY = fileURLToPath(new URL('../../../../server/api/', import.meta.url));
const ADMIN_DIRECTORY = fileURLToPath(new URL('../../../../server/api/admin/', import.meta.url));

const METHOD_SUFFIX = /\.(?:get|post|put|patch|delete)$/;

/**
 * One concrete request path per route file, as Nitro would route it.
 *
 * Parameters get a literal because the boundary reads paths and not routes: it
 * has to answer for `/api/events/1/players`, which is what arrives, rather than
 * for `/api/events/:id/players`, which never does. The value chosen is
 * deliberately not numeric for most of them — nothing in the policy parses a
 * segment, and a path that looks like a real id invites a reader to think it
 * might.
 */
function requestPathFor(routeFile: string): string {
	const withinApi = relative(API_DIRECTORY, routeFile).split(sep);
	const segments = withinApi
		.map(segment => segment.replace(/\.ts$/, '').replace(METHOD_SUFFIX, ''))
		.flatMap((segment) => {
			if (segment === 'index')
				return [];
			if (segment.startsWith('[...'))
				return ['catch', 'all'];
			if (segment.startsWith('['))
				return ['a-parameter'];
			return [segment];
		});

	return `/api/${segments.join('/')}`;
}

const routeFiles = typeScriptFilesUnder(API_DIRECTORY);

/** Every route file the boundary lets through without a session, as repo paths. */
const publicRouteFiles = routeFiles
	.filter(file => !apiPathRequiresSession(requestPathFor(file)))
	.map(file => relative(REPOSITORY_ROOT, file))
	.sort();

const adminRouteFiles = typeScriptFilesUnder(ADMIN_DIRECTORY)
	.map(file => relative(REPOSITORY_ROOT, file))
	.sort();

describe('which API paths require a session', () => {
	it('requires one for an ordinary route', () => {
		expect(apiPathRequiresSession('/api/events/1/players')).toBe(true);
		expect(apiPathRequiresSession('/api/graphics-assets')).toBe(true);
	});

	it('requires one for a route nobody has written yet, which is the whole posture', () => {
		// The property that distinguishes this from the guard-by-guard posture it
		// replaces: the default is closed, so a route added tomorrow is private
		// without anybody remembering to make it so.
		expect(apiPathRequiresSession('/api/something-invented-today')).toBe(true);
		expect(apiPathRequiresSession('/api/events/1/a-route-added-later')).toBe(true);
	});

	it('requires one for the bare prefix, which is the shape a widened router would reach through', () => {
		// No handler answers `/api` or `/api/` today, so this is about the direction
		// of the guess rather than about a route: a path the boundary did not
		// recognise at all is the one that would reach a handler unauthenticated if
		// the router ever started matching it. Asserted rather than reasoned about,
		// because the comment in `isApiPath` claims it and a comment is not a check.
		expect(apiPathRequiresSession('/api')).toBe(true);
		expect(apiPathRequiresSession('/api/')).toBe(true);
	});

	it('leaves everything outside /api/** alone', () => {
		// Pages and assets are unavoidably public under `ssr: false`, and are
		// gated client-side as UX. The one that would matter if it were wrong is
		// the SPA shell, since the whole application is served from it.
		for (const path of ['/', '/login', '/event/12/screen/main', '/_nuxt/entry.js', '/favicon.ico'])
			expect(apiPathRequiresSession(path)).toBe(false);
	});

	it('exempts the clock, the realtime token and the bootstrap route', () => {
		expect(apiPathRequiresSession('/api/time')).toBe(false);
		expect(apiPathRequiresSession('/api/realtime/token')).toBe(false);
		expect(apiPathRequiresSession('/api/bootstrap/ensure-admin')).toBe(false);
	});

	it('exempts the auth router, the capability surface and the admin surface', () => {
		expect(apiPathRequiresSession('/api/auth/sign-in/email')).toBe(false);
		expect(apiPathRequiresSession('/api/screen-output/screens/7/asset-capability-session')).toBe(false);
		expect(apiPathRequiresSession('/api/admin/graphics-assets/health')).toBe(false);
	});

	it('ignores the one trailing slash Nitro ignores', () => {
		// Nitro strips it before matching, so `/api/time/` reaches the handler
		// `/api/time` does. A policy that read the two spellings differently from
		// the router would differ about what is reachable, and the expensive half
		// of that difference is a private route answered without a session.
		expect(apiPathRequiresSession('/api/time/')).toBe(false);
		expect(apiPathRequiresSession('/api/events/1/players/')).toBe(true);
	});

	it('does not let an exact exemption capture a longer path', () => {
		// The exact entries are exact for a reason: `/api/time` is a clock
		// reading, and nothing under it is.
		expect(apiPathRequiresSession('/api/time/zones')).toBe(true);
		expect(apiPathRequiresSession('/api/realtime/token/mint')).toBe(true);
		expect(apiPathRequiresSession('/api/bootstrap/ensure-anything-else')).toBe(true);
	});

	it('does not let a prefix exemption capture a sibling that merely starts the same', () => {
		// The near misses are a single character, and each of them would be a
		// private surface published: `/api/authors/**` is not Better Auth's
		// router, and `/api/administration/**` is not the Graphics Administrator
		// surface.
		expect(apiPathRequiresSession('/api/authors/12')).toBe(true);
		expect(apiPathRequiresSession('/api/administration/users')).toBe(true);
		expect(apiPathRequiresSession('/api/screen-outputs/7')).toBe(true);
		// And the bare prefixes themselves are not exempt. No route answers any
		// of them, so the only thing at stake is the direction of the guess.
		for (const prefix of SESSION_EXEMPT_API_PREFIXES)
			expect(apiPathRequiresSession(prefix.slice(0, -1))).toBe(true);
	});

	it('reads a folded-case API path as an API path, and so as private', () => {
		// Nothing asks for this spelling. It is answered in the safe direction
		// rather than left to depend on whether any router, proxy or runtime
		// between here and the handler folds case.
		expect(apiPathRequiresSession('/API/events/1/players')).toBe(true);
		expect(apiPathRequiresSession('/Api/graphics-assets')).toBe(true);
	});

	it('requires one for the resolved form of a path that climbs out of an exempt surface', () => {
		// `getRequestURL` hands over a pathname the URL parser has already
		// resolved, so this is the string the middleware really sees.
		expect(apiPathRequiresSession(new URL('https://s.example/api/screen-output/../events/1/players').pathname))
			.toBe(true);
	});
});

/**
 * The exhaustiveness half: every route file on disk, read through the policy.
 *
 * A row asserting `/api/events/1/players` is private establishes that one path.
 * This establishes the set — which is the claim ADR-0010 actually makes, and
 * the one a widened prefix or a new public route would falsify silently.
 */
describe('the public surface, counted against the routes on disk', () => {
	it('is found at all, so this cannot pass by scanning nothing', () => {
		expect(routeFiles.length).toBeGreaterThan(150);
		expect(adminRouteFiles.length).toBe(18);
	});

	it('is exactly these routes, and every one of them is a decision ADR-0010 records', () => {
		expect(publicRouteFiles.filter(file => !file.startsWith('server/api/admin/'))).toEqual([
			// Better Auth's own router. Sign-in must be reachable or nothing ever
			// acquires a session.
			'server/api/auth/[...all].ts',
			// The first-admin bootstrap, armed by a Worker secret and 503 without
			// it. It exists for the installation that has no account to sign in to.
			'server/api/bootstrap/ensure-admin.post.ts',
			// An Ably token request. #397 narrows what an unauthenticated caller is
			// granted; that is a change to what this issues, not to its reachability.
			'server/api/realtime/token.get.ts',
			// The Screen Output Asset Capability surface: authorised by the bearer
			// token the output page holds in its URL hash, refusing 404 rather than
			// 401/403 so it cannot be used to enumerate.
			'server/api/screen-output/screens/[screenId]/asset-capability-session.post.ts',
			'server/api/screen-output/screens/[screenId]/assets/[assetId]/revisions/[revisionId]/content.get.ts',
			// A clock reading for output drift correction, with no Event or Screen
			// identity in it.
			'server/api/time.get.ts',
		]);
	});

	it('exempts the whole admin surface and nothing else by that clause', () => {
		// Stated as "all eighteen" rather than as a list, because the clause
		// ADR-0010 records is about the surface: `x-graphics-admin-token` alone
		// satisfies the boundary there, which is exactly today's posture.
		expect(publicRouteFiles.filter(file => file.startsWith('server/api/admin/'))).toEqual(adminRouteFiles);
	});

	it('keeps the Screen lookup by slug private, which is where it now sits', () => {
		// ADR-0010 has this route leave the public surface: #397 folds it into the
		// capability surface, requiring the bearer the output page already holds.
		// Until then it is private, which is the fail-closed direction — the
		// output page loses a lookup, rather than the boundary keeping a hole.
		expect(apiPathRequiresSession('/api/events/1/screens/slug/main')).toBe(true);
		expect(publicRouteFiles).not.toContain('server/api/events/[id]/screens/slug/[slug].get.ts');
	});

	it('names every exemption in one of the two lists, so the census above is total', () => {
		// The policy consults exactly these two lists; a third mechanism inside
		// `apiPathRequiresSession` would be an exemption the literal above could
		// not describe.
		for (const file of publicRouteFiles) {
			const path = requestPathFor(fileURLToPath(new URL(`../../../../${file}`, import.meta.url)));
			const named = SESSION_EXEMPT_API_PATHS.includes(path)
				|| SESSION_EXEMPT_API_PREFIXES.some(prefix => path.startsWith(prefix));
			expect(named, `${file} is public for no listed reason`).toBe(true);
		}
	});
});

/**
 * The residual the admin exemption creates, closed where it is created.
 *
 * `/api/admin/**` is exempt from the session boundary, so each route under it
 * is protected by its own `requireGraphicsAdministrator` call and by nothing
 * else. An admin route added without one would be **fully public** — the exact
 * failure mode deny-by-default exists to remove, surviving in the one subtree
 * that opts out of it.
 *
 * Read from the import graph rather than from the file's text, because the
 * guard is allowed to arrive through a helper: what has to be true is that the
 * route reaches it, not that it spells it out.
 */
describe('the admin surface, which answers to its own credential', () => {
	it.each(adminRouteFiles)('%s reaches the Graphics Administrator guard', (file) => {
		const scan = scanRouteRefusals(fileURLToPath(new URL(`../../../../${file}`, import.meta.url)));

		expect(scan.files).toContain('server/modules/graphics-administrator.ts');
	});
});
