import type { EventListResponse } from '../api';
import type { EventReferenceKind } from './eventReferences';
import { z } from 'zod';

/**
 * The cards of a Screen's settings page, in the order it shows them (#1060):
 * the controls an operator uses during a show; the mode's Event References and
 * data scope; what it shows, in the mode's Screen Settings Groups; its header;
 * its paging; then its Background Layers and placement. A card holding no
 * field it shows is not drawn.
 */
export const SCREEN_SETTINGS_CARDS = [
	'live',
	'source',
	'content',
	'header',
	'paging',
	'background-placement',
] as const;

export type ScreenSettingsCard = typeof SCREEN_SETTINGS_CARDS[number];

export const SCREEN_SETTINGS_CARD_TITLES = {
	'live': 'Live',
	'source': 'Source',
	'content': 'Content',
	'header': 'Header',
	'paging': 'Paging',
	'background-placement': 'Background & Placement',
} as const satisfies Record<ScreenSettingsCard, string>;

/**
 * What a field's editor description may depend on beyond the field itself: the
 * mode's config as the page shows it, the nested block holding the field, the
 * Screen's Event (its Card Game and feature flags; null until it loads), and
 * whether the Event holds a Player List.
 */
export interface ScreenSettingsContext {
	config: Readonly<Record<string, any>>;
	/** The value of the nested block holding the field, for a block's own field. */
	block?: Readonly<Record<string, any>>;
	event: Readonly<Partial<EventListResponse>> | null;
	hasPlayerLists?: boolean;
}

/** A description value, fixed or read from the Screen it describes. */
type Contextual<T> = T | ((context: ScreenSettingsContext) => T);

/** The values a field's options label: an enum's, a list of an enum's, or a column list's keys. */
type OptionValue<Value> = Value extends string
	? Value
	: Value extends readonly (infer Item)[]
		? Item extends string
			? Item
			: Item extends { key: infer Key extends string }
				? Key
				: never
		: never;

/** What each value of a field is called on its control. */
export type OptionLabels<Value extends string = string> = Readonly<Record<Value, string>>;

/**
 * A Screen Settings Group's declaration on its mode's contract: its heading,
 * the card it sits in, and, where it can apply only sometimes, when it shows.
 * A group whose condition is false is hidden with its Look (ADR-0072).
 */
export interface ScreenSettingsGroupDeclaration {
	title: string;
	card: ScreenSettingsCard;
	showWhen?: (context: ScreenSettingsContext) => boolean;
	/**
	 * `row`: the group's fields share one row, which its title names, each
	 * control named by its field's label, as a card badge's show, position and
	 * size do. Absent: a heading over a row per field.
	 */
	layout?: 'row';
}

/**
 * Editor metadata on a config contract field (ADR-0037, #498, #1093): the
 * field's whole editor description, what its control shows that zod checks
 * cannot express. Bounds are not here: they are the schema's own
 * `.min()`/`.max()`, read back, so a range is written once. A default is not
 * here either: it lives only in the contract's `defaults`.
 */
export interface ConfigFieldMeta<Value extends string = string> {
	/** One label per concept, in sentence case: "View", "Sort by", "Limit". */
	label: string;
	/** The label in the Screen's own terms where they differ, such as a Card Game's word for a deck. */
	labelFor?: (context: ScreenSettingsContext) => string;
	card: ScreenSettingsCard;
	/** The Screen Settings Group within the card, one the contract declares. */
	group?: string;
	/** Only where it tells the operator something the label does not. */
	description?: Contextual<string | undefined>;
	/** When the field can have an effect; it is hidden otherwise. Absent, it always shows. */
	showWhen?: (context: ScreenSettingsContext) => boolean;
	/**
	 * What each value is called. Read from the Screen, it names only the values
	 * the Screen offers, such as the sorts its Card Game reads.
	 */
	options?: OptionLabels<Value> | ((context: ScreenSettingsContext) => Partial<OptionLabels<Value>>);
	/** What an empty field shows: Auto, All, the Current Round. */
	placeholder?: string;
	/** The Event Reference kind the field names, set through that kind's picker (ADR-0038). */
	reference?: EventReferenceKind;
	/** The named slot of the bespoke widget that edits it, for a field no plain control can. */
	slot?: string;
	/** What else an edit writing `value` to it writes, such as entering a view starting that view over. */
	writesWith?: (value: unknown, context: ScreenSettingsContext) => Readonly<Record<string, unknown>> | undefined;
	/** A colour string's control, or a nine-point position's. Every other field's is read from its schema. */
	control?: 'color' | 'position';
	step?: number;
	/** Stored units per displayed unit: 1000 for a millisecond field edited in seconds. */
	displayScale?: number;
	/**
	 * A tighter upper bound than the schema's, in stored units, read from the
	 * Screen: a bound that follows the content, such as columns up to the card
	 * count or a card up to the Event Canvas. The schema's bound stays the one a
	 * write is checked against.
	 */
	maxFor?: (context: ScreenSettingsContext) => number | undefined;
}

/** A field's editor description is kept under its own key of zod's metadata, clear of zod's own `description`. */
export const EDITOR_META_KEY = 'screenSettings';

declare const editorFieldBrand: unique symbol;

/** A contract field carrying editor metadata, so its mode's page derives its control, and any Event Reference, from it. */
export type EditorField<S extends z.ZodType, Reference extends EventReferenceKind = never> = S & {
	readonly [editorFieldBrand]: { readonly reference: Reference };
};

/** A field's value with its emptiness peeled: what its options name. */
type FieldValue<S extends z.ZodType> = NonNullable<z.output<S>>;

/**
 * Marks a contract field with its editor description through `.meta()`. Wrap
 * the field whole, `.optional()` and `.nullable()` included, so the metadata
 * stays on the field the contract holds.
 */
export function editorField<S extends z.ZodType, const Reference extends EventReferenceKind = never>(
	schema: S,
	meta: ConfigFieldMeta<OptionValue<FieldValue<S>>> & { reference?: Reference },
): EditorField<S, Reference> {
	return schema.meta({
		[EDITOR_META_KEY]: { ...meta },
	}) as EditorField<S, Reference>;
}

/**
 * A shared field with part of its description given by the mode carrying it,
 * such as when it shows there.
 */
export function withEditorMeta<S extends z.ZodType, Reference extends EventReferenceKind>(
	field: EditorField<S, Reference>,
	meta: Partial<ConfigFieldMeta<OptionValue<FieldValue<S>>>>,
): EditorField<S, Reference> {
	return field.meta({
		[EDITOR_META_KEY]: {
			...fieldMeta(field),
			...meta,
		},
	}) as EditorField<S, Reference>;
}

/** How a field is edited: a plain control by its kind, its Event Reference kind's picker, a nested block's own fields, or a named slot. */
export type ScreenModeConfigControl
	= | 'number'
		| 'toggle'
		| 'select'
		| 'position'
		| 'color'
		| 'text'
		| 'set'
		| 'reference'
		| 'block'
		| 'slot';

/** One contract field as its settings page renders it: where, with what control, label, and bounds in displayed units. */
export interface ScreenModeConfigField {
	key: string;
	label: string;
	labelFor?: (context: ScreenSettingsContext) => string;
	control: ScreenModeConfigControl;
	card: ScreenSettingsCard;
	group?: string;
	description?: Contextual<string | undefined>;
	showWhen?: (context: ScreenSettingsContext) => boolean;
	options?: OptionLabels | ((context: ScreenSettingsContext) => Partial<OptionLabels>);
	placeholder?: string;
	reference?: EventReferenceKind;
	slot?: string;
	writesWith?: (value: unknown, context: ScreenSettingsContext) => Readonly<Record<string, unknown>> | undefined;
	/** Emptied, it writes the `null` that deletes it (ADR-0041): the field is optional or nullable. */
	clearable: boolean;
	min?: number;
	max?: number;
	step?: number;
	/** Stored units per displayed unit; 1 unless the field is edited in another unit. */
	displayScale: number;
	/** A tighter upper bound than `max` read from the Screen, in stored units. */
	maxFor?: (context: ScreenSettingsContext) => number | undefined;
	/** A select's, position's or set's values, which its options must be drawn from. */
	values?: readonly string[];
	/** A nested block's own fields, by their keys within it. */
	fields?: Readonly<Record<string, ScreenModeConfigField>>;
}

type EditorFieldKeys<Shape extends z.ZodRawShape> = {
	[K in keyof Shape]: Shape[K] extends { readonly [editorFieldBrand]: unknown } ? K : never;
}[keyof Shape] & string;

/** The editor fields of a shape: every field it marks with `editorField`. */
export type ScreenModeConfigFields<Shape extends z.ZodRawShape> = {
	readonly [K in EditorFieldKeys<Shape>]: ScreenModeConfigField;
};

type ReferenceOf<Field> = Field extends { readonly [editorFieldBrand]: { readonly reference: infer Reference } }
	? Reference
	: never;

/** A shape's Event References: each field naming a kind, and that kind. */
export type ShapeEventReferences<Shape extends z.ZodRawShape> = {
	readonly [K in keyof Shape as [ReferenceOf<Shape[K]>] extends [never] ? never : K]: ReferenceOf<Shape[K]>;
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
		const meta = (current.meta() as Record<string, unknown> | undefined)?.[EDITOR_META_KEY] as Partial<ConfigFieldMeta> | undefined;
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
		if (def.check === 'greater_than') {
			bounds.min = bounds.min === undefined
				? def.value
				: Math.max(bounds.min, def.value);
		}
		else if (def.check === 'less_than') {
			bounds.max = bounds.max === undefined
				? def.value
				: Math.min(bounds.max, def.value);
		}
	}
	return bounds;
}

function editorFieldView(key: string, field: z.ZodType, meta: ConfigFieldMeta): ScreenModeConfigField {
	const inner = unwrapOptionalField(field);
	const displayScale = meta.displayScale ?? 1;
	const base = {
		key,
		label: meta.label,
		labelFor: meta.labelFor,
		card: meta.card,
		group: meta.group,
		description: meta.description,
		showWhen: meta.showWhen,
		options: meta.options as ScreenModeConfigField['options'],
		placeholder: meta.placeholder,
		reference: meta.reference,
		slot: meta.slot,
		writesWith: meta.writesWith,
		clearable: inner !== field,
		displayScale,
	};
	if (meta.slot !== undefined)
		return { ...base, control: 'slot' };
	if (meta.reference !== undefined)
		return { ...base, control: 'reference' };
	if (inner instanceof z.ZodObject) {
		return {
			...base,
			control: 'block',
			fields: screenModeConfigFields(inner.shape),
		};
	}
	if (inner instanceof z.ZodArray && inner.element instanceof z.ZodEnum) {
		return {
			...base,
			control: 'set',
			values: inner.element.options.map(String),
		};
	}
	if (inner instanceof z.ZodNumber) {
		const { min, max } = inclusiveNumberBounds(inner);
		return {
			...base,
			control: 'number',
			min: min === undefined
				? undefined
				: min / displayScale,
			max: max === undefined
				? undefined
				: max / displayScale,
			step: meta.step,
			maxFor: meta.maxFor,
		};
	}
	if (inner instanceof z.ZodBoolean)
		return { ...base, control: 'toggle' };
	if (inner instanceof z.ZodEnum) {
		return {
			...base,
			control: meta.control === 'position'
				? 'position'
				: 'select',
			values: inner.options.map(String),
		};
	}
	if (inner instanceof z.ZodString) {
		return {
			...base,
			control: meta.control === 'color'
				? 'color'
				: 'text',
		};
	}
	throw new Error(`Editor field "${key}" has no plain control: name the slot of the bespoke widget that edits it (#1093).`);
}

/**
 * Refuses a field, nested blocks' included, naming a Screen Settings Group its
 * contract does not declare, or one declared in another card.
 */
export function assertFieldGroupsDeclared(
	fields: Readonly<Record<string, ScreenModeConfigField>>,
	groups: Readonly<Record<string, ScreenSettingsGroupDeclaration>>,
	path: readonly string[] = [],
): void {
	for (const field of Object.values(fields)) {
		const name = [...path, field.key].join('.');
		if (field.group !== undefined) {
			const group = Object.hasOwn(groups, field.group)
				? groups[field.group]
				: undefined;
			if (!group)
				throw new Error(`Config field "${name}" names the settings group "${field.group}", which its contract does not declare.`);
			if (group.card !== field.card)
				throw new Error(`Config field "${name}" sits in the ${field.card} card, but its group "${field.group}" is in the ${group.card} card.`);
		}
		if (field.fields)
			assertFieldGroupsDeclared(field.fields, groups, [...path, field.key]);
	}
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
