import type { OpCardSearchAnswer } from '~~/shared/types/card/op';
import { eventParamsSchema } from '~~/server/schemas/api/event';
import { opCardSearchQuerySchema } from '~~/server/schemas/api/opCard';
import { bandaiKeeprConfig, searchOpCards } from '~~/server/utils/bandaiKeepr';
import { requireOpEvent } from '~~/server/utils/routeGuards';

/**
 * Search One Piece cards for the Card Spotlight, through bandai-keepr. Never
 * cached: each search asks bandai-keepr. Without bandai-keepr configured it
 * answers `available: false`, which the operator sees as card data unavailable.
 */
export default defineEventHandler(async (event): Promise<OpCardSearchAnswer> => {
	const { id } = await getValidatedRouterParams(event, eventParamsSchema.parse);
	const query = await getValidatedQuery(event, opCardSearchQuerySchema.parse);
	await requireOpEvent(id);

	const config = bandaiKeeprConfig();
	if (!config)
		return { available: false };
	return {
		available: true,
		...await searchOpCards(config, query),
	};
});
