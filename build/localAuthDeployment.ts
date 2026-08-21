import { LOCAL_RUNTIME_ATTESTATION_NAME } from '../shared/utils/localDeveloperAuth.ts';

/**
 * Keep the launcher-owned local-runtime attestation out of every deployable
 * Wrangler configuration branch, including named environments.
 */
export function assertWorkerConfigurationDoesNotAttestLocalRuntime(configuration: unknown): void {
	if (configurationContainsAttestation(configuration)) {
		throw new Error(
			`Generated Worker configuration contains the ${LOCAL_RUNTIME_ATTESTATION_NAME} local-runtime attestation; refusing to deploy local authentication state.`,
		);
	}
}

function configurationContainsAttestation(value: unknown): boolean {
	if (Array.isArray(value))
		return value.some(configurationContainsAttestation);
	if (value === null || typeof value !== 'object')
		return false;
	return Object.entries(value).some(([name, nested]) =>
		name === LOCAL_RUNTIME_ATTESTATION_NAME || configurationContainsAttestation(nested),
	);
}
