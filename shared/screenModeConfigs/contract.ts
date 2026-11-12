import type { ConfigFieldMeta, EditorField, ScreenModeConfigField, ScreenModeConfigFields, ScreenSettingsGroupDeclaration, ShapeEventReferences } from './fields';
import { z } from 'zod';
import { isPlainRecord } from '../utils/plainObject';
import { assertFieldGroupsDeclared, clampToShapeBounds, EDITOR_META_KEY, screenModeConfigFields, unwrapOptionalField } from './fields';

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

/** `meta` is the field's editor description: a server-validated field is edited by a named slot's widget. */
export function serverValidatedField<T>(meta: ConfigFieldMeta): EditorField<ServerValidatedField<T>>;
export function serverValidatedField<T>(): ServerValidatedField<T>;
export function serverValidatedField<T>(meta?: ConfigFieldMeta): ServerValidatedField<T> {
	const custom = z.custom<T>(() => false, 'Validated only on the server');
	const field = meta
		? custom.meta({
				[EDITOR_META_KEY]: { ...meta },
			})
		: custom;
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
 *   editor offers exactly the range the contract accepts (#498), and the rest
 *   of its editor description: its settings card and group, description, show
 *   condition, option labels, and Event Reference kind or named slot (#1093).
 * - `groups` declares the mode's Screen Settings Groups once, each with its
 *   heading and card, in the order its page shows them. Every field naming a
 *   group, and every Mode Token of the mode, names one declared here
 *   (ADR-0072).
 * - `eventReferences` lists the fields naming an Event Reference, with the
 *   kind each names (ADR-0038), read from the fields themselves.
 * - `formerFields` names the fields an earlier version of the contract held,
 *   which storage may still carry, such as Top Cut Bracket's placeholder `bracketSize`
 *   (#752). A field of a nested block is named by its path, such as
 *   `mainboard.cardGap`. No reader sees one, a write naming one is accepted without storing
 *   it, and the next PATCH of the mode's config removes it from storage.
 * - `upgradeFormerFields`, given to `defineScreenModeConfigContract`, maps what
 *   an earlier version of the contract stored to the fields that replaced it,
 *   such as a count to the range it meant. It runs wherever former fields are
 *   dropped, before they are: on every read, on a write a stale client sends,
 *   and on the stored fragment a PATCH merges into (`upgradeStored`).
 *
 * The write forms are derived from `shape` on the server without special cases
 * (`configContractModeForms`): a full write validates a fragment of the complete
 * config, and a PATCH body is every field optional and nullable, `null` being the
 * "delete this key" sentinel, except an authored stack, which is only optional.
 */
export interface ScreenModeConfigContract<
	Shape extends z.ZodRawShape = z.ZodRawShape,
	AuthoredStack extends string = string,
	Group extends string = string,
> {
	readonly shape: Shape;
	readonly schema: z.ZodObject<Shape, z.core.$strict>;
	readonly defaults: z.input<z.ZodObject<Shape, z.core.$strict>>;
	readonly authoredStacks: readonly AuthoredStack[];
	readonly fields: ScreenModeConfigFields<Shape>;
	readonly groups: Readonly<Record<Group, ScreenSettingsGroupDeclaration>>;
	readonly eventReferences: ShapeEventReferences<Shape>;
	readonly formerFields: readonly string[];
	/**
	 * A stored fragment as a reader reads it: upgraded (`upgradeStored`), and
	 * every number outside its field's bounds pulled to the nearest bound
	 * (`clampToShapeBounds`). Reads only, so a tightened bound never resets or
	 * refuses a stored config; writes are refused. A fragment needing neither is
	 * returned as it is.
	 */
	readonly readStored: <T extends Record<string, unknown>>(fragment: T) => T;
	/**
	 * A fragment an earlier version of the contract may have written, as this
	 * version holds it: its former fields mapped to the current fields that
	 * replaced them (`upgradeFormerFields`), then dropped. Returned as it is when
	 * it needs neither, or is no fragment at all.
	 */
	readonly upgradeStored: <T>(fragment: T) => T;
}

/**
 * Maps a fragment an earlier version of a contract wrote to the current fields.
 * It sees the fragment before its former fields are dropped, and may read them,
 * set current fields from them, and rewrite a current field holding a value
 * only the earlier version allowed. It returns the fragment itself when it has
 * nothing to map, and must map its own output to itself, since a fragment is
 * upgraded on every read. A PATCH body is a fragment too: one naming only part
 * of what a mapping needs is the hook's to map or leave to be dropped.
 */
export type UpgradeFormerFields = (fragment: Readonly<Record<string, unknown>>) => Record<string, unknown>;

/** The config type a contract defines: what a rendering of its mode reads. */
export type ScreenModeConfigOf<Contract extends ScreenModeConfigContract<any, any, any>> = Contract['defaults'];

/** The Screen Settings Groups a contract declares: the groups its Mode Tokens may name (ADR-0072). */
export type ScreenSettingsGroupOf<Contract extends ScreenModeConfigContract<any, any, any>> = keyof Contract['groups'] & string;

export function defineScreenModeConfigContract<
	const Shape extends z.ZodRawShape,
	const AuthoredStack extends ListKeys<Shape> = never,
	const Group extends string = never,
>(
	shape: Shape & FieldsWithoutDefaults<Shape>,
	defaults: z.input<z.ZodObject<Shape, z.core.$strict>>,
	options: {
		authoredStacks?: readonly AuthoredStack[];
		groups?: Readonly<Record<Group, ScreenSettingsGroupDeclaration>>;
		formerFields?: readonly string[];
		upgradeFormerFields?: UpgradeFormerFields;
	} = {},
): ScreenModeConfigContract<Shape, AuthoredStack, Group> {
	const formerFields = options.formerFields ?? [];
	const formerPaths = formerFields.map(field => field.split('.'));
	for (const path of formerPaths) {
		if (shapeHoldsPath(shape, path))
			throw new Error(`Config field "${path.join('.')}" cannot be both a field and a former field of one contract.`);
	}
	const groups = options.groups ?? {} as Readonly<Record<Group, ScreenSettingsGroupDeclaration>>;
	const fields = screenModeConfigFields(shape);
	assertFieldGroupsDeclared(fields, groups);

	function upgradeStored<T>(fragment: T): T {
		const upgraded = options.upgradeFormerFields && isPlainRecord(fragment)
			? options.upgradeFormerFields(fragment)
			: fragment;
		let kept: Record<string, unknown> | undefined;
		for (const path of formerPaths)
			kept = withoutPath(kept ?? upgraded, path) ?? kept;
		return (kept ?? upgraded) as T;
	}

	return {
		shape,
		schema: z.object(shape).strict(),
		defaults,
		authoredStacks: options.authoredStacks ?? [],
		fields,
		groups,
		eventReferences: eventReferencesOf(fields) as ShapeEventReferences<Shape>,
		formerFields,
		readStored: fragment => clampToShapeBounds(shape, upgradeStored(fragment)),
		upgradeStored,
	};
}

/** Each field naming an Event Reference, with its kind. */
function eventReferencesOf(fields: Readonly<Record<string, ScreenModeConfigField>>): Record<string, string> {
	return Object.fromEntries(Object.values(fields)
		.flatMap(field => field.reference === undefined
			? []
			: [
					[field.key, field.reference],
				]));
}

/** Whether `shape` declares the field at `path`, through its nested blocks. */
function shapeHoldsPath(shape: z.ZodRawShape, [key, ...rest]: readonly string[]): boolean {
	const field = key === undefined
		? undefined
		: shape[key] as z.ZodType | undefined;
	if (!field)
		return false;
	if (rest.length === 0)
		return true;
	const inner = unwrapOptionalField(field);
	return inner instanceof z.ZodObject && shapeHoldsPath(inner.shape, rest);
}

/** A copy of `fragment` without the field at `path`, or undefined when it holds none. */
function withoutPath(fragment: unknown, [key, ...rest]: readonly string[]): Record<string, unknown> | undefined {
	if (!isPlainRecord(fragment) || key === undefined || !Object.hasOwn(fragment, key))
		return undefined;
	if (rest.length === 0) {
		const { [key]: _former, ...kept } = fragment;
		return kept;
	}
	const block = withoutPath(fragment[key], rest);
	return block
		? { ...fragment, [key]: block }
		: undefined;
}
