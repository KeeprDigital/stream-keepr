import { describe, expect, it } from 'vitest';
import { formatPlayerRecord } from '../../../shared/utils/playerRecord';

describe('formatPlayerRecord', () => {
	it('writes wins and losses, leaving out no draws by default', () => {
		expect(formatPlayerRecord({ wins: 4, losses: 1, draws: 0 }, null)).toBe('4-1');
	});

	it('writes draws when there are some', () => {
		expect(formatPlayerRecord({ wins: 3, losses: 1, draws: 1 }, null)).toBe('3-1-1');
	});

	it('follows the Event\'s separator and its choice to show no draws', () => {
		expect(formatPlayerRecord({ wins: 2, losses: 0, draws: 0 }, { displayRecordSeparator: '/', displayHideZeroDraws: false })).toBe('2/0/0');
	});

	it('counts a missing figure as none', () => {
		expect(formatPlayerRecord({ wins: 2, losses: null, draws: null }, null)).toBe('2-0');
	});
});
