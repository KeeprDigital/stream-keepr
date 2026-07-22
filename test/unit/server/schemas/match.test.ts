import { describe, expect, it } from 'vitest';
import {
	createMatchSchema,
	matchParamsSchema,
	matchQuerySchema,
	promoteMatchSchema,
	updateMatchSchema,
} from '~~/server/schemas/api/match';

// ──────────────── createMatchSchema ────────────────

describe('createMatchSchema', () => {
	const validInput = {
		roundId: 1,
	};

	it('accepts valid input with required fields only', () => {
		const result = createMatchSchema.safeParse(validInput);
		expect(result.success).toBe(true);
	});

	it('accepts manual fields', () => {
		const result = createMatchSchema.parse({
			...validInput,
			tableNumber: 5,
			player1Id: 10,
			player2Id: 20,
			player1Data: { name: 'Alice' },
			player2Data: { name: 'Bob' },
			sortOrder: 3,
		});
		expect(result).toMatchObject({ roundId: 1, tableNumber: 5 });
	});

	it('rejects integration-owned provenance (unknown keys on a strict schema)', () => {
		const result = createMatchSchema.safeParse({
			...validInput,
			externalId: 'ext-match-1',
			externalSource: 'melee',
		});
		expect(result.success).toBe(false);
	});

	// Required fields

	// roundId constraints

	it('accepts roundId of 1', () => {
		const result = createMatchSchema.safeParse({ ...validInput, roundId: 1 });
		expect(result.success).toBe(true);
	});

	// tableNumber constraints
	it('accepts positive tableNumber', () => {
		const result = createMatchSchema.safeParse({ ...validInput, tableNumber: 1 });
		expect(result.success).toBe(true);
	});

	it('accepts null tableNumber', () => {
		const result = createMatchSchema.safeParse({ ...validInput, tableNumber: null });
		expect(result.success).toBe(true);
	});

	// player1Id constraints
	it('accepts positive player1Id', () => {
		const result = createMatchSchema.safeParse({ ...validInput, player1Id: 42 });
		expect(result.success).toBe(true);
	});

	it('accepts null player1Id', () => {
		const result = createMatchSchema.safeParse({ ...validInput, player1Id: null });
		expect(result.success).toBe(true);
	});

	// player2Id constraints
	it('accepts positive player2Id', () => {
		const result = createMatchSchema.safeParse({ ...validInput, player2Id: 99 });
		expect(result.success).toBe(true);
	});

	it('accepts null player2Id', () => {
		const result = createMatchSchema.safeParse({ ...validInput, player2Id: null });
		expect(result.success).toBe(true);
	});

	// player1Data / player2Data constraints
	it('accepts valid player1Data object', () => {
		const result = createMatchSchema.safeParse({
			...validInput,
			player1Data: { name: 'Alice', pronouns: 'she/her', wins: 3, losses: 1 },
		});
		expect(result.success).toBe(true);
	});

	it('accepts null player1Data', () => {
		const result = createMatchSchema.safeParse({ ...validInput, player1Data: null });
		expect(result.success).toBe(true);
	});

	it('accepts null player2Data', () => {
		const result = createMatchSchema.safeParse({ ...validInput, player2Data: null });
		expect(result.success).toBe(true);
	});

	it('accepts player1Data with archetypeId', () => {
		const result = createMatchSchema.safeParse({
			...validInput,
			player1Data: { name: 'Alice', archetypeId: 5 },
			player2Data: { name: 'Bob', archetypeId: null },
		});
		expect(result.success).toBe(true);
	});

	it('accepts the stable submitted deck identity in player data', () => {
		const result = createMatchSchema.safeParse({
			...validInput,
			player1Data: { name: 'Alice', deckId: 77 },
		});
		expect(result.success).toBe(true);
	});

	it('rejects forged provenance inside manual player snapshots', () => {
		const result = createMatchSchema.safeParse({
			...validInput,
			player1Data: { name: 'Alice', externalId: 'forged', externalSource: 'melee' },
		});
		expect(result.success).toBe(false);
	});

	// Stripped fields
});

// ──────────────── updateMatchSchema ────────────────

describe('updateMatchSchema', () => {
	it('accepts empty object (all fields optional)', () => {
		const result = updateMatchSchema.safeParse({});
		expect(result.success).toBe(true);
	});

	it('accepts partial update with roundId only', () => {
		const result = updateMatchSchema.safeParse({ roundId: 2 });
		expect(result.success).toBe(true);
	});

	it('accepts partial update with tableNumber', () => {
		const result = updateMatchSchema.safeParse({ tableNumber: 10 });
		expect(result.success).toBe(true);
	});

	it('accepts partial update with player ids', () => {
		const result = updateMatchSchema.safeParse({ player1Id: 5, player2Id: 6 });
		expect(result.success).toBe(true);
	});

	// Same constraints as create

	it('rejects integration-owned provenance from updates (unknown keys on a strict schema)', () => {
		const result = updateMatchSchema.safeParse({ externalId: 'forged', externalSource: 'melee', tableNumber: 2 });
		expect(result.success).toBe(false);
	});

	it('accepts null tableNumber', () => {
		const result = updateMatchSchema.safeParse({ tableNumber: null });
		expect(result.success).toBe(true);
	});

	it('accepts null player1Id', () => {
		const result = updateMatchSchema.safeParse({ player1Id: null });
		expect(result.success).toBe(true);
	});

	it('accepts null player2Id', () => {
		const result = updateMatchSchema.safeParse({ player2Id: null });
		expect(result.success).toBe(true);
	});

	it('accepts null player1Data', () => {
		const result = updateMatchSchema.safeParse({ player1Data: null });
		expect(result.success).toBe(true);
	});

	it('accepts null player2Data', () => {
		const result = updateMatchSchema.safeParse({ player2Data: null });
		expect(result.success).toBe(true);
	});
});

// ──────────────── matchParamsSchema ────────────────

describe('matchParamsSchema', () => {
	it('coerces string id and matchId to numbers', () => {
		const result = matchParamsSchema.safeParse({ id: '1', matchId: '2' });
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.id).toBe(1);
			expect(result.data.matchId).toBe(2);
		}
	});

	it('accepts numeric id and matchId', () => {
		const result = matchParamsSchema.safeParse({ id: 42, matchId: 99 });
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.id).toBe(42);
			expect(result.data.matchId).toBe(99);
		}
	});
});

// ──────────────── matchQuerySchema ────────────────

describe('matchQuerySchema', () => {
	it('accepts empty object (roundId is optional)', () => {
		const result = matchQuerySchema.safeParse({});
		expect(result.success).toBe(true);
	});

	it('coerces string roundId to number', () => {
		const result = matchQuerySchema.safeParse({ roundId: '5' });
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.roundId).toBe(5);
		}
	});

	it('accepts numeric roundId', () => {
		const result = matchQuerySchema.safeParse({ roundId: 10 });
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.roundId).toBe(10);
		}
	});
});

// ──────────────── promoteMatchSchema ────────────────

describe('promoteMatchSchema', () => {
	it('accepts valid positive matchId', () => {
		const result = promoteMatchSchema.safeParse({ matchId: 1 });
		expect(result.success).toBe(true);
	});

	it('accepts large matchId', () => {
		const result = promoteMatchSchema.safeParse({ matchId: 9999 });
		expect(result.success).toBe(true);
	});
});
