import { ensureGraphicsAuthorSession } from '~~/server/modules/graphics-author-session';
import { GRAPHICS_AUTHOR_SESSION_ISSUE_FAILED_COOKIE } from '~~/shared/utils/graphicsAuthorSessionIssue';

export default defineEventHandler(async (event) => {
	const requestUrl = getRequestURL(event);
	const acceptsHtml = getRequestHeader(event, 'accept')
		?.split(',')
		.some(value => value.trim().startsWith('text/html'));
	if (
		event.method !== 'GET'
		|| requestUrl.pathname.startsWith('/api/')
		|| !acceptsHtml
	) {
		return;
	}

	// THIS MIDDLEWARE MUST NOT REFUSE, and the refusal scan depends on it (#330(2)).
	//
	// `test/helpers/routeRefusalScan.ts` gives every middleware its own entry point,
	// because Nitro composes them around every route — but a middleware's graph stops at
	// `server/modules/**`, so the 401 `requireGraphicsAuthorSession` raises next door is
	// outside every graph the scan builds. Nothing else looks: no test asserts what this
	// path answers, and a banded 401 escaping here would reach the realtime diagnosis as
	// an unaccounted-for refusal that the exhaustiveness check is structurally unable to
	// see. This is the documented residual of that narrowing, and this call is where it
	// would become real.
	//
	// Two independent things keep it closed, and it takes **both** edits to open it:
	// `ensureGraphicsAuthorSession` mints rather than refuses, so the only thing it
	// raises is a 503 the band does not contain; and the catch below swallows whatever
	// it does raise. Switching to `requireGraphicsAuthorSession` while the catch stands
	// changes nothing, and dropping the catch while `ensure` stands lets out a 503 the
	// diagnosis cannot misread. Doing both lets out a 401.
	//
	// `test/unit/server/middleware/graphicsAuthorSession.test.ts` pins the property
	// rather than the spelling: no refusal from that module escapes this handler.
	try {
		await ensureGraphicsAuthorSession(event);
		// A recovered store stops claiming failure. Deleted only when present, so
		// the ordinary navigation — which never failed — writes no header at all.
		if (getCookie(event, GRAPHICS_AUTHOR_SESSION_ISSUE_FAILED_COOKIE) !== undefined)
			deleteCookie(event, GRAPHICS_AUTHOR_SESSION_ISSUE_FAILED_COOKIE, { path: '/' });
	}
	catch {
		console.warn(JSON.stringify({
			message: 'graphics_author_session_issue_failed',
			path: requestUrl.pathname,
		}));
		// #206(2): the page is served anyway, but no longer silently broken. The
		// session cookie is httpOnly, so this readable marker is the only way the
		// page can tell "never issued a session" from "session lapsed" — the
		// first is not healed by the reload the lapse notice prescribes. Setting
		// a cookie is not refusing; the property pinned above still holds.
		setCookie(event, GRAPHICS_AUTHOR_SESSION_ISSUE_FAILED_COOKIE, '1', {
			httpOnly: false,
			sameSite: 'lax',
			path: '/',
		});
	}
});
