import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

/**
 * Melee Sync keeps a Player field an operator edited (ADR-0046).
 *
 * Melee writes a Player's name and pronouns on every Players and Deck List
 * sync, blanking pronouns Melee does not hold. A name or pronouns an operator
 * set by hand, on the Players page or in a Slot's setup, holds instead.
 */

vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) =>
	Object.assign(new Error(input.message ?? 'error'), input));

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

vi.doMock('~~/server/db', () => ({ db }));
vi.doMock('~~/server/utils/ably', () => ({
	publishMessage: async () => {},
	publishMessageStrict: async () => {},
	publishScreenCommand: async () => {},
	getOriginConnectionId: () => undefined,
}));
vi.doMock('~~/server/modules/broadcast-graphics-live-session', async importOriginal => ({
	...await importOriginal<object>(),
	refreshBroadcastGraphicsBindings: async () => {},
}));

const { playerService } = await import('~~/server/services/player');
const { playerUpdateModule } = await import('~~/server/modules/player-update');
const { featureMatchService } = await import('~~/server/services/featureMatch');
const { featureMatchSlotWriteModule } = await import('~~/server/modules/feature-match-slot-write');

afterAll(async () => {
	await harness.close();
});

async function stageMeleePlayers() {
	const [event] = await db.insert(schema.events)
		.values({ name: 'Manual edits', game: 'mtg', featureMatchOrientation: 'horizontal' })
		.returning();
	const eventId = event!.id;
	const { players } = await playerService().reconcileMeleeSnapshot(eventId, [
		{
			externalId: 'mia',
			externalStatus: 1,
			name: 'Mia',
			pronouns: null,
		},
		{
			externalId: 'rei',
			externalStatus: 1,
			name: 'Rei',
			pronouns: 'he/him',
		},
	]);
	const byExternalId = new Map(players.map(player => [player.externalId, player.id]));
	return {
		eventId,
		miaId: byExternalId.get('mia')!,
		reiId: byExternalId.get('rei')!,
	};
}

/** What a Players sync sends: Melee's name and pronouns, which are blank for Mia. */
async function resyncPlayers(eventId: number) {
	await playerService().reconcileMeleeSnapshot(eventId, [
		{
			externalId: 'mia',
			externalStatus: 1,
			name: 'Mia Melee',
			pronouns: null,
		},
		{
			externalId: 'rei',
			externalStatus: 1,
			name: 'Rei Melee',
			pronouns: 'they/them',
		},
	]);
}

async function playerById(id: number) {
	return await db.query.players.findFirst({
		where: eq(schema.players.id, id),
	});
}

describe('melee Sync and a Player field an operator edited', () => {
	it('keeps a name and pronouns edited on the Players page through a Players sync', async () => {
		const { eventId, miaId, reiId } = await stageMeleePlayers();

		await playerUpdateModule().updatePlayer({
			eventId,
			playerId: miaId,
			input: { name: 'Mia K.', pronouns: 'she/her', lgs: 'Northgate Games' },
		});
		await resyncPlayers(eventId);

		expect(await playerById(miaId)).toMatchObject({ name: 'Mia K.', pronouns: 'she/her', lgs: 'Northgate Games' });
		// Rei was never edited, so Melee still owns both fields.
		expect(await playerById(reiId)).toMatchObject({ name: 'Rei Melee', pronouns: 'they/them' });
	});

	it('keeps pronouns an operator cleared, rather than taking Melee\'s', async () => {
		const { eventId, reiId } = await stageMeleePlayers();

		await playerUpdateModule().updatePlayer({
			eventId,
			playerId: reiId,
			input: { pronouns: null },
		});
		await resyncPlayers(eventId);

		expect(await playerById(reiId)).toMatchObject({ name: 'Rei Melee', pronouns: null });
	});

	it('computes the edited fields itself, ignoring any a client sends', async () => {
		const { eventId, reiId } = await stageMeleePlayers();

		await playerService().update(reiId, eventId, {
			name: 'Rei K.',
			manuallyEditedFields: ['pronouns'],
		} as never);
		await resyncPlayers(eventId);

		expect(await playerById(reiId)).toMatchObject({ name: 'Rei K.', pronouns: 'they/them' });
	});

	it('marks only the fields a write changed', async () => {
		const { eventId, miaId } = await stageMeleePlayers();

		// The Players page sends its whole form: an unchanged name is not an edit.
		await playerUpdateModule().updatePlayer({
			eventId,
			playerId: miaId,
			input: { name: 'Mia', pronouns: 'she/her' },
		});
		await resyncPlayers(eventId);

		expect(await playerById(miaId)).toMatchObject({ name: 'Mia Melee', pronouns: 'she/her' });
	});

	it('keeps an edit made in a Slot\'s setup through a Deck List sync', async () => {
		const { eventId, miaId } = await stageMeleePlayers();
		const slot = await featureMatchService().create(eventId, { player1Id: miaId });
		const seated = await featureMatchService().findById(slot.id, eventId);

		await featureMatchSlotWriteModule().updateSetup({
			eventId,
			slotId: slot.id,
			input: {
				player1Data: { ...seated!.player1Data, name: 'Mia K.', pronouns: 'she/her' },
			},
		});
		await playerService().batchUpsertByExternalId([
			{
				eventId,
				externalId: 'mia',
				externalSource: 'melee',
				name: 'Mia Melee',
				pronouns: null,
			},
		]);

		expect(await playerById(miaId)).toMatchObject({ name: 'Mia K.', pronouns: 'she/her' });
	});
});
