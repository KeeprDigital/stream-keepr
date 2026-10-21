import { z } from 'zod';

/**
 * A field of a mode's config that carries a zod default. Refused: a default lives
 * once, in the contract's `defaults`. A schema default would be a second copy, and
 * zod 4 applies one even through `.optional()`, so it would leak into every PATCH
 * that leaves the field out ("strip zod defaults when deriving mode-config PATCH
 * schemas").
 */
type FieldsWithoutDefaults<Shape extends z.ZodRawShape> = {
	[K in keyof Shape]: Shape[K] extends z.ZodDefault | z.ZodPrefault ? never : Shape[K];
};

/**
 * One Screen Mode's config contract: the single source of its config's shape,
 * type, and defaults.
 *
 * - `shape` is the mode's own fields. It carries no `backgroundLayers`: the
 *   server adds that field to every mode whose Screen Mode Definition declares a
 *   Background Layer stack, as it does for a mode still on the old form.
 * - `schema` is the complete config a rendering reads, once the stored fragment is
 *   completed from `defaults`. The config's type is inferred from it
 *   (`ScreenModeConfigOf`), so type and schema cannot disagree.
 * - `defaults` is a complete config of that type, so a default of the wrong type is
 *   a compile error. Its bounds are checked against `schema` by
 *   `test/unit/server/schemas/screenModeConfigContracts.test.ts`.
 *
 * The write forms are derived from `schema` on the server without special cases
 * (`configContractModeForms`): a full write validates the complete config, and a
 * PATCH body is every field optional and nullable, `null` being the "delete this
 * key" sentinel.
 */
export interface ScreenModeConfigContract<Shape extends z.ZodRawShape = z.ZodRawShape> {
	readonly shape: Shape;
	readonly schema: z.ZodObject<Shape, z.core.$strict>;
	readonly defaults: z.output<z.ZodObject<Shape, z.core.$strict>>;
}

/** The config type a contract defines: what a rendering of its mode reads. */
export type ScreenModeConfigOf<Contract extends ScreenModeConfigContract<any>> = Contract['defaults'];

export function defineScreenModeConfigContract<const Shape extends z.ZodRawShape>(
	shape: Shape & FieldsWithoutDefaults<Shape>,
	defaults: z.output<z.ZodObject<Shape, z.core.$strict>>,
): ScreenModeConfigContract<Shape> {
	return { shape, schema: z.object(shape).strict(), defaults };
}
