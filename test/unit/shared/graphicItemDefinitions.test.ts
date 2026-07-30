import { describe, expect, it } from 'vitest';
import { FEATURE_MATCH_TOKEN_CATALOGUE } from '~~/shared/featureMatchTokenCatalogue';
import {
	authorsGraphicInputs,
	authorsGraphicStack,
	BROADCAST_GRAPHICS_HOST_CONTRACT,
	FEATURE_MATCH_OVERLAY_HOST_CONTRACT,
	getGraphicItemDefinition,
	graphicFillSummary,
	graphicGroupChildDefinitionsForHost,
	graphicItemDefinitionsForHost,
	graphicItemSummary,
	graphicsHostTokenCatalogue,
	isGraphicItemDefinitionAvailable,
} from '~~/shared/modules/graphics';

describe('graphicItemDefinitions', () => {
	it('offers the shared base Graphic Item kinds to the Broadcast Graphics host', () => {
		const definitions = graphicItemDefinitionsForHost(BROADCAST_GRAPHICS_HOST_CONTRACT);

		expect(definitions.map(definition => definition.kind)).toEqual(['text', 'shape', 'media', 'group']);
	});

	it('never offers a Graphic Group inside a Graphic Group', () => {
		// Graphic Groups do not nest in the initial vocabulary, so the palette a
		// group offers is the host palette without itself.
		const definitions = graphicGroupChildDefinitionsForHost(BROADCAST_GRAPHICS_HOST_CONTRACT);

		expect(definitions.map(definition => definition.kind)).toEqual(['text', 'shape', 'media']);
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

	it('creates a Media Graphic Item that fills its bounds from its centre with no asset yet', () => {
		const item = getGraphicItemDefinition('media').createDefault({
			id: 'item-4',
			label: 'Sponsor',
			canvasWidth: 1920,
			canvasHeight: 1080,
		});

		// An author places the rectangle first and chooses content second, so a new
		// item is complete and renderable without a Graphic Asset Reference.
		expect(item).toMatchObject({
			type: 'media',
			mediaKind: 'image',
			fit: 'cover',
			focalPosition: { horizontal: 0.5, vertical: 0.5 },
			opacity: 1,
			playbackRate: 1,
			loop: true,
		});
		expect(item.type === 'media' && item.asset).toBeUndefined();
		expect(item.type === 'media' && item.clipGeometry).toBeUndefined();
	});

	it('summarises a Media Graphic Item by whether it pins an asset at all', () => {
		const empty = getGraphicItemDefinition('media').createDefault({
			id: 'item-5',
			label: 'Sponsor',
			canvasWidth: 1920,
			canvasHeight: 1080,
		});
		if (empty.type !== 'media')
			throw new Error('expected a Media Graphic Item');

		expect(graphicItemSummary(empty)).toBe('No Graphic Asset');
		expect(graphicItemSummary({
			...empty,
			asset: { assetId: 'asset-1' as never, revisionId: 'revision-1' as never },
		})).toBe('image • cover');
		expect(graphicItemSummary({
			...empty,
			mediaKind: 'silent-video',
			fit: 'contain',
			asset: { assetId: 'asset-1' as never, revisionId: 'revision-1' as never },
		})).toBe('silent video • contain');
	});

	it('carries only the contract fields the compositor reads', () => {
		// An unread field invites false confidence that a later host's needs are
		// already provided for. Each one joins when it has a real consumer:
		// `contextKinds` gates the palette, `composition` decides whether a stack is
		// authored, and `textValues` decides where placeholder values come from and
		// therefore whether Graphic Inputs are declared. Instant-apply write
		// semantics is deliberately not among them — both hosts already write
		// instantly, so a field for it would have no reader.
		const fields = ['composition', 'contextKinds', 'hostId', 'textValues'];

		expect(Object.keys(BROADCAST_GRAPHICS_HOST_CONTRACT).sort()).toEqual(fields);
		expect(Object.keys(FEATURE_MATCH_OVERLAY_HOST_CONTRACT).sort()).toEqual(fields);
	});

	it('offers the Feature Match host the Event and Feature Match contexts', () => {
		// The three context-gated Definitions require the Feature Match context, and
		// the token catalogue reads current Event Data as well as a Feature Match
		// Session, so a Feature Match Overlay declares both.
		expect(FEATURE_MATCH_OVERLAY_HOST_CONTRACT.contextKinds).toEqual(['event', 'feature-match']);
	});

	it('authors a stack for Broadcast Graphics and one composition for Feature Match Overlay', () => {
		// A Broadcast Graphics Screen composes an ordered stack of Broadcast
		// Graphics; a Feature Match Overlay renders exactly one Feature Match Layout
		// for exactly one Feature Match Slot, so it offers no stack to author.
		expect(authorsGraphicStack(BROADCAST_GRAPHICS_HOST_CONTRACT)).toBe(true);
		expect(authorsGraphicStack(FEATURE_MATCH_OVERLAY_HOST_CONTRACT)).toBe(false);
	});

	it('declares Graphic Inputs for Broadcast Graphics and binds host tokens for Feature Match Overlay', () => {
		// The two are exclusive by construction rather than by a rule something has
		// to check: one field carries the catalogue, so a host cannot bind tokens
		// without one or declare Graphic Inputs while binding them.
		expect(authorsGraphicInputs(BROADCAST_GRAPHICS_HOST_CONTRACT)).toBe(true);
		expect(graphicsHostTokenCatalogue(BROADCAST_GRAPHICS_HOST_CONTRACT)).toEqual([]);

		expect(authorsGraphicInputs(FEATURE_MATCH_OVERLAY_HOST_CONTRACT)).toBe(false);
		expect(graphicsHostTokenCatalogue(FEATURE_MATCH_OVERLAY_HOST_CONTRACT))
			.toBe(FEATURE_MATCH_TOKEN_CATALOGUE);
	});

	it('creates a Graphic Group arranging no children yet', () => {
		const item = getGraphicItemDefinition('group').createDefault({
			id: 'item-3',
			label: 'Name block',
			canvasWidth: 1920,
			canvasHeight: 1080,
		});

		expect(item).toMatchObject({
			type: 'group',
			arrangement: 'row',
			clip: false,
			children: [],
		});
		expect(item.type === 'group' && item.geometry.leftSlant).toBe(0);
	});

	it('summarises a Graphic Fill, a Shape Graphic Item, and a Graphic Group', () => {
		const shape = getGraphicItemDefinition('shape').createDefault({
			id: 'item-2',
			label: 'Bar',
			canvasWidth: 1000,
			canvasHeight: 500,
		});
		const group = getGraphicItemDefinition('group').createDefault({
			id: 'item-3',
			label: 'Block',
			canvasWidth: 1000,
			canvasHeight: 500,
		});

		expect(graphicFillSummary({ type: 'solid', color: '#0077a3' })).toBe('#0077a3');
		expect(graphicFillSummary({
			type: 'linear-gradient',
			angle: 90,
			stops: [
				{ color: '#000000', position: 0, opacity: 1 },
				{ color: '#ffffff', position: 1, opacity: 1 },
			],
		})).toBe('gradient • 2 stops');
		expect(graphicItemSummary(shape)).toBe('#0077a3 • rectangle');
		expect(graphicItemSummary(group)).toBe('row • 0 items');
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
