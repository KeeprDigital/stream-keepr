import { describe, expect, it } from 'vitest';
import { graphicStyleSetEntrySchema } from '~~/server/schemas/api/graphicStyleSet';
import { broadcastGraphicsModeConfigSchema } from '~~/server/schemas/api/screen';

/**
 * One set of typography bounds for every place an author sets typography: a Graphic
 * Item's base typography, a Graphic Placeholder Style, and a Graphic Style Set
 * typography preset. The shared typography fields control bounds its inputs to the
 * same numbers, so a value the editor offers is one every write accepts.
 */

const BASE = {
	font: { kind: 'application', fontId: 'inter' },
	fontSize: 64,
	fontWeight: 700,
	fontStyle: 'normal',
	textTransform: 'none',
	letterSpacing: 0,
	lineHeight: 1.15,
	textAlign: 'left',
	color: '#ffffff',
};

function withText(typography: Record<string, unknown>, placeholderStyle?: Record<string, unknown>) {
	return broadcastGraphicsModeConfigSchema.safeParse({
		graphics: [{
			id: 'a',
			name: 'A',
			inputs: [{
				type: 'text',
				key: 'name',
				label: 'Name',
				required: false,
				updatePolicy: 'staged',
				default: '',
				maxLength: 100,
			}],
			items: [{
				type: 'text',
				id: 'name',
				label: 'Text 1',
				visible: true,
				anchor: 'top-left',
				x: 0,
				y: 0,
				width: 10,
				height: 10,
				text: '{name}',
				typography: { ...BASE, ...typography },
				overflowPolicy: 'ellipsis',
				minFontSize: 24,
				...(placeholderStyle ? { placeholderStyles: { name: placeholderStyle } } : {}),
			}],
		}],
	}).success;
}

function withPreset(value: Record<string, unknown>) {
	return graphicStyleSetEntrySchema.safeParse({
		id: 'heading',
		kind: 'typography',
		name: 'Heading',
		schemaVersion: 1,
		value: {
			font: { kind: 'application', fontId: 'inter' },
			fontSize: 64,
			fontWeight: 700,
			fontStyle: 'normal',
			textTransform: 'none',
			letterSpacing: 0,
			lineHeight: 1.15,
			colorEntryId: 'brand',
			...value,
		},
	}).success;
}

describe('graphic typography bounds', () => {
	it('lets base typography space letters from -100 to 100', () => {
		expect(withText({ letterSpacing: -100 })).toBe(true);
		expect(withText({ letterSpacing: 100 })).toBe(true);
		expect(withText({ letterSpacing: -101 })).toBe(false);
		expect(withText({ letterSpacing: 101 })).toBe(false);
	});

	it('lets a typography preset space letters from -100 to 100', () => {
		expect(withPreset({ letterSpacing: -100 })).toBe(true);
		expect(withPreset({ letterSpacing: -101 })).toBe(false);
		expect(withPreset({ letterSpacing: 101 })).toBe(false);
	});

	it('weights a Graphic Placeholder Style from 1 to 1000, as base typography is', () => {
		expect(withText({}, { fontWeight: 1 })).toBe(true);
		expect(withText({}, { fontWeight: 1000 })).toBe(true);
		expect(withText({}, { fontWeight: 0 })).toBe(false);
		expect(withText({}, { fontWeight: 1001 })).toBe(false);
		expect(withText({}, { fontWeight: 450.5 })).toBe(false);
	});

	it('lets a Graphic Placeholder Style set its case and letter spacing', () => {
		expect(withText({}, { textTransform: 'uppercase', letterSpacing: -100 })).toBe(true);
		expect(withText({}, { letterSpacing: -101 })).toBe(false);
	});

	it('sizes text up to 600 and sets line height up to 10 everywhere', () => {
		expect(withText({ fontSize: 600, lineHeight: 0.05 })).toBe(true);
		expect(withText({ fontSize: 601 })).toBe(false);
		expect(withText({ lineHeight: 10.01 })).toBe(false);
		expect(withText({}, { fontSize: 601 })).toBe(false);
		expect(withPreset({ fontSize: 600, lineHeight: 10 })).toBe(true);
		expect(withPreset({ fontSize: 601 })).toBe(false);
		expect(withPreset({ lineHeight: 10.01 })).toBe(false);
	});
});
