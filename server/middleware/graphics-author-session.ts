import { ensureGraphicsAuthorSession } from '~~/server/modules/graphics-author-session';

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

	try {
		await ensureGraphicsAuthorSession(event);
	}
	catch {
		console.warn(JSON.stringify({
			message: 'graphics_author_session_issue_failed',
			path: requestUrl.pathname,
		}));
	}
});
