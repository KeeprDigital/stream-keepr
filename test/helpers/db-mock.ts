/**
 * Reusable mock for `hub:db`.
 *
 * Usage in test files:
 *   import { mockDb, resetDbMocks } from '~~/test/helpers/db-mock'
 *   vi.mock('hub:db', () => ({ db: mockDb }))
 *
 * Then in beforeEach:
 *   resetDbMocks()
 */

import { vi } from 'vitest';

// ──────────────── Chainable builder stubs ────────────────
// Each method returns `chain` so .select().from().where() etc. all work.

function createChainableQuery() {
	const chain: Record<string, ReturnType<typeof vi.fn>> = {};

	const methods = [
		'from',
		'where',
		'set',
		'values',
		'returning',
		'orderBy',
		'limit',
		'offset',
		'innerJoin',
		'leftJoin',
		'onConflictDoUpdate',
		'onConflictDoNothing',
		'select',
		'groupBy',
		'having',
	];

	for (const method of methods) {
		chain[method] = vi.fn().mockReturnValue(chain);
	}

	// Terminal methods that resolve — default to empty array
	chain.returning = vi.fn().mockResolvedValue([]);

	return chain;
}

// ──────────────── Query-style API (db.query.<table>.findFirst/findMany) ────────────────

function createQueryTable() {
	return {
		findFirst: vi.fn().mockResolvedValue(undefined),
		findMany: vi.fn().mockResolvedValue([]),
	};
}

// ──────────────── The mock db object ────────────────

export const mockDb = {
	// Builder-style operations
	select: vi.fn(),
	selectDistinct: vi.fn(),
	insert: vi.fn(),
	update: vi.fn(),
	delete: vi.fn(),
	batch: vi.fn().mockResolvedValue([]),

	// Query-style (relational) operations
	query: {
		events: createQueryTable(),
		eventTalents: createQueryTable(),
		players: createQueryTable(),
		rounds: createQueryTable(),
		phases: createQueryTable(),
		matches: createQueryTable(),
		playerLists: createQueryTable(),
		playerListMembers: createQueryTable(),
		playerRoundStandings: createQueryTable(),
		featureMatches: createQueryTable(),
		featureMatchSessions: createQueryTable(),
		featureMatchSessionEvents: createQueryTable(),
		screens: createQueryTable(),
		archetypes: createQueryTable(),
		cards: createQueryTable(),
	},
};

// Wire up builder methods — each top-level (select/insert/update/delete)
// returns a fresh chainable query
let selectChain = createChainableQuery();
let selectDistinctChain = createChainableQuery();
let insertChain = createChainableQuery();
let updateChain = createChainableQuery();
let deleteChain = createChainableQuery();

mockDb.select.mockReturnValue(selectChain);
mockDb.selectDistinct.mockReturnValue(selectDistinctChain);
mockDb.insert.mockReturnValue(insertChain);
mockDb.update.mockReturnValue(updateChain);
mockDb.delete.mockReturnValue(deleteChain);

/**
 * Reset all mocks to their initial state.
 * Call this in `beforeEach` of every service test.
 */
export function resetDbMocks() {
	// Reset query-style mocks
	for (const table of Object.values(mockDb.query)) {
		table.findFirst.mockReset().mockResolvedValue(undefined);
		table.findMany.mockReset().mockResolvedValue([]);
	}

	// Reset batch
	mockDb.batch.mockReset().mockResolvedValue([]);

	// Recreate chainable builders
	selectChain = createChainableQuery();
	selectDistinctChain = createChainableQuery();
	insertChain = createChainableQuery();
	updateChain = createChainableQuery();
	deleteChain = createChainableQuery();

	mockDb.select.mockReset().mockReturnValue(selectChain);
	mockDb.selectDistinct.mockReset().mockReturnValue(selectDistinctChain);
	mockDb.insert.mockReset().mockReturnValue(insertChain);
	mockDb.update.mockReset().mockReturnValue(updateChain);
	mockDb.delete.mockReset().mockReturnValue(deleteChain);
}

/**
 * Helper to get the current chainable mock for a builder operation.
 * Useful for setting up return values on terminal methods:
 *
 *   getChain('insert').returning.mockResolvedValue([newPlayer])
 */
export function getChain(op: 'select' | 'selectDistinct' | 'insert' | 'update' | 'delete') {
	switch (op) {
		case 'select': return selectChain;
		case 'selectDistinct': return selectDistinctChain;
		case 'insert': return insertChain;
		case 'update': return updateChain;
		case 'delete': return deleteChain;
	}
}
