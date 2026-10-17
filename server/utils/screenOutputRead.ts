import type { H3Event } from 'h3';
import type { DbScreen } from '~~/server/db/schema';
import type { ScreenOutputReader } from '~~/server/utils/screenOutputAuthorization';
import type { ScreenMode } from '~~/shared/types/enums';
import type { ModeConfigTypeMap } from '~~/shared/types/screenConfig';
import { z } from 'zod';
import { featureMatchService } from '~~/server/services/featureMatch';
import { screenService } from '~~/server/services/screen';
import { screenOutputReader } from '~~/server/utils/screenOutputAuthorization';
import { resolveScreenModeConfig } from '~~/shared/types/screenConfig';

const screenOutputReadParamsSchema = z.object({
	id: z.coerce.number().int().positive(),
	screenId: z.coerce.number().int().positive(),
});

/**
 * The one refusal every Screen Output read has (#604).
 *
 * A missing Screen, a capability for another Screen, a rotated one, no
 * credential, and a resource the Screen does not publish are all this sentence,
 * so the capability surface cannot be used to learn what exists.
 */
export function screenOutputReadNotFound(): never {
	throw createError({
		statusCode: 404,
		statusMessage: 'Not Found',
		message: 'Not found',
	});
}

export interface ScreenOutputRead {
	eventId: number;
	screen: DbScreen;
	reader: ScreenOutputReader;
}

/**
 * Admit a read on `/api/screen-output/events/:id/screens/:screenId/**`.
 *
 * What a Screen Output may read is what its Screen publishes, so every read is
 * addressed through the Screen: its capability admits it, or an operator embed's
 * Session does (ADR-0010's dual credential). The route then derives the resource
 * from the Screen's saved configuration, or — for the two reads whose client
 * names it — checks the name against that configuration, so a capability cannot
 * browse its Event (ADR-0021).
 *
 * Answers are `private, no-store`: they are this Screen's current rendering and
 * must not outlive a rotation in some intermediary's cache.
 */
export async function requireScreenOutputRead(event: H3Event): Promise<ScreenOutputRead> {
	const { id: eventId, screenId } = await getValidatedRouterParams(event, screenOutputReadParamsSchema.parse);
	const screen = await screenService().findById(screenId, eventId);
	const reader = screen ? await screenOutputReader(event, screen) : null;
	if (!screen || !reader)
		screenOutputReadNotFound();

	setResponseHeader(event, 'cache-control', 'private, no-store');
	return { eventId, screen, reader };
}

/**
 * Admit a read of one mode's data, and resolve that mode's saved configuration.
 *
 * A Screen publishes the data of the mode it is in, not of every mode it holds
 * configuration for: a capability reaches a mode's read only while the Screen is
 * in that mode. A Session reaches it regardless, as it reaches the Event.
 */
export async function requireScreenOutputModeRead<M extends ScreenMode>(event: H3Event, mode: M) {
	const read = await requireScreenOutputRead(event);
	if (read.reader === 'capability' && read.screen.currentMode !== mode)
		screenOutputReadNotFound();

	return { ...read, config: screenOutputModeConfig(read.screen, mode) };
}

/** The saved configuration of one mode, completed with its defaults as an output renders it. */
export function screenOutputModeConfig<M extends ScreenMode>(screen: DbScreen, mode: M): ModeConfigTypeMap[M] {
	return resolveScreenModeConfig(screen.modeConfigs, mode);
}

/** The Feature Match Slot the Screen's current mode shows, if that mode shows one. */
export function screenOutputFeatureMatchSlotId(screen: DbScreen): number | null {
	if (screen.currentMode !== 'feature-match' && screen.currentMode !== 'feature-match-overlay')
		return null;
	return screenOutputModeConfig(screen, screen.currentMode).featureMatchId ?? null;
}

/**
 * Admit a read of one Feature Match Slot through a Screen.
 *
 * Its client names the Slot, because the Feature Match Overlay's editor preview
 * renders one its author has not saved yet. A capability still reaches only the
 * Slot its Screen's current mode shows.
 */
export async function requireScreenOutputFeatureMatchSlot(event: H3Event, slotId: number) {
	const read = await requireScreenOutputRead(event);
	if (read.reader === 'capability' && screenOutputFeatureMatchSlotId(read.screen) !== slotId)
		screenOutputReadNotFound();

	const slot = await featureMatchService().findById(slotId, read.eventId);
	if (!slot)
		screenOutputReadNotFound();

	return { ...read, slot };
}

/**
 * The Players whose records and decks a Screen's current mode renders: the Deck
 * mode's selected Player, or the two sides of the Feature Match Slot it shows.
 */
export async function screenOutputPublishedPlayerIds(screen: DbScreen, eventId: number): Promise<number[]> {
	if (screen.currentMode === 'deck') {
		const source = screenOutputModeConfig(screen, 'deck').deckSource;
		return source.type === 'player' && source.playerId !== null ? [source.playerId] : [];
	}

	const slotId = screenOutputFeatureMatchSlotId(screen);
	const slot = slotId ? await featureMatchService().findById(slotId, eventId) : undefined;
	return [slot?.player1Id, slot?.player2Id].filter((id): id is number => id != null);
}
