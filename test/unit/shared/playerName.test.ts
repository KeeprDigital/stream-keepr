import { describe, expect, it } from 'vitest';
import { playerDisplayName, playerMatchesSearch } from '~~/shared/utils/playerName';

describe('a Player\'s display name', () => {
	// The operator's name wins; the TCG+ Nickname stands in only while there is none (ADR-0074).
	it.each([
		[
			{ name: 'Big Mom', nickname: 'linlin_88' },
			'Big Mom',
		],
		[
			{ name: '', nickname: 'linlin_88' },
			'linlin_88',
		],
		[
			{ name: '   ', nickname: 'linlin_88' },
			'linlin_88',
		],
		[
			{ name: null, nickname: 'linlin_88' },
			'linlin_88',
		],
		[
			{ name: 'Ava Reed' },
			'Ava Reed',
		],
		[
			{ name: '', nickname: null },
			'',
		],
		[null, ''],
	])('shows %j as %j', (player, shown) => {
		expect(playerDisplayName(player)).toBe(shown);
	});
});

describe('finding a Player in a picker', () => {
	const imported = {
		name: 'Big Mom',
		nickname: 'linlin_88',
		externalId: '0012345678',
		externalSource: 'tcgplus' as const,
	};
	const meleePlayer = {
		name: 'Ava Reed',
		nickname: null,
		externalId: '991',
		externalSource: 'melee' as const,
	};

	// Name, Nickname and Bandai member number all find a Player, whatever their case.
	it.each([
		[imported, 'big', true],
		[imported, 'LINLIN', true],
		[imported, '0012345', true],
		[imported, 'ava', false],
		[imported, '', true],
		// A Melee id is not a member number, so it finds nobody.
		[meleePlayer, '991', false],
		[meleePlayer, 'reed', true],
	])('%j matches %j: %s', (player, query, matches) => {
		expect(playerMatchesSearch(player, query)).toBe(matches);
	});
});
