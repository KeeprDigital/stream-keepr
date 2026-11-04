import { tcgPlusImportModule } from '~~/server/modules/tcgplus-import';
import { eventParamsSchema } from '~~/server/schemas/api/event';
import { tcgPlusImportSchema } from '~~/server/schemas/api/tcgPlusImport';

/** What importing a TCG+ export would change, and its warnings. Saves no Player or Deck List. */
export default defineEventHandler(async (event) => {
	const { id } = await getValidatedRouterParams(event, eventParamsSchema.parse);
	const { csv } = await readValidatedBody(event, tcgPlusImportSchema.parse);

	return await tcgPlusImportModule().preview({ eventId: id, csv });
});
