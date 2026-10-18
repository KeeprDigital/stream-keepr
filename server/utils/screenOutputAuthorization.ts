import type { H3Event } from 'h3';
import type { DbScreen } from '~~/server/db/schema';
import { screenOutputAssetCapabilityDigest } from '~~/server/modules/screen-output-assets/capability';
import { optionalUserSession } from '~~/server/utils/auth';
import { bearerScreenOutputCapability } from '~~/server/utils/screenOutputCapabilityAuthorization';
import { secretTokensMatch } from '~~/server/utils/secretTokenComparison';

/** Which credential admitted a Screen Output read. */
export type ScreenOutputReader = 'capability' | 'session';

/**
 * Who this request reads one Screen's published data as, or `null` if it may not.
 *
 * An unattended Screen Output presents the capability stored against that Screen;
 * an operator embed presents its Better Auth session. Capability succeeds without
 * consulting session state because outputs deliberately have no session of their
 * own. Callers retain their own one-sentence 404 so every resource on the capability
 * surface stays non-enumerating.
 *
 * Which arm admitted matters only to a read whose client names the resource: a
 * capability reaches only what the Screen's saved configuration publishes, while a
 * session — which can read the whole Event privately anyway — also reaches what an
 * editor preview has not saved yet.
 */
export async function screenOutputReader(
	event: H3Event,
	screen: Pick<DbScreen, 'assetCapabilityDigest'>,
): Promise<ScreenOutputReader | null> {
	const capability = bearerScreenOutputCapability(getRequestHeader(event, 'authorization'));
	if (capability) {
		const presentedDigest = await screenOutputAssetCapabilityDigest(capability);
		if (await secretTokensMatch(presentedDigest, screen.assetCapabilityDigest))
			return 'capability';
	}

	return (await optionalUserSession(event)) ? 'session' : null;
}

/** Whether this request may read data published exclusively by one Screen. */
export async function canReadScreenOutput(
	event: H3Event,
	screen: Pick<DbScreen, 'assetCapabilityDigest'>,
): Promise<boolean> {
	return (await screenOutputReader(event, screen)) !== null;
}
