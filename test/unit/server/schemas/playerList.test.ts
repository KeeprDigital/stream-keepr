import { describe, expect, it } from 'vitest';
import {
	addMembersSchema,
	batchRemoveMembersSchema,
	createPlayerListSchema,
	playerListMemberParamsSchema,
	playerListParamsSchema,
	reorderMembersSchema,
	updatePlayerListSchema,
} from '~~/server/schemas/api/playerList';

// ──────────────── createPlayerListSchema ────────────────

describe('createPlayerListSchema', () => {
	it('accepts valid input with name', () => {
		const result = createPlayerListSchema.safeParse({ name: 'Top 8' });
		expect(result.success).toBe(true);
	});

	it('accepts name of exactly 200 characters', () => {
		const result = createPlayerListSchema.safeParse({ name: 'a'.repeat(200) });
		expect(result.success).toBe(true);
	});

	it('accepts name of exactly 1 character', () => {
		const result = createPlayerListSchema.safeParse({ name: 'A' });
		expect(result.success).toBe(true);
	});
});

// ──────────────── updatePlayerListSchema ────────────────

describe('updatePlayerListSchema', () => {
	it('accepts empty object (all fields optional)', () => {
		const result = updatePlayerListSchema.safeParse({});
		expect(result.success).toBe(true);
	});

	it('accepts partial update with name', () => {
		const result = updatePlayerListSchema.safeParse({ name: 'Updated List' });
		expect(result.success).toBe(true);
	});

	it('accepts name of exactly 200 characters', () => {
		const result = updatePlayerListSchema.safeParse({ name: 'a'.repeat(200) });
		expect(result.success).toBe(true);
	});
});

// ──────────────── addMembersSchema ────────────────

describe('addMembersSchema', () => {
	it('accepts valid playerIds array with one element', () => {
		const result = addMembersSchema.safeParse({ playerIds: [1] });
		expect(result.success).toBe(true);
	});

	it('accepts valid playerIds array with multiple elements', () => {
		const result = addMembersSchema.safeParse({ playerIds: [1, 2, 3, 4, 5] });
		expect(result.success).toBe(true);
	});

	it('accepts playerIds array of exactly 500 elements', () => {
		const ids = Array.from({ length: 500 }, (_, i) => i + 1);
		const result = addMembersSchema.safeParse({ playerIds: ids });
		expect(result.success).toBe(true);
	});

	it('rejects duplicate IDs before they reach list mutations', () => {
		expect(addMembersSchema.safeParse({ playerIds: [1, 1] }).success).toBe(false);
		expect(reorderMembersSchema.safeParse({ playerIds: [1, 1] }).success).toBe(false);
	});
});

// ──────────────── batchRemoveMembersSchema ────────────────

describe('batchRemoveMembersSchema', () => {
	it('accepts valid playerIds array', () => {
		const result = batchRemoveMembersSchema.safeParse({ playerIds: [1, 2, 3] });
		expect(result.success).toBe(true);
	});

	it('accepts playerIds array of exactly 500 elements', () => {
		const ids = Array.from({ length: 500 }, (_, i) => i + 1);
		const result = batchRemoveMembersSchema.safeParse({ playerIds: ids });
		expect(result.success).toBe(true);
	});
});

// ──────────────── reorderMembersSchema ────────────────

describe('reorderMembersSchema', () => {
	it('accepts valid playerIds array', () => {
		const result = reorderMembersSchema.safeParse({ playerIds: [3, 1, 2] });
		expect(result.success).toBe(true);
	});

	it('accepts single element playerIds', () => {
		const result = reorderMembersSchema.safeParse({ playerIds: [1] });
		expect(result.success).toBe(true);
	});
});

// ──────────────── playerListParamsSchema ────────────────

describe('playerListParamsSchema', () => {
	it('coerces string id and listId to numbers', () => {
		const result = playerListParamsSchema.safeParse({ id: '1', listId: '5' });
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.id).toBe(1);
			expect(result.data.listId).toBe(5);
		}
	});

	it('accepts numeric id and listId', () => {
		const result = playerListParamsSchema.safeParse({ id: 10, listId: 20 });
		expect(result.success).toBe(true);
	});
});

// ──────────────── playerListMemberParamsSchema ────────────────

describe('playerListMemberParamsSchema', () => {
	it('coerces string id, listId, and playerId to numbers', () => {
		const result = playerListMemberParamsSchema.safeParse({ id: '1', listId: '5', playerId: '10' });
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.id).toBe(1);
			expect(result.data.listId).toBe(5);
			expect(result.data.playerId).toBe(10);
		}
	});
});
