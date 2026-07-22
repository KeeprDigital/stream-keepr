import { describe, expect, it } from 'vitest';
import {
	createPlayerSchema,
	playerParamsSchema,
	playerQuerySchema,
	updatePlayerSchema,
} from '~~/server/schemas/api/player';

// ──────────────── createPlayerSchema ────────────────

describe('createPlayerSchema', () => {
	const validInput = { name: 'Reid Duke' };

	it('accepts valid input with name only', () => {
		const result = createPlayerSchema.safeParse(validInput);
		expect(result.success).toBe(true);
	});

	it('accepts valid input with all optional fields', () => {
		const result = createPlayerSchema.safeParse({
			...validInput,
			pronouns: 'he/him',
			lgs: 'Card Kingdom',
			wins: 5,
			losses: 2,
			draws: 1,
			position: 3,
			points: 16,
			archetypeId: 1,
			gameData: { type: 'mtg', deckName: 'Izzet Phoenix', deckColors: 'UR' },
		});
		expect(result.success).toBe(true);
	});

	// Required field: name

	// name bounds
	it('accepts name of exactly 200 characters', () => {
		const result = createPlayerSchema.safeParse({ name: 'a'.repeat(200) });
		expect(result.success).toBe(true);
	});

	// pronouns bounds
	it('accepts pronouns of exactly 50 characters', () => {
		const result = createPlayerSchema.safeParse({ ...validInput, pronouns: 'a'.repeat(50) });
		expect(result.success).toBe(true);
	});

	it('accepts null pronouns', () => {
		const result = createPlayerSchema.safeParse({ ...validInput, pronouns: null });
		expect(result.success).toBe(true);
	});

	// archetypeId
	it('accepts null archetypeId', () => {
		const result = createPlayerSchema.safeParse({ ...validInput, archetypeId: null });
		expect(result.success).toBe(true);
	});

	it('accepts positive archetypeId', () => {
		const result = createPlayerSchema.safeParse({ ...validInput, archetypeId: 5 });
		expect(result.success).toBe(true);
	});

	// lgs bounds
	it('accepts lgs of exactly 200 characters', () => {
		const result = createPlayerSchema.safeParse({ ...validInput, lgs: 'a'.repeat(200) });
		expect(result.success).toBe(true);
	});

	// Melee identity is server-managed and never accepted on manual create
	it('rejects externalId (unknown key on a strict schema)', () => {
		const result = createPlayerSchema.safeParse({ ...validInput, externalId: 'a'.repeat(100) });
		expect(result.success).toBe(false);
	});

	it('rejects externalSource (unknown key on a strict schema)', () => {
		const result = createPlayerSchema.safeParse({ ...validInput, externalSource: 'melee' });
		expect(result.success).toBe(false);
	});

	// wins: nonnegative integer
	it('accepts wins of 0', () => {
		const result = createPlayerSchema.safeParse({ ...validInput, wins: 0 });
		expect(result.success).toBe(true);
	});

	it('accepts null wins', () => {
		const result = createPlayerSchema.safeParse({ ...validInput, wins: null });
		expect(result.success).toBe(true);
	});

	// losses: nonnegative integer
	it('accepts losses of 0', () => {
		const result = createPlayerSchema.safeParse({ ...validInput, losses: 0 });
		expect(result.success).toBe(true);
	});

	// draws: nonnegative integer
	it('accepts draws of 0', () => {
		const result = createPlayerSchema.safeParse({ ...validInput, draws: 0 });
		expect(result.success).toBe(true);
	});

	// position: positive integer
	it('accepts position of 1', () => {
		const result = createPlayerSchema.safeParse({ ...validInput, position: 1 });
		expect(result.success).toBe(true);
	});

	// points: nonnegative integer
	it('accepts points of 0', () => {
		const result = createPlayerSchema.safeParse({ ...validInput, points: 0 });
		expect(result.success).toBe(true);
	});

	// gameData discriminated union: mtg
	it('accepts mtg gameData with all fields', () => {
		const result = createPlayerSchema.safeParse({
			...validInput,
			gameData: { type: 'mtg', deckName: 'Burn', deckColors: 'R' },
		});
		expect(result.success).toBe(true);
	});

	it('accepts mtg gameData with minimal fields', () => {
		const result = createPlayerSchema.safeParse({
			...validInput,
			gameData: { type: 'mtg' },
		});
		expect(result.success).toBe(true);
	});

	// gameData discriminated union: op
	it('accepts op gameData with all fields', () => {
		const result = createPlayerSchema.safeParse({
			...validInput,
			gameData: { type: 'op', leader: 'Luffy' },
		});
		expect(result.success).toBe(true);
	});

	it('accepts op gameData with minimal fields', () => {
		const result = createPlayerSchema.safeParse({
			...validInput,
			gameData: { type: 'op' },
		});
		expect(result.success).toBe(true);
	});

	// gameData: invalid type discriminator

	it('accepts null gameData', () => {
		const result = createPlayerSchema.safeParse({ ...validInput, gameData: null });
		expect(result.success).toBe(true);
	});

	// Omitted fields should be stripped from output
});

// ──────────────── updatePlayerSchema ────────────────

describe('updatePlayerSchema', () => {
	it('accepts empty object (all fields optional)', () => {
		const result = updatePlayerSchema.safeParse({});
		expect(result.success).toBe(true);
	});

	it('accepts partial update with name only', () => {
		const result = updatePlayerSchema.safeParse({ name: 'Updated Name' });
		expect(result.success).toBe(true);
	});

	it('accepts partial update with numeric fields', () => {
		const result = updatePlayerSchema.safeParse({ wins: 10, losses: 3, draws: 2 });
		expect(result.success).toBe(true);
	});

	it('accepts partial update with gameData', () => {
		const result = updatePlayerSchema.safeParse({
			gameData: { type: 'mtg', deckName: 'Control' },
		});
		expect(result.success).toBe(true);
	});

	// Melee identity is server-managed and never accepted on manual update
	it('rejects externalId (unknown key on a strict schema)', () => {
		const result = updatePlayerSchema.safeParse({ name: 'Updated Name', externalId: 'forged-id' });
		expect(result.success).toBe(false);
	});

	it('rejects externalSource (unknown key on a strict schema)', () => {
		const result = updatePlayerSchema.safeParse({ name: 'Updated Name', externalSource: 'melee' });
		expect(result.success).toBe(false);
	});

	it('rejects legacy player-level deck review state', () => {
		const result = updatePlayerSchema.safeParse({
			gameData: { type: 'mtg', deckName: 'Control', deckReviewed: true },
		});
		expect(result.success).toBe(false);
	});
});

// ──────────────── playerParamsSchema ────────────────

describe('playerParamsSchema', () => {
	it('coerces string id and playerId to numbers', () => {
		const result = playerParamsSchema.safeParse({ id: '1', playerId: '5' });
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.id).toBe(1);
			expect(result.data.playerId).toBe(5);
		}
	});

	it('accepts numeric id and playerId', () => {
		const result = playerParamsSchema.safeParse({ id: 10, playerId: 20 });
		expect(result.success).toBe(true);
	});
});

// ──────────────── playerQuerySchema ────────────────

describe('playerQuerySchema', () => {
	it('accepts undefined (whole schema is optional)', () => {
		const result = playerQuerySchema.safeParse(undefined);
		expect(result.success).toBe(true);
	});

	it('accepts empty object (listId is optional)', () => {
		const result = playerQuerySchema.safeParse({});
		expect(result.success).toBe(true);
	});

	it('accepts valid listId', () => {
		const result = playerQuerySchema.safeParse({ listId: '5' });
		expect(result.success).toBe(true);
		if (result.success && result.data) {
			expect(result.data.listId).toBe(5);
		}
	});

	it('coerces string listId to number', () => {
		const result = playerQuerySchema.safeParse({ listId: '42' });
		expect(result.success).toBe(true);
		if (result.success && result.data) {
			expect(result.data.listId).toBe(42);
		}
	});
});
