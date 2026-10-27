import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineScreenModeConfigContract } from '~~/shared/screenModeConfigs/contract';
import { editorField } from '~~/shared/screenModeConfigs/fields';

// A contract field's editor metadata (ADR-0037) is its control's only source of label, bounds and step.
describe('a config contract\'s editor fields', () => {
	const contract = defineScreenModeConfigContract({
		scale: editorField(z.number().min(0.5).max(2).optional(), { label: 'Card Scale', step: 0.1 }),
		columns: editorField(z.number().int().min(1).max(12), { label: 'Grid Columns' }),
		intervalMs: editorField(z.number().int().min(3000).max(60000), { label: 'Interval (seconds)', displayScale: 1000 }),
		maxTableWidth: editorField(z.number().int().min(1).nullable().optional(), { label: 'Max table width' }),
		enabled: editorField(z.boolean(), { label: 'Enable Animation' }),
		speed: editorField(z.enum(['slow', 'normal', 'fast']).optional(), { label: 'Animation Speed' }),
		textColor: editorField(z.string().max(50).optional(), { label: 'Text Color', control: 'color' }),
		headerText: editorField(z.string().max(200).optional(), { label: 'Custom header text' }),
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
			label: 'Card Scale',
			control: 'number',
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
		expect(contract.fields.enabled).toMatchObject({ label: 'Enable Animation', control: 'toggle' });
		expect(contract.fields.speed).toMatchObject({
			label: 'Animation Speed',
			control: 'select',
			values: ['slow', 'normal', 'fast'],
		});
		expect(contract.fields.textColor).toMatchObject({ label: 'Text Color', control: 'color' });
		expect(contract.fields.headerText).toMatchObject({ label: 'Custom header text', control: 'text' });
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
				topN: editorField(z.number().default(8), { label: 'Top N' }),
			}, { topN: 8 }),
		).toThrow();
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
