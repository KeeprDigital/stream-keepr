import { describe, expect, it } from 'vitest';
import { sameArchetypeName } from '~~/shared/utils/archetypeName';

describe('whether two Archetype names clash', () => {
	it.each([
		['the same name', 'Burn', 'Burn', true],
		[
			'names differing by case',
			'Izzet Phoenix',
			'izzet PHOENIX',
			true,
		],
		[
			'names differing by surrounding spaces',
			' Burn  ',
			'Burn',
			true,
		],
		[
			'names differing by a letter',
			'Burn',
			'Burns',
			false,
		],
		[
			'names differing by an inner space',
			'Mono Red',
			'MonoRed',
			false,
		],
	])('%s', (_case, a, b, clash) => {
		expect(sameArchetypeName(a, b)).toBe(clash);
	});
});
