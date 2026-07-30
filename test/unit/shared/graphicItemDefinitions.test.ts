import { describe, expect, it } from 'vitest';
import {
	BROADCAST_GRAPHICS_HOST_CONTRACT,
	getGraphicItemDefinition,
	graphicItemDefinitionsForHost,
	graphicItemSummary,
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

	it('carries only the contract fields the compositor reads', () => {
		// An unread field invites false confidence that a later host's needs are
		// already provided for. Each one joins when it has a real consumer.
		expect(Object.keys(BROADCAST_GRAPHICS_HOST_CONTRACT).sort()).toEqual(['contextKinds', 'hostId']);
	});

	it('summarises a Graphic Item for the authoring tree', () => {
		const text = getGraphicItemDefinition('text').createDefault({
			id: 'item-1',
			label: 'Headline',
			canvasWidth: 1920,
			canvasHeight: 1080,
		});

		expect(graphicItemSummary(text)).toBe('Text');
		expect(graphicItemSummary({ ...text, text: '   ' })).toBe('Empty text');
	});
});
