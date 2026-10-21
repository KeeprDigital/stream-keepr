/**
 * How an acceptance Chrome is recognised once nothing is left to ask (#687).
 *
 * A Chrome whose runner died is an orphan with nobody to close it. `pnpm reap`
 * finds it by the one thing it carries that a person's own browser never does:
 * its `--user-data-dir`, a temporary profile named after the checkout that
 * launched it. Imports only `node:crypto` and `node:fs`, so the reaper can
 * read it without loading the acceptance harness.
 */

import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';

const PROFILE_PREFIX = 'stream-keepr-acceptance-';

/**
 * A short, stable name for a checkout: its real path, hashed, so a path with
 * spaces or symlinks still names it one way. Ten hex characters keeps the
 * profile name short and the chance of two checkouts colliding negligible.
 */
export function checkoutProfileMarker(checkoutRoot) {
	let root = checkoutRoot;
	try {
		root = realpathSync(checkoutRoot);
	}
	catch {
		// A root that no longer exists is still named by the path it was given.
	}
	return createHash('sha256').update(root).digest('hex').slice(0, 10);
}

/** The basename prefix of every profile directory a checkout's acceptance Chrome uses. */
export function acceptanceProfilePrefix(marker) {
	return `${PROFILE_PREFIX}${marker}-`;
}
