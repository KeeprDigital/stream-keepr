import type { CardInput, StoredCardData } from '~~/server/schemas/kv/card';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '~~/server/db';
import { screens } from '~~/server/db/schema';
import { storedCardSchema } from '~~/server/schemas/kv/card';

/**
 * Where a Card Screen's derived copy of its card lives: the KV binding Nitro
 * mounts at `kv` (`nuxt.config.ts`). Resolved per call, because storage is a
 * Nitro runtime global.
 */
const kvStorage = () => useStorage('kv');

export function cardService() {
	const getScreenCardKey = (eventId: number, screenId: number) => `event:${eventId}:screen:${screenId}:card`;
	const logArtifactFailure = (eventId: number, screenId: number, operation: string) => {
		console.warn(JSON.stringify({
			message: 'screen_card_artifact_failed',
			eventId,
			screenId,
			operation,
		}));
	};
	const bestEffort = async (
		eventId: number,
		screenId: number,
		operation: string,
		action: () => Promise<unknown>,
	) => {
		try {
			await action();
		}
		catch {
			logArtifactFailure(eventId, screenId, operation);
		}
	};
	const writeAuthoritativeCard = async (eventId: number, screenId: number, card: StoredCardData | null) => {
		const updated = await db
			.update(screens)
			.set({
				activeCard: card,
				activeCardVersion: sql`${screens.activeCardVersion} + 1`,
				updatedAt: new Date(),
			})
			.where(and(eq(screens.id, screenId), eq(screens.eventId, eventId)))
			.returning({ id: screens.id });

		if (updated.length === 0)
			throw new Error('Screen not found');
	};

	const setScreenCard = async (eventId: number, screenId: number, cardData: CardInput): Promise<void> => {
		const data: StoredCardData = {
			...cardData,
			savedAt: Date.now(),
		};

		const validated = storedCardSchema.parse(data);
		await writeAuthoritativeCard(eventId, screenId, validated);
		await bestEffort(eventId, screenId, 'kv_set', async () => await kvStorage().set(getScreenCardKey(eventId, screenId), validated));
	};

	/**
	 * The Card a Screen shows now. A Card's expiry is a clock projection, not a
	 * state transition (ADR-0022): a timed Card past its Card Timeout answers
	 * `null`, and the stored Card, its revision and its KV copy stay as they are
	 * until the next save, Clear, or Screen or Event deletion. A read never writes.
	 */
	const getScreenCard = async (eventId: number, screenId: number): Promise<StoredCardData | null> => {
		const screen = await db.query.screens.findFirst({
			where: and(eq(screens.id, screenId), eq(screens.eventId, eventId)),
			columns: { activeCard: true },
		});
		if (!screen?.activeCard)
			return null;

		const parsed = storedCardSchema.safeParse(screen.activeCard);
		if (!parsed.success)
			return null;

		const timeout = parsed.data.timeoutData;
		if (timeout && timeout.timeoutStartTimestamp + timeout.timeoutDuration <= Date.now())
			return null;

		return parsed.data;
	};

	/** The operator's explicit Clear. Expiry never calls it (ADR-0022). */
	const deleteScreenCard = async (eventId: number, screenId: number): Promise<void> => {
		await writeAuthoritativeCard(eventId, screenId, null);
		await bestEffort(eventId, screenId, 'kv_delete', async () => await kvStorage().del(getScreenCardKey(eventId, screenId)));
	};

	/** Clean derived artifacts after a Screen/Event row has already been deleted. */
	const cleanupDeletedScreenCard = async (eventId: number, screenId: number): Promise<void> => {
		await bestEffort(eventId, screenId, 'kv_cleanup', async () => await kvStorage().del(getScreenCardKey(eventId, screenId)));
	};

	return {
		setScreenCard,
		getScreenCard,
		deleteScreenCard,
		cleanupDeletedScreenCard,
	};
}
