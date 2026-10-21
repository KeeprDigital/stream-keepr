import type { metagameModeConfigContract } from '~~/shared/screenModeConfigs/metagame';
import type { MetagameModeConfig } from '~~/shared/types/screenConfig';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { defineScreenModeConfigContract } from '~~/shared/screenModeConfigs/contract';

/**
 * A config contract makes its type, schema, and defaults one source, so they
 * cannot disagree. These are compile-time claims: `pnpm typecheck` fails if a
 * `@ts-expect-error` below stops being an error.
 */
describe('a Screen Mode config contract', () => {
	it('infers its mode\'s config type from its schema', () => {
		expectTypeOf<MetagameModeConfig>().toEqualTypeOf<z.output<typeof metagameModeConfigContract.schema>>();
		expectTypeOf<MetagameModeConfig['minPoints']>().toEqualTypeOf<number>();
		expectTypeOf<MetagameModeConfig['archetypeLimit']>().toEqualTypeOf<number | null | undefined>();
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
});
