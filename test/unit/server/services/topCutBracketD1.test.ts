import type { MiniflareD1Harness } from '~~/test/helpers/miniflare-d1';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { createMiniflareD1Harness } from '~~/test/helpers/miniflare-d1';

// The Top Cut Bracket read on a real D1 binding, which refuses a statement past
// its hundredth bound parameter: a Phase may seat more Players than that.

const harness: MiniflareD1Harness = await createMiniflareD1Harness();
const db = drizzle(harness.database, { schema });

vi.doMock('~~/server/db', () => ({ db }));

const { findPhaseBracket } = await import('~~/server/services/topCutBracket');

afterAll(async () => await harness.dispose());

describe('findPhaseBracket', () => {
	it('names the deck of each of more than a hundred seated Players', async () => {
		const [event] = await db.insert(schema.events)
			.values({ name: 'Event', game: 'mtg', featureMatchOrientation: 'horizontal' })
			.returning({ id: schema.events.id });
		const eventId = event!.id;
		const [phase] = await db.insert(schema.phases)
			.values({ eventId, name: 'Top 128', sortOrder: 0 })
			.returning({ id: schema.phases.id });
		const [round] = await db.insert(schema.rounds)
			.values({
				eventId,
				phaseId: phase!.id,
				name: 'Round of 128',
				roundNumber: 1,
			})
			.returning({ id: schema.rounds.id });
		const playerIds: number[] = [];
		for (let start = 0; start < 128; start += 16) {
			const rows = await db.insert(schema.players)
				.values(Array.from({ length: 16 }, (_, index) => ({
					eventId,
					name: `Player ${start + index}`,
					gameData: { type: 'mtg' as const, deckName: `Deck ${start + index}`, deckColors: 'U' },
				})))
				.returning({ id: schema.players.id });
			playerIds.push(...rows.map(row => row.id));
		}
		for (let start = 0; start < 64; start += 8) {
			await db.insert(schema.matches).values(Array.from({ length: 8 }, (_, index) => ({
				eventId,
				roundId: round!.id,
				tableNumber: start + index + 1,
				player1Id: playerIds[(start + index) * 2]!,
				player2Id: playerIds[(start + index) * 2 + 1]!,
			})));
		}

		const { bracket } = await findPhaseBracket(eventId, phase!.id, { showArchetypes: true });

		expect(bracket.columns[0]!.positions.flatMap(position => position.entrants.map(entrant => entrant?.deck?.name)))
			.toEqual(Array.from({ length: 128 }, (_, index) => `Deck ${index}`));
	});
});
