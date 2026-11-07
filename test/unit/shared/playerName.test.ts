import { describe, expect, it } from 'vitest';
import { playerDisplayName, playerLabel, playerMatchesSearch, playerShownName, unshownPlayerReason } from '~~/shared/utils/playerName';

describe('the name that fills a Player\'s name fields', () => {
	// The operator's name wins; the TCG+ Nickname stands in only while there is none (ADR-0077).
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

describe('how an operator screen labels a Player', () => {
	// Giving a name never hides the Nickname; a Player without one shows by name (ADR-0077).
	it.each([
		[
			{ name: 'Big Mom', nickname: 'linlin_88' },
			'linlin_88',
		],
		[
			{ name: 'Big Mom', nickname: '  ' },
			'Big Mom',
		],
		[
			{ name: 'Ava Reed' },
			'Ava Reed',
		],
		[null, ''],
	])('labels %j as %j', (player, shown) => {
		expect(playerLabel(player)).toBe(shown);
	});
});

describe('a Player shown by the name a Screen picks', () => {
	// The one picked shows, and the other stands in when it is blank (ADR-0077).
	it.each([
		[
			'name',
			{ name: 'Big Mom', nickname: 'linlin_88' },
			'Big Mom',
		],
		[
			'name',
			{ name: '', nickname: 'linlin_88' },
			'linlin_88',
		],
		[
			'nickname',
			{ name: 'Big Mom', nickname: 'linlin_88' },
			'linlin_88',
		],
		[
			'nickname',
			{ name: 'Big Mom', nickname: null },
			'Big Mom',
		],
	] as const)('by %s, shows %j as %j', (shown, player, name) => {
		expect(playerShownName(player, shown)).toBe(name);
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

describe('whether a written Player can be shown', () => {
	// A Player always shows by something: an OP Player by name or Nickname, an MTG one by name (ADR-0074).
	it.each([
		[
			'op',
			{ name: '', nickname: 'linlin_88' },
			null,
		],
		[
			'op',
			{ name: ' ', nickname: ' ' },
			'A Player needs a name or a Nickname',
		],
		[
			'mtg',
			{ name: 'Ava Reed', nickname: null },
			null,
		],
		[
			'mtg',
			{ name: '', nickname: null },
			'A Player needs a name',
		],
		[
			'mtg',
			{ name: 'Ava Reed', nickname: 'ava' },
			'Only a One Piece Card Game Player has a Nickname',
		],
	] as const)('on %s, %o is refused for %s', (game, player, reason) => {
		expect(unshownPlayerReason(game, player)).toBe(reason);
	});
});
