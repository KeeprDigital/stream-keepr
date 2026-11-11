import type { ScreenModeConfigField, ScreenSettingsCard, ScreenSettingsContext, ScreenSettingsGroupDeclaration } from '~~/shared/screenModeConfigs/fields';
import type { PageRotationMode } from '~~/shared/screenModes';
import type { ScreenMode } from '~~/shared/types/enums';
import type { PagedModeData } from './pagedModeData';
import type { RotationConfigWrites } from './rotationWrites';
import { SCREEN_SETTINGS_CARD_TITLES, SCREEN_SETTINGS_CARDS } from '~~/shared/screenModeConfigs/fields';
import { SCREEN_MODES, screenModeConfigContract } from '~~/shared/screenModes';
import { placeScreenThemeTokens } from '~~/shared/screenThemeOverrides';

/**
 * A Screen Mode's settings page as its contract and Mode Tokens describe it
 * (#1060, #1094): the fixed cards in order, each holding the fields it shows,
 * in its Screen Settings Groups, then the Mode Tokens of those groups in the
 * card's Look. A field or group whose condition is false is left out, never
 * disabled; a card holding nothing is left out.
 */

/** One field the page shows: its path (a nested block's field under the block's key) and the context its description reads. */
export interface SettingsPageField {
	path: readonly string[];
	field: ScreenModeConfigField;
	context: ScreenSettingsContext;
}

/** A row of a card: one field's control, or one named slot holding the bespoke widget of every field naming it. */
export type SettingsPageRow
	= | { kind: 'field'; key: string; entry: SettingsPageField }
		| { kind: 'slot'; key: string; slot: string; fields: SettingsPageField[] };

/** A run of a card's rows: its ungrouped fields, or one Screen Settings Group's. */
export interface SettingsPageSection {
	group?: { id: string; title: string };
	rows: SettingsPageRow[];
}

/** One Screen Settings Group's Look: the Mode Tokens naming it. */
export interface SettingsPageLook {
	group: string;
	title: string;
	tokens: readonly string[];
}

export interface SettingsPageCard {
	card: ScreenSettingsCard;
	title: string;
	sections: SettingsPageSection[];
	looks: SettingsPageLook[];
}

/** What a mode's own widget mounted in a named slot of the generic renderer is given. */
export interface ScreenModeSettingsSlotProps {
	/** The shown fields naming the slot in its card. */
	fields: SettingsPageField[];
	/** The mode's config as the page shows it. */
	config: Readonly<Record<string, any>>;
	context: ScreenSettingsContext;
	/** Writes a patch of the mode's config through the page's one write path. */
	update: (patch: Record<string, unknown>) => void;
	/** A paginated mode's Page Rotation writes. */
	rotation: RotationConfigWrites<any> | undefined;
	/** A paginated mode's data, as its Screen Output reads it. */
	data: PagedModeData | undefined;
}

/** Whether `mode` pages its rows: its Screen Mode Definition declares a Page Rotation (ADR-0039). */
export function isPageRotationMode(mode: ScreenMode): mode is PageRotationMode {
	return SCREEN_MODES[mode].pageRotation !== undefined;
}

function isRecord(value: unknown): value is Record<string, any> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Every field a contract declares, a nested block's own fields in place of the block, in declaration order. */
function shownFields(
	fields: Readonly<Record<string, ScreenModeConfigField>>,
	context: ScreenSettingsContext,
	defaults: Readonly<Record<string, unknown>>,
	path: readonly string[] = [],
): SettingsPageField[] {
	return Object.values(fields).flatMap((field) => {
		if (field.showWhen && !field.showWhen(context))
			return [];
		const fieldPath = [...path, field.key];
		if (field.control === 'block' && field.fields) {
			const stored = context.config[field.key];
			const block = isRecord(stored)
				? stored
				: isRecord(defaults[field.key])
					? defaults[field.key] as Record<string, any>
					: {};
			return shownFields(field.fields, { ...context, block }, {}, fieldPath);
		}
		return [
			{ path: fieldPath, field, context },
		];
	});
}

/** The page `mode`'s contract describes, as the Screen and its Event read now. */
export function settingsPageCards(mode: ScreenMode, context: ScreenSettingsContext): SettingsPageCard[] {
	const contract = screenModeConfigContract(mode);
	const groups = contract.groups as Readonly<Record<string, ScreenSettingsGroupDeclaration>>;
	const shownGroup = (id: string) => {
		const group = groups[id];
		return group !== undefined && (group.showWhen?.(context) ?? true);
	};
	const fields = shownFields(
		contract.fields as Readonly<Record<string, ScreenModeConfigField>>,
		context,
		contract.defaults as Readonly<Record<string, unknown>>,
	).filter(entry => entry.field.group === undefined || shownGroup(entry.field.group));
	const tokens = placeScreenThemeTokens(mode).groups;

	return SCREEN_SETTINGS_CARDS.flatMap((card): SettingsPageCard[] => {
		const sectionIds = [
			undefined,
			...Object.keys(groups).filter(id => groups[id]!.card === card),
		];
		const sections = sectionIds.flatMap((group): SettingsPageSection[] => {
			const rows: SettingsPageRow[] = [];
			for (const entry of fields) {
				if (entry.field.card !== card || entry.field.group !== group)
					continue;
				const slot = entry.field.slot;
				if (slot === undefined) {
					rows.push({
						kind: 'field',
						key: entry.path.join('.'),
						entry,
					});
					continue;
				}
				const held = rows.find(row => row.kind === 'slot' && row.slot === slot);
				if (held?.kind === 'slot') {
					held.fields.push(entry);
				}
				else {
					rows.push({
						kind: 'slot',
						key: `slot:${slot}`,
						slot,
						fields: [entry],
					});
				}
			}
			if (rows.length === 0)
				return [];
			return [
				{
					group: group === undefined
						? undefined
						: { id: group, title: groups[group]!.title },
					rows,
				},
			];
		});
		const looks = Object.keys(groups)
			.filter(id => groups[id]!.card === card && shownGroup(id) && (tokens[id]?.length ?? 0) > 0)
			.map(id => ({ group: id, title: groups[id]!.title, tokens: tokens[id]! }));
		if (sections.length === 0 && looks.length === 0)
			return [];
		return [
			{
				card,
				title: SCREEN_SETTINGS_CARD_TITLES[card],
				sections,
				looks,
			},
		];
	});
}

/** What a field's description reads for the Screen it describes. */
export function fieldDescription(entry: SettingsPageField): string | undefined {
	const { description } = entry.field;
	return typeof description === 'function'
		? description(entry.context)
		: description;
}

/** What a field is labelled on this Screen. */
export function fieldLabel(entry: SettingsPageField): string {
	return entry.field.labelFor?.(entry.context) ?? entry.field.label;
}

/** A select's labelled options, in the order its values run, or none where the field labels none. */
export function fieldOptions(entry: SettingsPageField): { label: string; value: string }[] | undefined {
	const { options, values } = entry.field;
	if (!options)
		return undefined;
	const labels = typeof options === 'function'
		? options(entry.context)
		: options;
	const ordered = values ?? Object.keys(labels);
	return ordered.flatMap((value) => {
		const label = (labels as Partial<Record<string, string>>)[value];
		return label === undefined
			? []
			: [
					{ label, value },
				];
	});
}

/** The value a field holds: a nested block's field read from its block. */
export function fieldValue(entry: SettingsPageField): unknown {
	const [key, inner] = entry.path;
	return inner === undefined
		? entry.context.config[key!]
		: entry.context.block?.[inner];
}

/**
 * The patch writing `value` to a field: its own key, or its block rewritten
 * whole with it, `null` deleting it there as at the top level (ADR-0041).
 */
export function fieldPatch(entry: SettingsPageField, value: unknown): Record<string, unknown> {
	const [key, inner] = entry.path;
	return inner === undefined
		? { [key!]: value }
		: {
				[key!]: { ...entry.context.block, [inner]: value },
			};
}

/** "Show deck names" read as "Deck names": what a closed card's summary lists of a toggle that is on. */
function shownLabel(label: string): string {
	const shown = label.replace(/^Show /, '');
	return shown.charAt(0).toUpperCase() + shown.slice(1);
}

/** A card's plain fields as one line: the toggles that are on, each select's choice, each number set. */
export function cardFieldsSummary(card: SettingsPageCard): string[] {
	return card.sections.flatMap(section => section.rows).flatMap((row) => {
		if (row.kind !== 'field')
			return [];
		const { entry } = row;
		const value = fieldValue(entry);
		switch (entry.field.control) {
			case 'toggle':
				return value === true
					? [
							shownLabel(fieldLabel(entry)),
						]
					: [];
			case 'select':
				return value === undefined || value === null
					? []
					: [fieldOptions(entry)?.find(option => option.value === value)?.label ?? String(value)];
			case 'number':
				return typeof value === 'number'
					? [`${fieldLabel(entry)}: ${value / entry.field.displayScale}`]
					: [];
			default:
				return [];
		}
	});
}
