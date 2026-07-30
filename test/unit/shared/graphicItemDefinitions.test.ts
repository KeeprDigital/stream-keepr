import { describe, expect, it } from 'vitest';
import {
	BROADCAST_GRAPHICS_HOST_CONTRACT,
	getGraphicItemDefinition,
	graphicItemDefinitionsForHost,
	isGraphicItemDefinitionAvailable,
} from '~~/shared/modules/graphics';

describe('graphicItemDefinitions', () => {
	it('offers the minimal shared Graphic Item kinds to the Broadcast Graphics host', () => {
		const definitions = graphicItemDefinitionsForHost(BROADCAST_GRAPHICS_HOST_CONTRACT);

		expect(definitions.map(definition => definition.kind)).toEqual(['text', 'shape']);
	});

	it('withholds a Definition whose required context the Host Contract cannot supply', () => {
		const clockDefinition = {
			...getGraphicItemDefinition('text'),
			requiredContext: 'feature-match' as const,
		};

		expect(isGraphicItemDefinitionAvailable(clockDefinition, BROADCAST_GRAPHICS_HOST_CONTRACT)).toBe(false);
		expect(isGraphicItemDefinitionAvailable(getGraphicItemDefinition('text'), BROADCAST_GRAPHICS_HOST_CONTRACT)).toBe(true);
	});

	it('creates a Text Graphic Item with base typography and a Text Overflow Policy', () => {
		const item = getGraphicItemDefinition('text').createDefault({
			id: 'item-1',
			label: 'Headline',
			canvasWidth: 1920,
			canvasHeight: 1080,
		});

		expect(item).toMatchObject({
			type: 'text',
			id: 'item-1',
			label: 'Headline',
			visible: true,
			anchor: 'top-left',
			overflowPolicy: 'ellipsis',
		});
		expect(item.type === 'text' && item.typography.fontSize).toBeGreaterThan(0);
	});

	it('creates a Shape Graphic Item sized against the host canvas', () => {
		const item = getGraphicItemDefinition('shape').createDefault({
			id: 'item-2',
			label: 'Bar',
			canvasWidth: 1000,
			canvasHeight: 500,
		});

		expect(item).toMatchObject({ type: 'shape', width: 400, height: 50 });
	});

	it('declares the Broadcast Graphics canvas default of 1920 by 1080 pixels', () => {
		expect(BROADCAST_GRAPHICS_HOST_CONTRACT).toMatchObject({
			hostId: 'broadcast-graphics',
			canvas: { defaultWidth: 1920, defaultHeight: 1080, configurable: true },
			writeSemantics: 'screen-stack',
		});
		expect(BROADCAST_GRAPHICS_HOST_CONTRACT.hostExtras).toEqual([]);
	});
});
