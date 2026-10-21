import type { ScreenModeConfigFields } from './fields';
import { z } from 'zod';
import { clampToShapeBounds, screenModeConfigFields } from './fields';

/** Refuses a field carrying a zod default: a default lives only in `defaults` (ADR-0037). */
type FieldsWithoutDefaults<Shape extends z.ZodRawShape> = {
	[K in keyof Shape]: Shape[K] extends z.ZodDefault | z.ZodPrefault ? never : Shape[K];
};

declare const serverValidated: unique symbol;

/**
 * A contract field whose schema only the server can build, because it reaches
 * server-only Graphic Asset ids: a Background Layer stack, a Broadcast Graphics
 * stack, or a Feature Match Layout. The contract fixes the field's type and
 * default; the server supplies its schema, typed so that what it produces is
 * that type (`configContractModeForms`), the check a `satisfies z.ZodType<T>`
 * made before (ADR-0037).
 *
 * In the contract's own `schema` the field refuses every value, so nothing in
 * `shared/` can mistake it for validation.
 */
export type ServerValidatedField<T> = z.ZodCustom<T, T> & { readonly [serverValidated]: true };

/** The contract fields whose schema the server supplies. */
export type ServerValidatedKeys<Shape extends z.ZodRawShape> = {
	[K in keyof Shape]: Shape[K] extends ServerValidatedField<any> ? K : never;
}[keyof Shape];

const serverValidatedFields = new WeakSet<z.ZodType>();

export function serverValidatedField<T>(): ServerValidatedField<T> {
	const field = z.custom<T>(() => false, 'Validated only on the server');
	serverValidatedFields.add(field);
	return field as ServerValidatedField<T>;
}

export function isServerValidatedField(field: z.ZodType): boolean {
	return serverValidatedFields.has(field);
}

/** The fields of a shape that hold a list, and so may be declared an authored stack. */
type ListKeys<Shape extends z.ZodRawShape> = {
	[K in keyof Shape]: z.output<Shape[K]> extends readonly unknown[] ? K : never;
}[keyof Shape] & string;

/**
 * One Screen Mode's config contract: the single source of its config's shape,
 * type, and defaults.
 *
 * - `shape` is the mode's own fields. It carries no `backgroundLayers`: the
 *   server adds that field to every mode whose Screen Mode Definition declares a
 *   Background Layer stack.
 * - `schema` is the strict object of those own fields: what a rendering reads
 *   once the stored fragment is completed from `defaults`, less any declared
 *   `backgroundLayers`. The config's type is inferred from it
 *   (`ScreenModeConfigOf`), so type and schema cannot disagree. It is the
 *   schema's input: the config as authored, so a nested value a reader re-proves,
 *   such as a Broadcast Graphics Background's sparse params, keeps its authored
 *   form. A `serverValidatedField` in it refuses every value; the server's
 *   complete schema is the one that validates.
 * - `defaults` is a complete config of that type, so a default of the wrong type is
 *   a compile error. Its bounds are checked against the server's write forms by
 *   `test/unit/server/schemas/screenModeConfigContracts.test.ts`.
 * - `authoredStacks` names the list fields holding authored content with no
 *   recovery path, such as the Broadcast Graphics stack. A display reset leaves
 *   one untouched, and a PATCH may replace one but never delete it with `null`,
 *   which would empty it.
 * - `fields` is the editor-facing view of every field marked `editorField`: its
 *   label, control kind, and bounds read back from the schema, so the mode's
 *   editor offers exactly the range the contract accepts (#498).
 *
 * The write forms are derived from `shape` on the server without special cases
 * (`configContractModeForms`): a full write validates a fragment of the complete
 * config, and a PATCH body is every field optional and nullable, `null` being the
 * "delete this key" sentinel, except an authored stack, which is only optional.
 */
export interface ScreenModeConfigContract<
	Shape extends z.ZodRawShape = z.ZodRawShape,
	AuthoredStack extends string = string,
> {
	readonly shape: Shape;
	readonly schema: z.ZodObject<Shape, z.core.$strict>;
	readonly defaults: z.input<z.ZodObject<Shape, z.core.$strict>>;
	readonly authoredStacks: readonly AuthoredStack[];
	readonly fields: ScreenModeConfigFields<Shape>;
	/**
	 * A stored fragment as a reader reads it: every number outside its field's
	 * bounds pulled to the nearest bound (`clampToShapeBounds`). Reads only, so a
	 * tightened bound never resets or refuses a stored config; writes are refused.
	 */
	readonly clampStored: <T extends Record<string, unknown>>(fragment: T) => T;
}

/** The config type a contract defines: what a rendering of its mode reads. */
export type ScreenModeConfigOf<Contract extends ScreenModeConfigContract<any, any>> = Contract['defaults'];

export function defineScreenModeConfigContract<
	const Shape extends z.ZodRawShape,
	const AuthoredStack extends ListKeys<Shape> = never,
>(
	shape: Shape & FieldsWithoutDefaults<Shape>,
	defaults: z.input<z.ZodObject<Shape, z.core.$strict>>,
	options: { authoredStacks?: readonly AuthoredStack[] } = {},
): ScreenModeConfigContract<Shape, AuthoredStack> {
	return {
		shape,
		schema: z.object(shape).strict(),
		defaults,
		authoredStacks: options.authoredStacks ?? [],
		fields: screenModeConfigFields(shape),
		clampStored: fragment => clampToShapeBounds(shape, fragment),
	};
}
