import { describe, expect, it } from 'vitest';
import { bearerScreenOutputCapability } from '~~/server/utils/screenOutputCapabilityAuthorization';

describe('screen Output capability Authorization syntax', () => {
	it('accepts only the bounded case-sensitive Bearer form', () => {
		const capability = 'abcdefghijklmnopqrstuvwxyz_0123456789-ABC';

		expect(bearerScreenOutputCapability(`Bearer ${capability}`)).toBe(capability);
		expect(bearerScreenOutputCapability(`bearer ${capability}`)).toBeUndefined();
		expect(bearerScreenOutputCapability(`Bearer  ${capability}`)).toBeUndefined();
		expect(bearerScreenOutputCapability(`Bearer ${capability} trailing`)).toBeUndefined();
		expect(bearerScreenOutputCapability('Bearer short')).toBeUndefined();
		expect(bearerScreenOutputCapability(undefined)).toBeUndefined();
	});
});
