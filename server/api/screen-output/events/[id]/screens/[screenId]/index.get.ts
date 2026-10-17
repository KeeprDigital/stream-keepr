import { mapScreenToResponse } from '~~/server/mappers/screen';
import { requireScreenOutputRead } from '~~/server/utils/screenOutputRead';

/**
 * The Screen itself, by id, for a rendering re-reading it after `screen:updated`
 * (#604). By id rather than by slug, because a slug can be renamed under an
 * output that is already on program.
 */
export default defineEventHandler(async (event) => {
	const { screen } = await requireScreenOutputRead(event);
	return mapScreenToResponse(screen);
});
