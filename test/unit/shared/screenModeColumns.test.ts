import { describe, expect, it } from 'vitest';
import { playerHistoryModeConfigContract } from '../../../shared/screenModeConfigs/playerHistory';
import { withEveryColumn } from '../../../shared/screenModeConfigs/subShapes';

describe('withEveryColumn', () => {
	const defaults = [
		{ key: 'round', visible: true },
		{ key: 'opponent', visible: true },
		{ key: 'table', visible: true },
		{ key: 'outcome', visible: true },
		{ key: 'opponentArchetype', visible: false },
		{ key: 'gameScore', visible: true },
	];

	it('appends each default column a stored list lacks, hidden as the stored list renders it, in their order', () => {
		const stored = [
			{ key: 'outcome', visible: true },
			{ key: 'round', visible: false },
			{ key: 'opponent', visible: true },
			{ key: 'table', visible: true },
		];

		expect(withEveryColumn(stored, defaults)).toEqual([
			{ key: 'outcome', visible: true },
			{ key: 'round', visible: false },
			{ key: 'opponent', visible: true },
			{ key: 'table', visible: true },
			{ key: 'opponentArchetype', visible: false },
			{ key: 'gameScore', visible: false },
		]);
	});

	it('returns a complete list as it is', () => {
		const complete = defaults.map(column => ({ ...column, visible: false }));

		expect(withEveryColumn(complete, defaults)).toBe(complete);
	});
});

describe('player History columns', () => {
	it('offer opponent archetype and game score, hidden by default after the original four', () => {
		expect(playerHistoryModeConfigContract.defaults.columns).toEqual([
			{ key: 'round', visible: true },
			{ key: 'opponent', visible: true },
			{ key: 'table', visible: true },
			{ key: 'outcome', visible: true },
			{ key: 'opponentArchetype', visible: false },
			{ key: 'gameScore', visible: false },
		]);
	});

	it('accept a stored list of the original four, and one holding every column', () => {
		const schema = playerHistoryModeConfigContract.schema.shape.columns;

		expect(schema.safeParse(playerHistoryModeConfigContract.defaults.columns.slice(0, 4)).success).toBe(true);
		expect(schema.safeParse(playerHistoryModeConfigContract.defaults.columns).success).toBe(true);
	});
});
