import { toWebRequest } from 'h3';
import { localAuthBypassIsActive, requestUserSession, serverAuth } from '~~/server/utils/auth';

/**
 * Mounts Better Auth's own router at `/api/auth/**` (#393). Every auth
 * operation — sign-in, sign-out, session reads, redeeming a Password Reset
 * Link — is a sub-route of this handler; nothing else owns a path under
 * `/api/auth/`. The admin plugin's routes are not among them: they answer 404
 * (`disabledPaths` in `server/utils/authOptions.ts`), and user administration
 * is `/api/admin/users/**`, behind the Graphics Administrator credential.
 */
export default defineEventHandler((event) => {
	// The app's client continues to ask Better Auth's ordinary session route. In
	// local bypass mode this one reading is synthetic; every other auth operation
	// remains Better Auth's, though the UI offers none of them in that mode.
	if (localAuthBypassIsActive(event) && getRequestURL(event).pathname === '/api/auth/get-session')
		return requestUserSession(event);

	return serverAuth().handler(toWebRequest(event));
});
