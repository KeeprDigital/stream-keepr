import type { ScreenModeConfigOf } from '~~/shared/screenModeConfigs/contract';
import type { featureMatchOverlayModeConfigContract } from '~~/shared/screenModeConfigs/featureMatchOverlay';
import type { metagameModeConfigContract } from '~~/shared/screenModeConfigs/metagame';
import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import type { BroadcastGraphicsModeConfig, FeatureMatchOverlayModeConfig, MetagameModeConfig } from '~~/shared/types/screenConfig';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { defineScreenModeConfigContract, serverValidatedField } from '~~/shared/screenModeConfigs/contract';

/**
 * A config contract makes its type, schema, and defaults one source, so they
 * cannot disagree. These are compile-time claims: `pnpm typecheck` fails if a
 * `@ts-expect-error` below stops being an error.
 */
describe('a Screen Mode config contract', () => {
	it('infers its mode\'s config type from its schema', () => {
		expectTypeOf<MetagameModeConfig>().toEqualTypeOf<z.input<typeof metagameModeConfigContract.schema>>();
		expectTypeOf<MetagameModeConfig['minPoints']>().toEqualTypeOf<number>();
		expectTypeOf<MetagameModeConfig['archetypeLimit']>().toEqualTypeOf<number | null | undefined>();
		expectTypeOf<FeatureMatchOverlayModeConfig>().toEqualTypeOf<ScreenModeConfigOf<typeof featureMatchOverlayModeConfigContract>>();
	});

	it('types a server-validated field as the contract declares it', () => {
		expectTypeOf<BroadcastGraphicsModeConfig['graphics']>().toEqualTypeOf<BroadcastGraphicConfig[]>();
	});

	it('refuses a server-validated field\'s every value in its own schema, so nothing shared mistakes it for validation', () => {
		const contract = defineScreenModeConfigContract({ graphics: serverValidatedField<string[]>() }, { graphics: [] });

		expect(contract.schema.safeParse({ graphics: [] }).success).toBe(false);
	});

	it('refuses defaults that do not match its schema', () => {
		const shape = { topN: z.number().int().min(1), headerText: z.string().optional() };

		// @ts-expect-error — a default of the wrong type
		defineScreenModeConfigContract(shape, { topN: '8' });
		// @ts-expect-error — a required field left without a default
		defineScreenModeConfigContract(shape, { headerText: 'Top 8' });
		// @ts-expect-error — a default for a field the schema does not have
		defineScreenModeConfigContract(shape, { topN: 8, autoPaging: true });

		expect(defineScreenModeConfigContract(shape, { topN: 8 }).defaults).toEqual({ topN: 8 });
	});

	it('refuses a schema default, so a default lives only in the contract\'s defaults', () => {
		// @ts-expect-error — a zod default would be a second copy, and leak into PATCHes
		defineScreenModeConfigContract({ minPoints: z.number().default(9) }, { minPoints: 9 });
	});

	it('declares only a list field an authored stack', () => {
		const shape = { graphics: z.array(z.string()), topN: z.number() };

		// @ts-expect-error — `topN` is not a stack
		defineScreenModeConfigContract(shape, { graphics: [], topN: 8 }, { authoredStacks: ['topN'] });

		expect(defineScreenModeConfigContract(shape, { graphics: [], topN: 8 }, { authoredStacks: ['graphics'] }).authoredStacks)
			.toEqual(['graphics']);
	});
});
