import { describe, expect, it } from 'vitest';
import {
	LOCAL_AUTH_BYPASS_ENABLED_VALUE,
	LOCAL_RUNTIME_ATTESTATION_VALUE,
	localAuthBypassEnabled,
} from '~~/shared/utils/localDeveloperAuth';

describe('the Local Developer Session opt-in', () => {
	it('activates only when the exact bypass choice and local-runtime attestation agree', () => {
		expect(localAuthBypassEnabled({
			bypassValue: LOCAL_AUTH_BYPASS_ENABLED_VALUE,
			runtimeAttestation: LOCAL_RUNTIME_ATTESTATION_VALUE,
		})).toBe(true);

		for (const value of [undefined, '', ' ', 'false', 'TRUE', '1', true]) {
			expect(localAuthBypassEnabled({
				bypassValue: value,
				runtimeAttestation: LOCAL_RUNTIME_ATTESTATION_VALUE,
			})).toBe(false);
		}
	});

	it('keeps the bypass choice inert without the exact local-runtime attestation', () => {
		for (const runtimeAttestation of [undefined, '', ' ', 'false', 'TRUE', '1', true]) {
			expect(localAuthBypassEnabled({
				bypassValue: LOCAL_AUTH_BYPASS_ENABLED_VALUE,
				runtimeAttestation,
			})).toBe(false);
		}
	});
});
