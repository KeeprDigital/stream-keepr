import { toWebRequest } from 'h3';
import { serverAuth } from '~~/server/utils/auth';

/**
 * Mounts Better Auth's own router at `/api/auth/**` (#393). Every auth
 * operation — sign-in, sign-out, session reads, the admin plugin's user
 * management — is a sub-route of this handler; nothing else owns a path under
 * `/api/auth/`.
 */
export default defineEventHandler((event) => {
	return serverAuth().handler(toWebRequest(event));
});
