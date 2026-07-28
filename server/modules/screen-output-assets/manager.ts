import {
	createScreenOutputAssetCapability,
	screenOutputAssetCapabilityDigest,
} from './capability';

export interface PersistedScreenOutputAssetCapability {
	assetCapabilitySeed: string;
	assetCapabilityVersion: number;
	assetCapabilityDigest: string;
}

interface CapabilityScreen extends PersistedScreenOutputAssetCapability {
	id: number;
	eventId: number;
}

interface ScreenOutputAssetCapabilityManagerDependencies {
	signingKey: string;
	screens: {
		findById: (screenId: number, eventId: number) => Promise<CapabilityScreen | undefined>;
		replaceAssetCapability: (
			screenId: number,
			eventId: number,
			replacement: PersistedScreenOutputAssetCapability,
			expectedVersion: number,
		) => Promise<CapabilityScreen | undefined>;
	};
	generateSeed?: () => string;
}

type ScreenOutputAssetCapabilityOutcome
	= { outcome: 'available'; capability: string }
		| { outcome: 'missing' };

export function createScreenOutputAssetCapabilityManager(
	dependencies: ScreenOutputAssetCapabilityManagerDependencies,
) {
	const generateSeed = dependencies.generateSeed ?? (() => crypto.randomUUID());

	async function derive(persisted: Pick<
		PersistedScreenOutputAssetCapability,
		'assetCapabilitySeed' | 'assetCapabilityVersion'
	>) {
		return await createScreenOutputAssetCapability({
			signingKey: dependencies.signingKey,
			seed: persisted.assetCapabilitySeed,
			version: persisted.assetCapabilityVersion,
		});
	}

	async function prepare(input: {
		seed?: string;
		version?: number;
	} = {}) {
		const seed = input.seed ?? generateSeed();
		const version = input.version ?? 1;
		const capability = await derive({
			assetCapabilitySeed: seed,
			assetCapabilityVersion: version,
		});
		return {
			capability,
			persisted: {
				assetCapabilitySeed: seed,
				assetCapabilityVersion: version,
				assetCapabilityDigest: await screenOutputAssetCapabilityDigest(capability),
			},
		};
	}

	async function current(input: {
		eventId: number;
		screenId: number;
	}): Promise<ScreenOutputAssetCapabilityOutcome> {
		const screen = await dependencies.screens.findById(input.screenId, input.eventId);
		if (!screen)
			return { outcome: 'missing' };
		return {
			outcome: 'available',
			capability: await derive(screen),
		};
	}

	async function rotate(input: {
		eventId: number;
		screenId: number;
	}): Promise<ScreenOutputAssetCapabilityOutcome> {
		const screen = await dependencies.screens.findById(input.screenId, input.eventId);
		if (!screen)
			return { outcome: 'missing' };
		const prepared = await prepare({
			seed: generateSeed(),
			version: screen.assetCapabilityVersion + 1,
		});
		const updated = await dependencies.screens.replaceAssetCapability(
			input.screenId,
			input.eventId,
			prepared.persisted,
			screen.assetCapabilityVersion,
		);
		if (!updated)
			return { outcome: 'missing' };
		return {
			outcome: 'available',
			capability: prepared.capability,
		};
	}

	return {
		prepare,
		current,
		rotate,
	};
}

export type ScreenOutputAssetCapabilityManager = ReturnType<
	typeof createScreenOutputAssetCapabilityManager
>;
