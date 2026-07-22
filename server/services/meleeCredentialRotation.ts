import { and, eq } from 'drizzle-orm';
import { db } from 'hub:db';
import { events } from '~~/server/db/schema';
import { protectMeleeClientSecret } from '~~/server/services/meleeCredentials';

/**
 * Opportunistically migrate a credential after a successful read. The
 * expected-value predicate makes this safe when configuration changes race a
 * sync command: a newer secret is never overwritten by the re-wrap.
 */
export async function rewrapMeleeClientSecret(
	eventId: number,
	expectedStoredValue: string,
	plaintext: string,
): Promise<boolean> {
	const protectedValue = await protectMeleeClientSecret(plaintext);
	const updated = await db
		.update(events)
		.set({ meleeClientSecret: protectedValue, updatedAt: new Date() })
		.where(and(
			eq(events.id, eventId),
			eq(events.meleeClientSecret, expectedStoredValue),
		))
		.returning({ id: events.id });

	return updated.length > 0;
}
