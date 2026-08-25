import type { H3Event } from 'h3';
import type { DbScreen } from '~~/server/db/schema';
import { screenOutputAssetCapabilityDigest } from '~~/server/modules/screen-output-assets/capability';
import { optionalUserSession } from '~~/server/utils/auth';
import { bearerScreenOutputCapability } from '~~/server/utils/screenOutputCapabilityAuthorization';
import { secretTokensMatch } from '~~/server/utils/secretTokenComparison';

/**
 * Whether this request may read data published exclusively by one Screen.
 *
 * An unattended Screen Output presents the capability stored against that Screen;
 * an operator embed presents its Better Auth session. Capability succeeds without
 * consulting session state because outputs deliberately have no session of their
 * own. Callers retain their own one-sentence 404 so every resource on the capability
 * surface stays non-enumerating.
 */
export async function canReadScreenOutput(
	event: H3Event,
	screen: Pick<DbScreen, 'assetCapabilityDigest'>,
): Promise<boolean> {
	const capability = bearerScreenOutputCapability(getRequestHeader(event, 'authorization'));
	if (capability) {
		const presentedDigest = await screenOutputAssetCapabilityDigest(capability);
		if (await secretTokensMatch(presentedDigest, screen.assetCapabilityDigest))
			return true;
	}

	return !!(await optionalUserSession(event));
}
