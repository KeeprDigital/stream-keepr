import type { ScreenModeConfigField, ScreenSettingsContext, ScreenSettingsGroupDeclaration } from '~~/shared/screenModeConfigs/fields';
import type { ScreenMode } from '~~/shared/types/enums';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { SCREEN_SETTINGS_CARDS, unwrapOptionalField } from '~~/shared/screenModeConfigs/fields';
import { screenModeConfigContract } from '~~/shared/screenModes';
import { SCREEN_MODE_VALUES } from '~~/shared/types/enums';

// A Screen's settings page renders from its mode's contract, so every
// field says where it sits and how it is edited, and a page shows one label per
// concept.

/** Every field of a mode's contract, nested blocks' included, by path. */
function everyField(mode: ScreenMode): Map<string, ScreenModeConfigField> {
	const found = new Map<string, ScreenModeConfigField>();
	const visit = (fields: Readonly<Record<string, ScreenModeConfigField>>, path: string[]) => {
		for (const field of Object.values(fields)) {
			found.set([...path, field.key].join('.'), field);
			if (field.fields)
				visit(field.fields, [...path, field.key]);
		}
	};
	visit(screenModeConfigContract(mode).fields as Record<string, ScreenModeConfigField>, []);
	return found;
}

/**
 * Every field path a mode's shape declares, through each block it edits by its
 * own fields; a slot's widget edits its object whole.
 */
function everyShapePath(shape: z.ZodRawShape, fields: Readonly<Record<string, ScreenModeConfigField>>, path: string[] = []): string[] {
	return Object.entries(shape).flatMap(([key, field]) => {
		const inner = unwrapOptionalField(field as z.ZodType);
		const nested = fields[key]?.fields;
		return [
			[...path, key].join('.'),
			...(inner instanceof z.ZodObject && fields[key]?.control !== 'slot'
				? everyShapePath(inner.shape, nested ?? {}, [...path, key])
				: []),
		];
	});
}

describe.each(SCREEN_MODE_VALUES)('the %s config contract', (mode) => {
	it('describes every field, nested blocks\' included, with its settings card', () => {
		const fields = everyField(mode);
		const contract = screenModeConfigContract(mode);

		expect([
			...fields.keys(),
		]).toEqual(everyShapePath(contract.shape, contract.fields as Record<string, ScreenModeConfigField>));
		for (const [path, field] of fields)
			expect(SCREEN_SETTINGS_CARDS, path).toContain(field.card);
	});

	it('qualifies a label it repeats by a different group heading on each', () => {
		const placed = new Map<string, string>();
		for (const [path, field] of everyField(mode)) {
			const where = `${field.card}/${field.group ?? ''}/${field.label}`;
			expect(placed.get(where), `${path} repeats ${placed.get(where)}'s label in one place`).toBeUndefined();
			placed.set(where, path);
		}
	});
});

/** A settings context for an Event of `game` with `flags`. */
function context(config: Record<string, unknown>, event: ScreenSettingsContext['event'] = { game: 'mtg' }, extra: Partial<ScreenSettingsContext> = {}): ScreenSettingsContext {
	return { config, event, ...extra };
}

/** Whether `path`'s field shows on a page of `mode`, under `settings`: its own condition and its group's. */
function shows(mode: ScreenMode, path: string, settings: ScreenSettingsContext): boolean {
	const field = everyField(mode).get(path);
	expect(field, `${mode} declares ${path}`).toBeDefined();
	const groups = screenModeConfigContract(mode).groups as Record<string, ScreenSettingsGroupDeclaration>;
	const group = field!.group === undefined
		? undefined
		: groups[field!.group];
	return (group?.showWhen?.(settings) ?? true) && (field!.showWhen?.(settings) ?? true);
}

// A control that cannot have an effect is hidden, on the field that cannot.
describe('when a settings field shows', () => {
	it.each([
		[
			'standings',
			'rangeEnd',
			'in the range view',
			context({ viewMode: 'range' }),
			true,
		],
		[
			'standings',
			'rangeEnd',
			'outside the range view',
			context({ viewMode: 'all' }),
			false,
		],
		[
			'standings',
			'playerListId',
			'in the watchlist view',
			context({ viewMode: 'watchlist' }),
			true,
		],
		[
			'standings',
			'revealOrder',
			'outside the reveal view',
			context({ viewMode: 'range' }),
			false,
		],
		[
			'standings',
			'showArchetypeColors',
			'beside a shown deck column',
			context({
				columns: [
					{ key: 'deck', visible: true },
				],
			}),
			true,
		],
		[
			'standings',
			'showArchetypeColors',
			'without the deck column',
			context({
				columns: [
					{ key: 'deck', visible: false },
				],
			}),
			false,
		],
		[
			'metagame',
			'archetypeId',
			'in the cards view',
			context({ viewMode: 'cards' }),
			true,
		],
		[
			'metagame',
			'archetypeId',
			'in the archetype view',
			context({ viewMode: 'archetype' }),
			false,
		],
		[
			'metagame',
			'pageSize',
			'in the chart view',
			context({ viewMode: 'chart' }),
			false,
		],
		[
			'top-cards',
			'minPoints',
			'under the Minimum points scope',
			context({ scope: 'minPoints' }),
			true,
		],
		[
			'top-cards',
			'pointedOnly',
			'for an Event with a points system',
			context({ pointedOnly: false }, { game: 'mtg', pointsSystem: '7ph' }),
			true,
		],
		[
			'top-cards',
			'pointedOnly',
			'without one, while it is off',
			context({ pointedOnly: false }, { game: 'mtg', pointsSystem: null }),
			false,
		],
		[
			'top-cards',
			'pointedOnly',
			'without one, while it is on, so it can be turned off',
			context({ pointedOnly: true }, { game: 'mtg', pointsSystem: null }),
			true,
		],
		[
			'head-to-head',
			'showPronouns',
			'for an Event showing pronouns',
			context({}, { game: 'mtg', pronounsEnabled: true }),
			true,
		],
		[
			'head-to-head',
			'showPronouns',
			'for an Event without pronouns',
			context({}, { game: 'mtg', pronounsEnabled: false }),
			false,
		],
		[
			'head-to-head',
			'player1Id',
			'when the Players are picked',
			context({ playerSource: 'players' }),
			true,
		],
		[
			'head-to-head',
			'featureMatchId',
			'when the Players are picked',
			context({ playerSource: 'players' }),
			false,
		],
		[
			'top-cut',
			'bracketSource',
			'for a Magic Event',
			context({}),
			true,
		],
		[
			'top-cut',
			'bracketSource',
			'for a One Piece Event, which holds no Phases',
			context({}, { game: 'op' }),
			false,
		],
		[
			'top-cut',
			'playerNameShown',
			'for a One Piece Event',
			context({}, { game: 'op' }),
			true,
		],
		[
			'top-cut',
			'phaseId',
			'for a One Piece Event',
			context({ bracketSource: 'phase' }, { game: 'op' }),
			false,
		],
		[
			'round-clock',
			'countUpLimitMinutes',
			'while counting up',
			context({ countUpAfterEnd: true }),
			true,
		],
		[
			'round-clock',
			'countUpLimitMinutes',
			'while holding 0:00',
			context({ countUpAfterEnd: false }),
			false,
		],
		[
			'talent',
			'talentIds',
			'for a lineup',
			context({ selection: 'lineup' }),
			true,
		],
		[
			'talent',
			'talentId',
			'for a lineup',
			context({ selection: 'lineup' }),
			false,
		],
		[
			'feature-match',
			'showLgs',
			'for an Event tracking LGS',
			context({}, { game: 'mtg', lgsEnabled: true }),
			true,
		],
		[
			'feature-match',
			'showLgs',
			'for an Event not tracking it',
			context({}, { game: 'mtg', lgsEnabled: false }),
			false,
		],
		[
			'feature-match',
			'allowLifeControls',
			'for a Card Game without life totals',
			context({}, { game: 'op' }),
			false,
		],
		[
			'deck',
			'mainboard.listColumns',
			'for a list board',
			context({}, { game: 'mtg' }, {
				block: { view: 'list' },
			}),
			true,
		],
		[
			'deck',
			'mainboard.columns',
			'for a list board',
			context({}, { game: 'mtg' }, {
				block: { view: 'list' },
			}),
			false,
		],
		[
			'deck',
			'sideboard.stackReveal',
			'for a stacked board',
			context({}, { game: 'mtg' }, {
				block: { view: 'stack' },
			}),
			true,
		],
		[
			'deck',
			'showHighlanderTotal',
			'for a Broadcast Deck List',
			context({
				deckSource: { type: 'broadcast', broadcastDeckListId: 1 },
			}, { game: 'mtg', pointsSystem: '7ph' }),
			false,
		],
		[
			'deck',
			'showHighlanderPoints',
			'for an Event with a points system',
			context({}, { game: 'mtg', pointsSystem: '7ph' }),
			true,
		],
		[
			'deck',
			'showHighlanderPoints',
			'for an Event without one',
			context({}, { game: 'mtg', pointsSystem: null }),
			false,
		],
		[
			'deck',
			'sideboard',
			'while the Screen shows both boards',
			context({ board: 'full' }),
			true,
		],
		[
			'deck',
			'sideboard',
			'while the Screen shows the mainboard alone',
			context({ board: 'mainboard' }),
			false,
		],
		[
			'deck',
			'mainboard',
			'while the Screen shows both boards',
			context({ board: 'full' }),
			true,
		],
		[
			'deck',
			'mainboard',
			'while the Screen shows the sideboard alone',
			context({ board: 'sideboard' }),
			false,
		],
		[
			'deck',
			'sideboard.columns',
			'for a sideboard storing its own layout',
			context({}, { game: 'mtg' }, {
				block: { view: 'grid', columns: 3 },
			}),
			true,
		],
		[
			'deck',
			'sideboard.columns',
			'for a sideboard following the mainboard\'s',
			context({}, { game: 'mtg' }, {
				block: { view: 'grid' },
			}),
			false,
		],
		[
			'pairings',
			'headerText',
			'while the header shows',
			context({ showHeader: true }),
			true,
		],
		[
			'pairings',
			'headerText',
			'while the header is hidden',
			context({ showHeader: false }),
			false,
		],
		[
			'pairings',
			'autoPageIntervalMs',
			'while auto-paging',
			context({ autoPageEnabled: true }),
			true,
		],
		[
			'pairings',
			'autoPageIntervalMs',
			'while paged by hand',
			context({ autoPageEnabled: false }),
			false,
		],
		[
			'head-to-head',
			'featureMatchId',
			'when the Players are a Slot\'s',
			context({ playerSource: 'featureMatchSlot' }),
			true,
		],
		[
			'head-to-head',
			'player1Id',
			'when the Players are a Slot\'s',
			context({ playerSource: 'featureMatchSlot' }),
			false,
		],
		[
			'head-to-head',
			'player2Id',
			'when the Players are picked',
			context({ playerSource: 'players' }),
			true,
		],
		[
			'head-to-head',
			'player2Id',
			'when the Players are a Slot\'s',
			context({ playerSource: 'featureMatchSlot' }),
			false,
		],
		[
			'feature-match',
			'showPronouns',
			'for an Event showing pronouns',
			context({}, { game: 'mtg', pronounsEnabled: true }),
			true,
		],
		[
			'feature-match',
			'showPronouns',
			'for an Event without pronouns',
			context({}, { game: 'mtg', pronounsEnabled: false }),
			false,
		],
		[
			'feature-match',
			'showRecords',
			'for an Event with standings',
			context({}, { game: 'mtg', standingsEnabled: true }),
			true,
		],
		[
			'feature-match',
			'showRecords',
			'for an Event without standings',
			context({}, { game: 'mtg', standingsEnabled: false }),
			false,
		],
		[
			'feature-match',
			'showTableNumber',
			'for an Event numbering its tables',
			context({}, { game: 'mtg', tableNumberEnabled: true }),
			true,
		],
		[
			'feature-match',
			'showTableNumber',
			'for an Event that does not',
			context({}, { game: 'mtg', tableNumberEnabled: false }),
			false,
		],
		[
			'feature-match',
			'showTurnControls',
			'for an Event tracking the active player alone',
			context({}, {
				game: 'mtg',
				featureMatchDefaultTurnTrackingEnabled: false,
				featureMatchDefaultActivePlayerTrackingEnabled: true,
			}),
			true,
		],
		[
			'feature-match',
			'showTurnControls',
			'for an Event tracking neither turns nor the active player',
			context({}, {
				game: 'mtg',
				featureMatchDefaultTurnTrackingEnabled: false,
				featureMatchDefaultActivePlayerTrackingEnabled: false,
			}),
			false,
		],
		[
			'feature-match',
			'showOvertime',
			'for an Event with extra turns',
			context({}, { game: 'mtg', featureMatchDefaultExtraTurnsEnabled: true }),
			true,
		],
		[
			'feature-match',
			'showOvertime',
			'for an Event without extra turns',
			context({}, { game: 'mtg', featureMatchDefaultExtraTurnsEnabled: false }),
			false,
		],
		[
			'feature-match',
			'showOvertime',
			'for a Card Game without overtime, whatever the Event says',
			context({}, { game: 'op', featureMatchDefaultExtraTurnsEnabled: true }),
			false,
		],
		[
			'feature-match',
			'showMulliganInfo',
			'for an Event tracking mulligans',
			context({}, { game: 'mtg', featureMatchDefaultMulliganTrackingEnabled: true }),
			true,
		],
		[
			'feature-match',
			'showMulliganInfo',
			'for an Event not tracking them',
			context({}, { game: 'mtg', featureMatchDefaultMulliganTrackingEnabled: false }),
			false,
		],
		[
			'talent',
			'talentId',
			'for one Talent',
			context({ selection: 'one' }),
			true,
		],
		[
			'talent',
			'talentIds',
			'for one Talent',
			context({ selection: 'one' }),
			false,
		],
		[
			'talent',
			'socialProfileDwellMs',
			'while its Social Profiles rotate',
			context({ rotateSocialProfiles: true }),
			true,
		],
		[
			'talent',
			'socialProfileDwellMs',
			'while they do not',
			context({ rotateSocialProfiles: false }),
			false,
		],
		[
			'top-cut',
			'phaseId',
			'for a Magic Event reading a Phase',
			context({ bracketSource: 'phase' }),
			true,
		],
		[
			'top-cut',
			'manualBracket',
			'for a Magic Event reading a Phase',
			context({ bracketSource: 'phase' }),
			false,
		],
		[
			'top-cut',
			'manualBracket',
			'for a Magic Event with a Manual Bracket',
			context({ bracketSource: 'manual' }),
			true,
		],
		[
			'top-cut',
			'manualBracket',
			'for a One Piece Event, whatever source it stores',
			context({ bracketSource: 'phase' }, { game: 'op' }),
			true,
		],
	] as const)('%s %s %s: %s', (mode, path, _when, settings, shown) => {
		expect(shows(mode, path, settings)).toBe(shown);
	});
});
