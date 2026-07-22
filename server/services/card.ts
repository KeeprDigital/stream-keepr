import type { CardInput, StoredCardData } from '~~/server/schemas/kv/card';
import { and, eq, sql } from 'drizzle-orm';
import { db } from 'hub:db';
import { kv } from 'hub:kv';
import { screens } from '~~/server/db/schema';
import { storedCardSchema } from '~~/server/schemas/kv/card';

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

	const setScreenCard = async (
		eventId: number,
		screenId: number,
		cardData: CardInput,
		originConnectionId?: string,
	): Promise<void> => {
		const data: StoredCardData = {
			...cardData,
			savedAt: Date.now(),
		};

		const validated = storedCardSchema.parse(data);
		await writeAuthoritativeCard(eventId, screenId, validated);
		await bestEffort(eventId, screenId, 'kv_set', async () => await kv.set(getScreenCardKey(eventId, screenId), validated));

		// Set up Ably-based timeout if card has timeout data
		if (cardData.timeoutData) {
			const { timeoutDuration } = cardData.timeoutData;
			const { cardTimeoutService } = await import('./cardTimeout');
			const timeoutService = cardTimeoutService();

			// Calculate remaining time based on when the timeout was started
			const elapsedMs = Date.now() - cardData.timeoutData.timeoutStartTimestamp;
			const remainingMs = Math.max(0, timeoutDuration - elapsedMs);

			if (remainingMs > 0) {
				await timeoutService.setCardTimeout(eventId, remainingMs, screenId, originConnectionId);
			}
		}
	};

	const getScreenCard = async (eventId: number, screenId: number): Promise<StoredCardData | null> => {
		const screen = await db.query.screens.findFirst({
			where: and(eq(screens.id, screenId), eq(screens.eventId, eventId)),
			columns: { activeCard: true, activeCardVersion: true },
		});
		if (!screen?.activeCard)
			return null;

		const parsed = storedCardSchema.safeParse(screen.activeCard);
		if (!parsed.success)
			return null;

		const timeout = parsed.data.timeoutData;
		if (timeout && timeout.timeoutStartTimestamp + timeout.timeoutDuration <= Date.now()) {
			// Expiry is a state transition, not just a response projection. Clear the
			// durable value with a version guard so a concurrent replacement cannot
			// be erased by this stale read.
			const cleared = await db
				.update(screens)
				.set({
					activeCard: null,
					activeCardVersion: sql`${screens.activeCardVersion} + 1`,
					updatedAt: new Date(),
				})
				.where(and(
					eq(screens.id, screenId),
					eq(screens.eventId, eventId),
					eq(screens.activeCardVersion, screen.activeCardVersion),
				))
				.returning({ id: screens.id });

			if (cleared.length > 0) {
				await bestEffort(
					eventId,
					screenId,
					'kv_expired_delete',
					async () => await kv.del(getScreenCardKey(eventId, screenId)),
				);
			}
			return null;
		}

		return parsed.data;
	};

	const deleteScreenCard = async (eventId: number, screenId: number, originConnectionId?: string): Promise<void> => {
		await writeAuthoritativeCard(eventId, screenId, null);

		// Clear any active timeout for this screen
		const { cardTimeoutService } = await import('./cardTimeout');
		const timeoutService = cardTimeoutService();
		await bestEffort(eventId, screenId, 'timeout_clear', async () => await timeoutService.clearCardTimeout(eventId, screenId, originConnectionId));

		await bestEffort(eventId, screenId, 'kv_delete', async () => await kv.del(getScreenCardKey(eventId, screenId)));
	};

	/** Clean derived artifacts after a Screen/Event row has already been deleted. */
	const cleanupDeletedScreenCard = async (eventId: number, screenId: number, originConnectionId?: string): Promise<void> => {
		const { cardTimeoutService } = await import('./cardTimeout');
		const timeoutService = cardTimeoutService();
		await Promise.all([
			bestEffort(eventId, screenId, 'timeout_cleanup', async () => await timeoutService.clearCardTimeout(eventId, screenId, originConnectionId)),
			bestEffort(eventId, screenId, 'kv_cleanup', async () => await kv.del(getScreenCardKey(eventId, screenId))),
		]);
	};

	return {
		setScreenCard,
		getScreenCard,
		deleteScreenCard,
		cleanupDeletedScreenCard,
	};
}
