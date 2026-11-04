import { tcgPlusImportModule } from '~~/server/modules/tcgplus-import';
import { eventParamsSchema } from '~~/server/schemas/api/event';
import { tcgPlusImportSchema } from '~~/server/schemas/api/tcgPlusImport';

/** Imports a TCG+ export's Players and Deck Lists. A failed card lookup saves nothing. */
export default defineEventHandler(async (event) => {
	const { id } = await getValidatedRouterParams(event, eventParamsSchema.parse);
	const { csv } = await readValidatedBody(event, tcgPlusImportSchema.parse);

	return await tcgPlusImportModule().commit({ eventId: id, csv });
});
