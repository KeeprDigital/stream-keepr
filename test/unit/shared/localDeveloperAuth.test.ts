import { describe, expect, it } from 'vitest';
import { localAuthBypassEnabled } from '~~/shared/utils/localDeveloperAuth';

describe('the Local Developer Session opt-in', () => {
	it('activates only for the exact value true in a development server', () => {
		expect(localAuthBypassEnabled({ dev: true, value: 'true' })).toBe(true);

		for (const value of [undefined, '', ' ', 'false', 'TRUE', '1', true])
			expect(localAuthBypassEnabled({ dev: true, value })).toBe(false);
	});

	it('never activates outside a development server', () => {
		expect(localAuthBypassEnabled({ dev: false, value: 'true' })).toBe(false);
	});
});
