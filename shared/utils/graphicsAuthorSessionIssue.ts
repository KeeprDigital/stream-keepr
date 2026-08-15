/**
 * The marker the graphics author session middleware leaves when it could not
 * issue a session (#206).
 *
 * The session itself is an `httpOnly` cookie the browser can never read, and
 * the middleware deliberately serves the page even when minting one fails — so
 * without this, a Library Workspace that was never given a session renders as a
 * run of bare 401s with nothing anywhere naming the cause. This cookie is the
 * one signal that crosses that gap: readable by the page, written only on a
 * failed mint, and removed by the next navigation whose mint succeeds. It
 * carries no secret and no identity — its presence is the entire message.
 */
export const GRAPHICS_AUTHOR_SESSION_ISSUE_FAILED_COOKIE
	= 'stream_keepr_graphics_author_session_issue_failed';
