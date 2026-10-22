import { describe, expect, it } from 'vitest';
import { completeColumns } from '~~/shared/screenModeConfigs/subShapes';

const KEYS = ['position', 'name', 'points', 'positionChange'] as const;

describe('completeColumns', () => {
	it('keeps a stored list that names every column as stored', () => {
		const stored = [
			{ key: 'name' as const, visible: true },
			{ key: 'positionChange' as const, visible: true },
			{ key: 'position' as const, visible: false },
			{ key: 'points' as const, visible: true },
		];

		expect(completeColumns(stored, KEYS)).toEqual(stored);
	});

	it('appends a column a stored list predates, hidden, after the stored order', () => {
		const stored = [
			{ key: 'points' as const, visible: true },
			{ key: 'name' as const, visible: true },
			{ key: 'position' as const, visible: false },
		];

		expect(completeColumns(stored, KEYS)).toEqual([
			{ key: 'points', visible: true },
			{ key: 'name', visible: true },
			{ key: 'position', visible: false },
			{ key: 'positionChange', visible: false },
		]);
	});
});
