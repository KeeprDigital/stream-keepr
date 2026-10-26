import { describe, expect, it } from 'vitest';
import {
	addMembersSchema,
	batchRemoveMembersSchema,
	reorderMembersSchema,
} from '~~/server/schemas/api/playerList';

const ids = (count: number) => Array.from({ length: count }, (_, index) => index + 1);

describe.each([
	['addMembersSchema', addMembersSchema],
	['batchRemoveMembersSchema', batchRemoveMembersSchema],
	['reorderMembersSchema', reorderMembersSchema],
] as const)('%s', (_name, schema) => {
	it.each([
		[
			'one Player',
			ids(1),
			true,
		],
		[
			'500 Players',
			ids(500),
			true,
		],
		['no Players', [], false],
		[
			'501 Players',
			ids(501),
			false,
		],
		[
			'a duplicate Player',
			[1, 1],
			false,
		],
	])('takes %s → %s', (_case, playerIds, accepted) => {
		expect(schema.safeParse({ playerIds }).success).toBe(accepted);
	});
});
