import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { defineScreenModeConfigContract } from '~~/shared/screenModeConfigs/contract';
import { editorField } from '~~/shared/screenModeConfigs/fields';
import { columnConfigSchema } from '~~/shared/screenModeConfigs/subShapes';

// A contract field's editor metadata (ADR-0037) is its control's only source of label, bounds and step.
describe('a config contract\'s editor fields', () => {
	const contract = defineScreenModeConfigContract({
		scale: editorField(z.number().min(0.5).max(2).optional(), { label: 'Card scale', card: 'content', step: 0.1 }),
		columns: editorField(z.number().int().min(1).max(12), { label: 'Columns', card: 'content' }),
		intervalMs: editorField(z.number().int().min(3000).max(60000), { label: 'Interval (seconds)', card: 'paging', displayScale: 1000 }),
		maxTableWidth: editorField(z.number().int().min(1).nullable().optional(), { label: 'Max table width', card: 'content' }),
		enabled: editorField(z.boolean(), { label: 'Animate', card: 'content' }),
		speed: editorField(z.enum(['slow', 'normal', 'fast']).optional(), { label: 'Animation speed', card: 'content' }),
		textColor: editorField(z.string().max(50).optional(), { label: 'Text colour', card: 'content', control: 'color' }),
		headerText: editorField(z.string().max(200).optional(), { label: 'Header text', card: 'header' }),
		featureMatchId: z.number().int().positive().nullable(),
	}, {
		scale: 1,
		columns: 4,
		intervalMs: 10000,
		maxTableWidth: null,
		enabled: true,
		speed: 'normal',
		textColor: '#ffffff',
		headerText: undefined,
		featureMatchId: null,
	});

	it('reads a number field\'s label, inclusive bounds and step from its schema and metadata', () => {
		expect(contract.fields.scale).toEqual({
			key: 'scale',
			label: 'Card scale',
			control: 'number',
			card: 'content',
			clearable: true,
			min: 0.5,
			max: 2,
			step: 0.1,
			displayScale: 1,
		});
		expect(contract.fields.columns).toMatchObject({
			control: 'number',
			min: 1,
			max: 12,
			step: undefined,
		});
		expect(contract.fields.maxTableWidth).toMatchObject({ control: 'number', min: 1, max: undefined });
	});

	it('offers a field edited in another unit in that unit', () => {
		expect(contract.fields.intervalMs).toMatchObject({ min: 3, max: 60, displayScale: 1000 });
	});

	it('reads the control kind from the schema, and a string\'s from its metadata', () => {
		expect(contract.fields.enabled).toMatchObject({ label: 'Animate', control: 'toggle' });
		expect(contract.fields.speed).toMatchObject({
			label: 'Animation speed',
			control: 'select',
			values: ['slow', 'normal', 'fast'],
		});
		expect(contract.fields.textColor).toMatchObject({ label: 'Text colour', card: 'content', control: 'color' });
		expect(contract.fields.headerText).toMatchObject({ label: 'Header text', control: 'text' });
	});

	it('derives no editor field for a field without editor metadata', () => {
		expect(Object.keys(contract.fields)).not.toContain('featureMatchId');
		// @ts-expect-error — `featureMatchId` carries no editor metadata, so it has no editor field
		expect(contract.fields.featureMatchId).toBeUndefined();
	});

	it('keeps defaults out of the schema: an editor field may still not carry a zod default', () => {
		expect(() =>
			defineScreenModeConfigContract({
				// @ts-expect-error — a default lives only in the contract's defaults
				topN: editorField(z.number().default(8), { label: 'Top N', card: 'source' }),
			}, { topN: 8 }),
		).toThrow();
	});
});

// A contract field carries its whole editor description: where it sits on
// the settings page, what it offers, and what it references, so a page renders
// from the contract alone.
describe('a config contract field\'s editor description', () => {
	const boardShape = {
		view: editorField(z.enum(['grid', 'list']).optional(), { label: 'View', card: 'content', group: 'board' }),
		listColumns: editorField(z.number().int().min(1).max(4).optional(), { label: 'List columns', card: 'content', group: 'board' }),
	};
	const contract = defineScreenModeConfigContract({
		roundId: editorField(z.number().int().positive().optional(), {
			label: 'Round',
			card: 'source',
			reference: 'round',
			placeholder: 'Current Round',
		}),
		view: editorField(z.enum(['all', 'range']), {
			label: 'View',
			card: 'source',
			options: { all: 'All', range: 'Position range' },
		}),
		badgePosition: editorField(z.enum(['top-left', 'top-right']), {
			label: 'Badge position',
			card: 'content',
			group: 'badge',
			control: 'position',
			description: 'Where the badge sits on its card.',
		}),
		networks: editorField(z.array(z.enum(['x', 'bluesky'])), {
			label: 'Networks',
			card: 'content',
			group: 'badge',
			options: { x: 'X', bluesky: 'Bluesky' },
		}),
		columns: editorField(z.array(columnConfigSchema(['name', 'points'])), {
			label: 'Columns',
			card: 'content',
			slot: 'columns',
			options: { name: 'Name', points: 'Points' },
		}),
		board: editorField(z.object(boardShape).strict().optional(), { label: 'Board', card: 'content', group: 'board' }),
	}, {
		roundId: undefined,
		view: 'all',
		badgePosition: 'top-left',
		networks: [],
		columns: [],
		board: undefined,
	}, {
		groups: {
			board: { title: 'Board', card: 'content' },
			badge: { title: 'Badge', card: 'content' },
		},
	});

	it('places each field in its settings card and, within it, its group', () => {
		expect(Object.values(contract.fields).map(({ key, card, group }) => ({ key, card, group }))).toEqual([
			{ key: 'roundId', card: 'source', group: undefined },
			{ key: 'view', card: 'source', group: undefined },
			{ key: 'badgePosition', card: 'content', group: 'badge' },
			{ key: 'networks', card: 'content', group: 'badge' },
			{ key: 'columns', card: 'content', group: undefined },
			{ key: 'board', card: 'content', group: 'board' },
		]);
		expect(contract.groups).toEqual({
			board: { title: 'Board', card: 'content' },
			badge: { title: 'Badge', card: 'content' },
		});
	});

	it.each([
		[
			'an Event Reference by its kind\'s picker',
			'roundId',
			{
				control: 'reference',
				reference: 'round',
				placeholder: 'Current Round',
				clearable: true,
			},
		],
		[
			'a select with its labelled options',
			'view',
			{
				control: 'select',
				values: ['all', 'range'],
				options: { all: 'All', range: 'Position range' },
				clearable: false,
			},
		],
		[
			'a position by the nine-point picker, with its description',
			'badgePosition',
			{
				control: 'position',
				values: ['top-left', 'top-right'],
				description: 'Where the badge sits on its card.',
			},
		],
		[
			'a set of an enum\'s values',
			'networks',
			{
				control: 'set',
				values: ['x', 'bluesky'],
				options: { x: 'X', bluesky: 'Bluesky' },
			},
		],
		[
			'a bespoke widget by its named slot',
			'columns',
			{
				control: 'slot',
				slot: 'columns',
				options: { name: 'Name', points: 'Points' },
			},
		],
		[
			'a nested block by its own fields',
			'board',
			{ control: 'block', clearable: true },
		],
	] as const)('describes %s', (_case, key, view) => {
		expect(contract.fields[key]).toMatchObject(view);
	});

	it('describes a nested block\'s fields by their keys within it', () => {
		expect(contract.fields.board.fields).toEqual({
			view: expect.objectContaining({ key: 'view', control: 'select', group: 'board' }),
			listColumns: expect.objectContaining({
				key: 'listColumns',
				control: 'number',
				min: 1,
				max: 4,
			}),
		});
	});

	it('lists its Event References from the fields that name one', () => {
		expect(contract.eventReferences).toEqual({ roundId: 'round' });
		expectTypeOf(contract.eventReferences).toEqualTypeOf<{ readonly roundId: 'round' }>();
	});

	it.each([
		{
			name: 'a group it does not declare',
			group: 'badges',
			card: 'content',
			error: 'Config field "headerText" names the settings group "badges", which its contract does not declare.',
		},
		{
			name: 'a group of another card',
			group: 'badge',
			card: 'header',
			error: 'Config field "headerText" sits in the header card, but its group "badge" is in the content card.',
		},
	] as const)('refuses a field naming $name', ({ group, card, error }) => {
		expect(() => defineScreenModeConfigContract({
			headerText: editorField(z.string().optional(), { label: 'Header text', card, group }),
		}, { headerText: undefined }, {
			groups: {
				badge: { title: 'Badge', card: 'content' },
			},
		})).toThrow(error);
	});

	it('refuses a nested block\'s field naming a group it does not declare', () => {
		expect(() => defineScreenModeConfigContract({
			board: editorField(z.object(boardShape).strict().optional(), { label: 'Board', card: 'content' }),
		}, { board: undefined })).toThrow('Config field "board.view" names the settings group "board", which its contract does not declare.');
	});
});

// A stored value outside tightened bounds reads as the nearest bound, never the default (#498).
// Writes are still refused.
describe('a config contract\'s stored-fragment clamp', () => {
	const contract = defineScreenModeConfigContract({
		scale: z.number().min(0.5).max(2).optional(),
		board: z.object({
			columns: z.number().int().min(1).max(12).optional(),
			view: z.enum(['grid', 'list']).optional(),
		}).strict().optional(),
		featureMatchId: z.number().int().positive().nullable(),
		label: z.string().max(5).optional(),
	}, {
		scale: 1,
		board: { columns: 4, view: 'grid' },
		featureMatchId: null,
		label: undefined,
	});

	it('pulls a stored number outside its bounds to the nearest bound', () => {
		expect(contract.readStored({ scale: 4 })).toEqual({ scale: 2 });
		expect(contract.readStored({ scale: 0.1 })).toEqual({ scale: 0.5 });
	});

	it('clamps inside a nested block and keeps the block\'s other keys', () => {
		expect(contract.readStored({
			board: { columns: 16, view: 'list' },
		})).toEqual({
			board: { columns: 12, view: 'list' },
		});
	});

	it('returns an in-range fragment as it is', () => {
		const fragment = {
			scale: 1.5,
			board: { columns: 3 },
			featureMatchId: 7,
		};

		expect(contract.readStored(fragment)).toBe(fragment);
	});

	it('leaves what it cannot clamp to the reader: other types, exclusive bounds, and unknown keys', () => {
		const fragment = {
			scale: 'big',
			featureMatchId: 0,
			label: 'too long',
			retired: 99,
		} as Record<string, unknown>;

		expect(contract.readStored(fragment)).toEqual(fragment);
	});

	it('does not loosen a write: the schema still refuses the value it clamps on read', () => {
		expect(contract.schema.safeParse({ ...contract.defaults, scale: 4 }).success).toBe(false);
	});
});

// A former field is gone from the shape, at the top level or in a nested block.
describe('a config contract\'s former fields', () => {
	const shape = {
		gap: z.number().optional(),
		board: z.object({
			columns: z.number().optional(),
		}).strict().optional(),
	};

	it.each([
		{ former: 'gap', refused: true },
		{ former: 'board.columns', refused: true },
		{ former: 'board.cardGap', refused: false },
		{ former: 'gap.size', refused: false },
	])('$former: refused while the shape still declares it, $refused', ({ former, refused }) => {
		const define = () => defineScreenModeConfigContract(shape, {}, {
			formerFields: [former],
		});

		if (refused)
			expect(define).toThrow(`Config field "${former}" cannot be both a field and a former field of one contract.`);
		else
			expect(define).not.toThrow();
	});
});

// A former field may map to a current one: the contract's upgrade runs before former fields are dropped and bounds clamped.
describe('a config contract upgrading its former fields', () => {
	const contract = defineScreenModeConfigContract({
		view: z.enum(['all', 'range']),
		rangeEnd: z.number().int().min(1).max(500).optional(),
		headerText: z.string().optional(),
	}, {
		view: 'all',
		rangeEnd: undefined,
		headerText: undefined,
	}, {
		formerFields: ['topCount'],
		// `view: 'top'` with its `topCount` became the range 1 to that count.
		upgradeFormerFields: fragment => fragment.view === 'top'
			? { ...fragment, view: 'range', rangeEnd: fragment.topCount ?? 8 }
			: fragment,
	});

	it.each([
		{
			name: 'maps a former field to its current field',
			stored: { view: 'top', topCount: 4, headerText: 'Top 4' },
			reads: { view: 'range', rangeEnd: 4, headerText: 'Top 4' },
		},
		{
			name: 'maps a former value of a current field',
			stored: { view: 'top' },
			reads: { view: 'range', rangeEnd: 8 },
		},
		{
			name: 'clamps what the upgrade produced',
			stored: { view: 'top', topCount: 9999 },
			reads: { view: 'range', rangeEnd: 500 },
		},
		{
			name: 'drops a former field the upgrade left',
			stored: { view: 'all', topCount: 4 },
			reads: { view: 'all' },
		},
		{
			name: 'reads an upgraded fragment as it is',
			stored: { view: 'range', rangeEnd: 4 },
			reads: { view: 'range', rangeEnd: 4 },
		},
	])('$name, on a read and on a write', ({ stored, reads }) => {
		expect(contract.readStored(stored)).toEqual(reads);
		expect(contract.readStored(contract.upgradeStored(stored))).toEqual(reads);
		expect(contract.upgradeStored(stored)).not.toHaveProperty('topCount');
	});

	it('returns a fragment with nothing to upgrade as it is', () => {
		const stored = { view: 'range', rangeEnd: 4 };

		expect(contract.readStored(stored)).toBe(stored);
		expect(contract.upgradeStored(stored)).toBe(stored);
	});

	it.each([
		null,
		undefined,
		'top',
		['top'],
	])('leaves %j, which is no fragment, to the schema', (value) => {
		expect(contract.upgradeStored(value)).toBe(value);
	});
});
