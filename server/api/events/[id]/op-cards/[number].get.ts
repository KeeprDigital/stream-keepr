import type { OpCardLookupAnswer } from '~~/shared/types/card/op';
import { opCardParamsSchema } from '~~/server/schemas/api/opCard';
import { bandaiKeeprConfig, lookupOpCard } from '~~/server/utils/bandaiKeepr';
import { requireOpEvent } from '~~/server/utils/routeGuards';

/**
 * A One Piece Card by card number, with every Printing, through bandai-keepr
 * (cached briefly). `card` is `null` for a number bandai-keepr does not know;
 * `available: false` when bandai-keepr is not configured.
 */
export default defineEventHandler(async (event): Promise<OpCardLookupAnswer> => {
	const { id, number } = await getValidatedRouterParams(event, opCardParamsSchema.parse);
	await requireOpEvent(id);

	const config = bandaiKeeprConfig();
	if (!config)
		return { available: false };
	return { available: true, card: await lookupOpCard(config, number) };
});
