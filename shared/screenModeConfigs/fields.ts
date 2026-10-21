import { z } from 'zod';

/**
 * Editor metadata on a config contract field (ADR-0037, #498): what the field's
 * editor control shows that zod checks cannot express. Bounds are not here: they
 * are the schema's own `.min()`/`.max()`, read back, so a range is written once.
 * A default is not here either: it lives only in the contract's `defaults`.
 */
export interface ConfigFieldMeta {
	label: string;
	/** A colour string's control; any other string is a text input. Every other field's is read from its schema. */
	control?: 'color';
	step?: number;
	/** Stored units per displayed unit: 1000 for a millisecond field edited in seconds. */
	displayScale?: number;
}

declare const editorFieldBrand: unique symbol;

/** A contract field carrying editor metadata, so its mode's editor derives its control from it. */
export type EditorField<S extends z.ZodType> = S & { readonly [editorFieldBrand]: true };

/**
 * Marks a contract field as edited by a scalar control and gives that control its
 * label and hints through `.meta()`. Wrap the field whole, `.optional()` and
 * `.nullable()` included, so the metadata stays on the field the contract holds.
 */
export function editorField<S extends z.ZodType>(schema: S, meta: ConfigFieldMeta): EditorField<S> {
	return schema.meta({ ...meta }) as EditorField<S>;
}

/** One contract field as its editor control renders it: kind, label, and bounds in displayed units. */
export interface ScreenModeConfigField {
	key: string;
	label: string;
	control: 'number' | 'toggle' | 'select' | 'color' | 'text';
	min?: number;
	max?: number;
	step?: number;
	/** Stored units per displayed unit; 1 unless the field is edited in another unit. */
	displayScale: number;
	/** A select's values, which the editor's options must be drawn from. */
	values?: readonly string[];
}

type EditorFieldKeys<Shape extends z.ZodRawShape> = {
	[K in keyof Shape]: Shape[K] extends { readonly [editorFieldBrand]: true } ? K : never;
}[keyof Shape] & string;

/** The editor fields of a shape: every field it marks with `editorField`. */
export type ScreenModeConfigFields<Shape extends z.ZodRawShape> = {
	readonly [K in EditorFieldKeys<Shape>]: ScreenModeConfigField;
};

/** The schema under a field's `.optional()` and `.nullable()`: where its checks live. */
export function unwrapOptionalField(field: z.ZodType): z.ZodType {
	let inner = field;
	while (inner instanceof z.ZodOptional || inner instanceof z.ZodNullable)
		inner = inner.unwrap() as z.ZodType;
	return inner;
}

function fieldMeta(field: z.ZodType): ConfigFieldMeta | undefined {
	let current: z.ZodType = field;
	for (;;) {
		const meta = current.meta() as Partial<ConfigFieldMeta> | undefined;
		if (typeof meta?.label === 'string')
			return meta as ConfigFieldMeta;
		if (!(current instanceof z.ZodOptional || current instanceof z.ZodNullable))
			return undefined;
		current = current.unwrap() as z.ZodType;
	}
}

/**
 * A number schema's inclusive bounds. An exclusive bound (`.positive()`) has no
 * nearest allowed value to offer or clamp to, so it is not read as one.
 */
function inclusiveNumberBounds(schema: z.ZodNumber): { min?: number; max?: number } {
	const bounds: { min?: number; max?: number } = {};
	for (const check of schema.def.checks ?? []) {
		const def = check._zod.def as { check: string; value?: unknown; inclusive?: boolean };
		if (def.inclusive !== true || typeof def.value !== 'number')
			continue;
		if (def.check === 'greater_than')
			bounds.min = bounds.min === undefined ? def.value : Math.max(bounds.min, def.value);
		else if (def.check === 'less_than')
			bounds.max = bounds.max === undefined ? def.value : Math.min(bounds.max, def.value);
	}
	return bounds;
}

function editorFieldView(key: string, field: z.ZodType, meta: ConfigFieldMeta): ScreenModeConfigField {
	const inner = unwrapOptionalField(field);
	const displayScale = meta.displayScale ?? 1;
	const base = { key, label: meta.label, displayScale };
	if (inner instanceof z.ZodNumber) {
		const { min, max } = inclusiveNumberBounds(inner);
		return {
			...base,
			control: 'number',
			min: min === undefined ? undefined : min / displayScale,
			max: max === undefined ? undefined : max / displayScale,
			step: meta.step,
		};
	}
	if (inner instanceof z.ZodBoolean)
		return { ...base, control: 'toggle' };
	if (inner instanceof z.ZodEnum)
		return { ...base, control: 'select', values: inner.options.map(String) };
	if (inner instanceof z.ZodString)
		return { ...base, control: meta.control ?? 'text' };
	throw new Error(`Editor field "${key}" is not a scalar: give a rich field a bespoke control instead (#498).`);
}

/**
 * The editor-facing view of a shape's editor fields, read from the schema itself,
 * so a bound changed there is the one the editor offers. The generalisation of
 * `animationEffectParamFields` to config contracts, which keep their defaults
 * outside the schema.
 */
export function screenModeConfigFields<Shape extends z.ZodRawShape>(shape: Shape): ScreenModeConfigFields<Shape> {
	const fields: Record<string, ScreenModeConfigField> = {};
	for (const [key, field] of Object.entries(shape)) {
		const meta = fieldMeta(field as z.ZodType);
		if (meta)
			fields[key] = editorFieldView(key, field as z.ZodType, meta);
	}
	return fields as ScreenModeConfigFields<Shape>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A stored fragment read within its shape's bounds: every number outside its
 * field's inclusive bounds becomes the nearest bound, inside nested blocks too.
 *
 * It exists because a bound can tighten after a Screen stored a value outside it
 * (#498). Production holds real data, so that value reads as the nearest value the
 * contract now accepts, never as the default, and the read is never refused. Only
 * reads clamp: a write outside the bounds is still refused by the schema.
 *
 * Anything it cannot clamp is the reader's to complete or ignore, as before: a
 * value of another type, an exclusive bound, a key the shape does not have, and
 * a union or list. A fragment already in bounds is returned as it is.
 */
export function clampToShapeBounds<T extends Record<string, unknown>>(shape: z.ZodRawShape, fragment: T): T {
	let clamped: Record<string, unknown> | undefined;
	for (const [key, value] of Object.entries(fragment)) {
		const field = shape[key] as z.ZodType | undefined;
		if (!field)
			continue;
		const inner = unwrapOptionalField(field);
		let next: unknown = value;
		if (inner instanceof z.ZodNumber && typeof value === 'number' && Number.isFinite(value)) {
			const { min, max } = inclusiveNumberBounds(inner);
			next = Math.min(max ?? value, Math.max(min ?? value, value));
		}
		else if (inner instanceof z.ZodObject && isPlainObject(value)) {
			next = clampToShapeBounds(inner.shape, value);
		}
		if (next !== value) {
			clamped ??= { ...fragment };
			clamped[key] = next;
		}
	}
	return (clamped ?? fragment) as T;
}
