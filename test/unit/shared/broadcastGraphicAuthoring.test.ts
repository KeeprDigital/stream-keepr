import type { BroadcastGraphicConfig, GraphicGroupItemConfig, MediaGraphicItemConfig } from '~~/shared/types/graphics';
import { describe, expect, it } from 'vitest';
import {
	addGraphicGroupChild,
	addGraphicItem,
	applyGraphicSurfaceStyleEdit,
	applyShapeGeometryPreset,
	changeGraphicGradientStopCount,
	clearGraphicSurfaceStyle,
	clearMediaGraphicItemAsset,
	createBroadcastGraphic,
	deleteBroadcastGraphic,
	deleteGraphicItem,
	findGraphicItem,
	flattenGraphicItems,
	GRAPHIC_RULE_PRESET_HEIGHT,
	moveBroadcastGraphic,
	moveGraphicItem,
	patchGameWinsGraphicItem,
	patchGraphicGlow,
	patchGraphicGradientAngle,
	patchGraphicGradientStop,
	patchGraphicGroup,
	patchGraphicGroupChildSizing,
	patchGraphicGroupDefaultChildSurfaceStyle,
	patchGraphicItem,
	patchGraphicOutline,
	patchGraphicSolidFill,
	patchGraphicSurfaceStyle,
	patchGraphicTextOverflow,
	patchGraphicTypography,
	patchMediaFocalPosition,
	patchMediaGraphicItem,
	patchPlayerLifeGraphicItem,
	patchShapeCorner,
	patchShapeGeometry,
	selectMediaGraphicItemAsset,
	setGraphicFillKind,
	setMediaClipGeometry,
} from '~~/shared/modules/graphics';

const CANVAS = { canvasWidth: 1920, canvasHeight: 1080 };

function graphic(id: string, items: BroadcastGraphicConfig['items'] = []): BroadcastGraphicConfig {
	return { id, name: id, items };
}

/** A Broadcast Graphic holding one Graphic Group with one shape child. */
function withGroup() {
	const built = addGraphicItem(graphic('a'), { kind: 'group', id: 'cluster', ...CANVAS }).graphic;
	return addGraphicGroupChild(built, { kind: 'shape', groupId: 'cluster', id: 'child' }).graphic;
}

function group(built: BroadcastGraphicConfig): GraphicGroupItemConfig {
	const item = built.items.find(entry => entry.id === 'cluster');
	if (item?.type !== 'group')
		throw new Error('expected a Graphic Group');
	return item;
}

describe('broadcastGraphicAuthoring', () => {
	it('adds a Broadcast Graphic to the front of the Screen stack without mutating the stack', () => {
		const stack = [graphic('a')];

		const { graphics, graphicId } = createBroadcastGraphic(stack, { id: 'b' });

		expect(graphics.map(entry => entry.id)).toEqual(['a', 'b']);
		expect(graphicId).toBe('b');
		expect(stack).toHaveLength(1);
	});

	it('names each new Broadcast Graphic distinctly', () => {
		const first = createBroadcastGraphic([], { id: 'a' });
		const second = createBroadcastGraphic(first.graphics, { id: 'b' });

		expect(first.graphics[0]?.name).toBe('Graphic 1');
		expect(second.graphics[1]?.name).toBe('Graphic 2');
	});

	it('reorders a Broadcast Graphic within the authored back-to-front stack', () => {
		const stack = [graphic('a'), graphic('b'), graphic('c')];

		expect(moveBroadcastGraphic(stack, 'a', 1).map(entry => entry.id)).toEqual(['b', 'a', 'c']);
		expect(moveBroadcastGraphic(stack, 'c', -1).map(entry => entry.id)).toEqual(['a', 'c', 'b']);
	});

	it('leaves the stack order alone when a move would run off either end', () => {
		const stack = [graphic('a'), graphic('b')];

		expect(moveBroadcastGraphic(stack, 'a', -1).map(entry => entry.id)).toEqual(['a', 'b']);
		expect(moveBroadcastGraphic(stack, 'b', 1).map(entry => entry.id)).toEqual(['a', 'b']);
	});

	it('deletes one Broadcast Graphic and keeps the rest in order', () => {
		const stack = [graphic('a'), graphic('b'), graphic('c')];

		expect(deleteBroadcastGraphic(stack, 'b').map(entry => entry.id)).toEqual(['a', 'c']);
	});

	it('places a Graphic Item at the front of the Graphic Layer Order', () => {
		const { graphic: updated, itemId } = addGraphicItem(graphic('a'), {
			kind: 'shape',
			id: 'item-1',
			...CANVAS,
		});
		const { graphic: withText } = addGraphicItem(updated, { kind: 'text', id: 'item-2', ...CANVAS });

		expect(itemId).toBe('item-1');
		expect(withText.items.map(item => item.type)).toEqual(['shape', 'text']);
		expect(withText.items.map(item => item.label)).toEqual(['Shape 1', 'Text 1']);
	});

	it('reorders and deletes Graphic Items within one Broadcast Graphic', () => {
		const built = addGraphicItem(
			addGraphicItem(graphic('a'), { kind: 'shape', id: 'back', ...CANVAS }).graphic,
			{ kind: 'text', id: 'front', ...CANVAS },
		).graphic;

		expect(moveGraphicItem(built, 'back', 1).items.map(item => item.id)).toEqual(['front', 'back']);
		expect(deleteGraphicItem(built, 'back').items.map(item => item.id)).toEqual(['front']);
	});

	it('keeps sibling Shape Geometry fields when one corner is edited', () => {
		const built = addGraphicItem(graphic('a'), { kind: 'shape', id: 'bar', ...CANVAS }).graphic;

		const patched = patchShapeCorner(
			patchShapeGeometry(built, 'bar', { rightSlant: 40 }),
			'bar',
			'topRight',
			{ treatment: 'cut', size: 24 },
		);

		expect(patched.items[0]).toMatchObject({
			geometry: {
				topRight: { treatment: 'cut', size: 24 },
				topLeft: { treatment: 'square', size: 0 },
				rightSlant: 40,
				leftSlant: 0,
			},
		});
	});

	it('keeps sibling Graphic Surface Style fields when one of them is edited', () => {
		const built = addGraphicItem(graphic('a'), { kind: 'shape', id: 'bar', ...CANVAS }).graphic;

		const patched = patchGraphicSurfaceStyle(built, 'bar', { fillOpacity: 0.4 });

		expect(patched.items[0]).toMatchObject({
			surfaceStyle: { fill: { type: 'solid', color: '#0077a3' }, fillOpacity: 0.4 },
		});
	});

	it('keeps sibling typography fields when one of them is edited', () => {
		const built = addGraphicItem(graphic('a'), { kind: 'text', id: 'name', ...CANVAS }).graphic;

		const patched = patchGraphicTypography(built, 'name', { fontSize: 96 });

		expect(patched.items[0]).toMatchObject({
			typography: { fontSize: 96, fontWeight: 700, textAlign: 'left', color: '#ffffff' },
		});
	});

	it('ignores a property-group edit aimed at the wrong Graphic Item kind', () => {
		const built = addGraphicItem(graphic('a'), { kind: 'text', id: 'name', ...CANVAS }).graphic;

		expect(patchShapeGeometry(built, 'name', { leftSlant: 12 })).toEqual(built);
		expect(patchGraphicTypography(built, 'missing', { fontSize: 96 })).toEqual(built);
		expect(patchGraphicGroup(built, 'name', { padding: 8 })).toEqual(built);
	});

	it('patches one Graphic Item and leaves its siblings untouched', () => {
		const built = addGraphicItem(
			addGraphicItem(graphic('a'), { kind: 'text', id: 'headline', ...CANVAS }).graphic,
			{ kind: 'shape', id: 'bar', ...CANVAS },
		).graphic;

		const patched = patchGraphicItem(built, 'headline', { label: 'Headline', x: 40 });

		expect(patched.items[0]).toMatchObject({ id: 'headline', label: 'Headline', x: 40 });
		expect(patched.items[1]).toEqual(built.items[1]);
		expect(built.items[0]?.label).toBe('Text 1');
	});

	describe('graphic fill', () => {
		it('switches a Graphic Fill between solid and gradient without losing the authored colour', () => {
			const built = patchGraphicSolidFill(
				addGraphicItem(graphic('a'), { kind: 'shape', id: 'bar', ...CANVAS }).graphic,
				'bar',
				'#123456',
			);

			const gradient = setGraphicFillKind(built, 'bar', 'linear-gradient');
			const back = setGraphicFillKind(gradient, 'bar', 'solid');

			expect(gradient.items[0]).toMatchObject({
				surfaceStyle: {
					fill: {
						type: 'linear-gradient',
						angle: 90,
						stops: [{ color: '#123456', position: 0 }, { color: '#000000', position: 1 }],
					},
				},
			});
			expect(back.items[0]).toMatchObject({ surfaceStyle: { fill: { type: 'solid', color: '#123456' } } });
		});

		it('edits one gradient stop and the angle without disturbing the others', () => {
			const built = setGraphicFillKind(
				addGraphicItem(graphic('a'), { kind: 'shape', id: 'bar', ...CANVAS }).graphic,
				'bar',
				'linear-gradient',
			);

			const patched = patchGraphicGradientStop(
				patchGraphicGradientAngle(built, 'bar', 135),
				'bar',
				1,
				{ opacity: 0.4 },
			);

			expect(patched.items[0]?.surfaceStyle?.fill).toMatchObject({
				angle: 135,
				stops: [
					{ color: '#0077a3', position: 0, opacity: 1 },
					{ color: '#000000', position: 1, opacity: 0.4 },
				],
			});
		});

		it('holds a Graphic Fill between two and four stops', () => {
			const built = setGraphicFillKind(
				addGraphicItem(graphic('a'), { kind: 'shape', id: 'bar', ...CANVAS }).graphic,
				'bar',
				'linear-gradient',
			);

			let grown = built;
			for (let index = 0; index < 5; index += 1)
				grown = changeGraphicGradientStopCount(grown, 'bar', 1);

			let shrunk = grown;
			for (let index = 0; index < 5; index += 1)
				shrunk = changeGraphicGradientStopCount(shrunk, 'bar', -1);

			expect(grown.items[0]?.surfaceStyle?.fill.type === 'linear-gradient'
				&& grown.items[0]?.surfaceStyle?.fill.stops).toHaveLength(4);
			expect(shrunk.items[0]?.surfaceStyle?.fill.type === 'linear-gradient'
				&& shrunk.items[0]?.surfaceStyle?.fill.stops).toHaveLength(2);
		});

		it('adds and removes an outline and a glow without touching the fill', () => {
			const built = addGraphicItem(graphic('a'), { kind: 'shape', id: 'bar', ...CANVAS }).graphic;

			const styled = patchGraphicGlow(
				patchGraphicOutline(built, 'bar', { width: 6 }),
				'bar',
				{ color: '#ff51c7' },
			);
			const stripped = patchGraphicGlow(patchGraphicOutline(styled, 'bar', null), 'bar', null);

			expect(styled.items[0]?.surfaceStyle).toMatchObject({
				fill: { type: 'solid', color: '#0077a3' },
				outline: { color: '#ffffff', width: 6 },
				glow: { color: '#ff51c7', size: 24, opacity: 0.8 },
			});
			expect(stripped.items[0]?.surfaceStyle?.outline).toBeUndefined();
			expect(stripped.items[0]?.surfaceStyle?.glow).toBeUndefined();
			expect(stripped.items[0]?.surfaceStyle?.fill).toEqual({ type: 'solid', color: '#0077a3' });
		});

		it('gives a Text Graphic Item a Graphic Surface Style, and takes it away again', () => {
			const built = addGraphicItem(graphic('a'), { kind: 'text', id: 'name', ...CANVAS }).graphic;

			const styled = patchGraphicSurfaceStyle(built, 'name', { fillOpacity: 0.75 });
			const cleared = clearGraphicSurfaceStyle(styled, 'name');

			expect(built.items[0]?.surfaceStyle).toBeUndefined();
			expect(styled.items[0]?.surfaceStyle).toEqual({
				fill: { type: 'solid', color: '#0077a3' },
				fillOpacity: 0.75,
			});
			expect(cleared.items[0]?.surfaceStyle).toBeUndefined();
		});
	});

	describe('shape geometry presets', () => {
		it('initialises a Shape Geometry from a preset, and a rule also proposes a height', () => {
			const built = addGraphicItem(graphic('a'), { kind: 'shape', id: 'bar', ...CANVAS }).graphic;

			const cut = applyShapeGeometryPreset(built, 'bar', 'corner-cut');
			const rule = applyShapeGeometryPreset(built, 'bar', 'rule');

			expect(cut.items[0]).toMatchObject({
				geometry: { topRight: { treatment: 'cut' }, bottomLeft: { treatment: 'cut' } },
				height: built.items[0]?.height,
			});
			expect(rule.items[0]?.height).toBe(GRAPHIC_RULE_PRESET_HEIGHT);
		});

		it('applies a preset to the Shape Geometry a Graphic Group owns too', () => {
			const built = withGroup();

			const patched = applyShapeGeometryPreset(built, 'cluster', 'slanted-edge');

			expect(group(patched).geometry.rightSlant).toBeGreaterThan(0);
		});
	});

	it('refuses main-axis sizing on a top-level Graphic Item, which no group sizes', () => {
		const built = addGraphicItem(graphic('a'), { kind: 'shape', id: 'bar', ...CANVAS }).graphic;

		// The wire schema rejects sizing on a top-level item, so authoring one would
		// build a config no write would accept.
		expect(patchGraphicGroupChildSizing(built, 'bar', { mode: 'fill' })).toEqual(built);
	});

	describe('graphic groups', () => {
		it('adds a child to a Graphic Group in its own Graphic Layer Order', () => {
			const built = addGraphicGroupChild(withGroup(), {
				kind: 'text',
				groupId: 'cluster',
				id: 'name',
				...CANVAS,
			}).graphic;

			expect(group(built).children.map(child => child.id)).toEqual(['child', 'name']);
			expect(built.items).toHaveLength(1);
		});

		it('sizes a new child against its Graphic Group rather than the Screen canvas', () => {
			const built = patchGraphicItem(withGroup(), 'cluster', { width: 500, height: 200 });

			const added = addGraphicGroupChild(built, { kind: 'shape', groupId: 'cluster', id: 'inner' }).graphic;
			const child = group(added).children.find(entry => entry.id === 'inner');

			expect(child).toMatchObject({ width: 200, height: 20 });
		});

		it('names a new child distinctly from every existing item, at any depth', () => {
			const built = addGraphicGroupChild(withGroup(), {
				kind: 'shape',
				groupId: 'cluster',
				id: 'second',
				...CANVAS,
			}).graphic;

			expect(group(built).children.map(child => child.label)).toEqual(['Shape 1', 'Shape 2']);
		});

		it('refuses to add a child to something that is not a Graphic Group', () => {
			const built = addGraphicItem(graphic('a'), { kind: 'shape', id: 'bar', ...CANVAS }).graphic;

			expect(addGraphicGroupChild(built, { kind: 'text', groupId: 'bar', id: 'x' }).graphic).toEqual(built);
		});

		it('finds and flattens a Graphic Group child by id alone', () => {
			const built = withGroup();

			expect(findGraphicItem(built, 'child')).toMatchObject({
				item: { id: 'child' },
				group: { id: 'cluster' },
			});
			expect(findGraphicItem(built, 'cluster')?.group).toBeUndefined();
			expect(findGraphicItem(built, 'nowhere')).toBeNull();
			expect(flattenGraphicItems(built).map(item => item.id)).toEqual(['cluster', 'child']);
		});

		it('reorders and deletes inside the group the child belongs to', () => {
			const built = addGraphicGroupChild(withGroup(), {
				kind: 'text',
				groupId: 'cluster',
				id: 'name',
				...CANVAS,
			}).graphic;

			expect(group(moveGraphicItem(built, 'child', 1)).children.map(child => child.id)).toEqual(['name', 'child']);
			expect(group(deleteGraphicItem(built, 'child')).children.map(child => child.id)).toEqual(['name']);
			// Deleting the group takes its children with it.
			expect(deleteGraphicItem(built, 'cluster').items).toEqual([]);
		});

		it('patches a Graphic Group child through the same helpers as a top-level item', () => {
			const built = withGroup();

			const patched = patchGraphicSurfaceStyle(
				patchShapeCorner(built, 'child', 'topLeft', { treatment: 'rounded', size: 8 }),
				'child',
				{ fillOpacity: 0.2 },
			);
			const child = group(patched).children[0];

			expect(child).toMatchObject({
				geometry: { topLeft: { treatment: 'rounded', size: 8 } },
				surfaceStyle: { fillOpacity: 0.2 },
			});
		});

		it('lets a child inherit or override the local style default of its Graphic Group', () => {
			const built = patchGraphicGroupDefaultChildSurfaceStyle(withGroup(), 'cluster', { fillOpacity: 0.3 });

			const inheriting = clearGraphicSurfaceStyle(built, 'child');
			const overriding = patchGraphicSurfaceStyle(inheriting, 'child', { fillOpacity: 1 });
			const removed = patchGraphicGroupDefaultChildSurfaceStyle(built, 'cluster', null);

			expect(group(built).defaultChildSurfaceStyle).toMatchObject({ fillOpacity: 0.3 });
			expect(group(inheriting).children[0]?.surfaceStyle).toBeUndefined();
			expect(group(overriding).children[0]?.surfaceStyle).toMatchObject({ fillOpacity: 1 });
			expect(group(removed).defaultChildSurfaceStyle).toBeUndefined();
		});

		it('merges the main-axis sizing of a child without dropping its siblings', () => {
			const built = patchGraphicGroupChildSizing(withGroup(), 'child', { mode: 'fill' });

			const patched = patchGraphicGroupChildSizing(built, 'child', { weight: 3 });

			expect(group(patched).children[0]?.sizing).toEqual({
				mode: 'fill',
				size: group(built).children[0]!.width,
				weight: 3,
			});
		});

		it('patches the arrangement of a Graphic Group without touching its children', () => {
			const built = withGroup();

			const patched = patchGraphicGroup(built, 'cluster', { arrangement: 'canvas', clip: true });

			expect(group(patched)).toMatchObject({ arrangement: 'canvas', clip: true });
			expect(group(patched).children).toEqual(group(built).children);
		});

		it('sizes a Media Graphic Item child on the main axis of its group', () => {
			const built = addGraphicGroupChild(
				addGraphicItem(graphic('a'), { kind: 'group', id: 'cluster', ...CANVAS }).graphic,
				{ kind: 'media', groupId: 'cluster', id: 'logo' },
			).graphic;

			const patched = patchGraphicGroupChildSizing(built, 'logo', { mode: 'fill', weight: 2 });

			expect(group(patched).children[0]).toMatchObject({ type: 'media', sizing: { mode: 'fill', weight: 2 } });
		});
	});

	describe('media Graphic Items', () => {
		const REFERENCE = { assetId: 'asset-1' as never, revisionId: 'revision-1' as never };

		function withMedia() {
			return addGraphicItem(graphic('a'), { kind: 'media', id: 'logo', ...CANVAS }).graphic;
		}

		function media(built: BroadcastGraphicConfig): MediaGraphicItemConfig {
			const item = built.items.find(entry => entry.id === 'logo');
			if (item?.type !== 'media')
				throw new Error('expected a Media Graphic Item');
			return item;
		}

		it('pins one exact Graphic Asset identity and revision, taking its kind from the asset', () => {
			const patched = selectMediaGraphicItemAsset(withMedia(), 'logo', {
				asset: REFERENCE,
				mediaKind: 'silent-video',
				videoCompatibility: 'chromium-transparency',
			});

			expect(media(patched)).toMatchObject({
				asset: REFERENCE,
				mediaKind: 'silent-video',
				videoCompatibility: 'chromium-transparency',
			});
		});

		it('records target compatibility only for a silent video, and clears it for an image', () => {
			// The compatibility fact belongs to a video revision. Carrying a stale one
			// on an image would make the reference index check a rule that no longer
			// applies to the pinned bytes.
			const video = selectMediaGraphicItemAsset(withMedia(), 'logo', {
				asset: REFERENCE,
				mediaKind: 'silent-video',
				videoCompatibility: 'all-supported',
			});

			const image = selectMediaGraphicItemAsset(video, 'logo', {
				asset: REFERENCE,
				mediaKind: 'image',
				videoCompatibility: 'all-supported',
			});

			expect(media(video).videoCompatibility).toBe('all-supported');
			expect(media(image).videoCompatibility).toBeUndefined();
			expect(media(image).mediaKind).toBe('image');
		});

		it('keeps authored playback settings across a change of asset kind', () => {
			// Playback rate and looping are the author's, not the asset's, so a detour
			// through an image must not discard them.
			const configured = patchMediaGraphicItem(withMedia(), 'logo', { playbackRate: 0.5, loop: false });

			const asImage = selectMediaGraphicItemAsset(configured, 'logo', { asset: REFERENCE, mediaKind: 'image' });
			const asVideo = selectMediaGraphicItemAsset(asImage, 'logo', {
				asset: REFERENCE,
				mediaKind: 'silent-video',
				videoCompatibility: 'all-supported',
			});

			expect(media(asVideo)).toMatchObject({ playbackRate: 0.5, loop: false });
		});

		it('returns the media kind to image when the asset is unpinned', () => {
			// Leaving it on silent-video would keep offering playback controls on an item
			// that reads "No Graphic Asset" — controls for an asset that is not there.
			const video = selectMediaGraphicItemAsset(
				patchMediaGraphicItem(withMedia(), 'logo', { playbackRate: 0.5, loop: false }),
				'logo',
				{ asset: REFERENCE, mediaKind: 'silent-video', videoCompatibility: 'all-supported' },
			);

			const cleared = clearMediaGraphicItemAsset(video, 'logo');

			expect(media(cleared).mediaKind).toBe('image');
			// The author's own playback settings survive, because they are not the asset's.
			expect(media(cleared)).toMatchObject({ playbackRate: 0.5, loop: false });
		});

		it('unpins an asset without disturbing the presentation of the item', () => {
			const pinned = selectMediaGraphicItemAsset(
				patchMediaGraphicItem(withMedia(), 'logo', { fit: 'contain' }),
				'logo',
				{ asset: REFERENCE, mediaKind: 'silent-video', videoCompatibility: 'all-supported' },
			);

			const cleared = clearMediaGraphicItemAsset(pinned, 'logo');

			expect(media(cleared).asset).toBeUndefined();
			expect(media(cleared).videoCompatibility).toBeUndefined();
			expect(media(cleared).fit).toBe('contain');
		});

		it('merges one focal axis without dropping the other', () => {
			const built = patchMediaFocalPosition(withMedia(), 'logo', { horizontal: 0.2 });

			const patched = patchMediaFocalPosition(built, 'logo', { vertical: 0.9 });

			expect(media(patched).focalPosition).toEqual({ horizontal: 0.2, vertical: 0.9 });
		});

		it('clips to an ordinary Shape Geometry, edited by the same helpers a shape uses', () => {
			const clipping = setMediaClipGeometry(withMedia(), 'logo', true);

			const slanted = patchShapeCorner(
				patchShapeGeometry(clipping, 'logo', { rightSlant: 30 }),
				'logo',
				'topLeft',
				{ treatment: 'cut', size: 12 },
			);

			expect(media(slanted).clipGeometry).toMatchObject({
				rightSlant: 30,
				topLeft: { treatment: 'cut', size: 12 },
				// The canonical Shape Geometry, so every other corner is still stated.
				bottomRight: { treatment: 'square', size: 0 },
			});
			expect(media(slanted).clipGeometry?.leftSlant).toBe(0);
		});

		it('initialises the clip of a Media Graphic Item from a Shape Geometry preset', () => {
			const clipping = setMediaClipGeometry(withMedia(), 'logo', true);

			const patched = applyShapeGeometryPreset(clipping, 'logo', 'corner-cut');

			expect(media(patched).clipGeometry?.topRight.treatment).toBe('cut');
			expect(media(patched).clipGeometry?.topRight.size).toBeGreaterThan(0);
		});

		it('never turns clipping on as a side effect of a geometry edit', () => {
			// Absent clipping means the item clips to its own bounds. Nudging a corner
			// of a clip that does not exist must stay a no-op, or an author would
			// discover a shape they never asked for.
			const built = withMedia();

			expect(patchShapeGeometry(built, 'logo', { rightSlant: 30 })).toEqual(built);
			expect(patchShapeCorner(built, 'logo', 'topLeft', { treatment: 'rounded', size: 8 })).toEqual(built);
			expect(applyShapeGeometryPreset(built, 'logo', 'corner-cut')).toEqual(built);
		});

		it('drops an authored clip rather than flattening it when clipping is switched off', () => {
			const clipping = patchShapeGeometry(
				setMediaClipGeometry(withMedia(), 'logo', true),
				'logo',
				{ leftSlant: 24 },
			);

			const off = setMediaClipGeometry(clipping, 'logo', false);
			const onceMore = setMediaClipGeometry(off, 'logo', true);

			expect(media(off).clipGeometry).toBeUndefined();
			expect(media(onceMore).clipGeometry?.leftSlant).toBe(0);
		});

		it('paints no Graphic Surface Style: a Media Graphic Item renders an asset, not a surface', () => {
			const built = withMedia();

			expect(patchGraphicSurfaceStyle(built, 'logo', { fillOpacity: 0.5 })).toEqual(built);
			expect(clearGraphicSurfaceStyle(built, 'logo')).toEqual(built);
		});

		it('ignores a media edit aimed at another Graphic Item kind', () => {
			const built = addGraphicItem(graphic('a'), { kind: 'shape', id: 'bar', ...CANVAS }).graphic;

			expect(patchMediaGraphicItem(built, 'bar', { fit: 'fill' })).toEqual(built);
			expect(setMediaClipGeometry(built, 'bar', true)).toEqual(built);
			expect(patchMediaFocalPosition(built, 'bar', { horizontal: 0 })).toEqual(built);
		});
	});
	describe('the context-gated Feature Match Definitions', () => {
		/** A Broadcast Graphic holding one item of a context-gated kind. */
		function withKind(kind: 'clock' | 'player-life' | 'game-wins') {
			return addGraphicItem(graphic('a'), { kind, id: kind, ...CANVAS }).graphic;
		}

		function itemOf(built: BroadcastGraphicConfig, id: string) {
			const item = built.items.find(entry => entry.id === id);
			if (!item)
				throw new Error(`expected a ${id} Graphic Item`);
			return item;
		}

		it.each(['clock', 'player-life', 'game-wins'] as const)('sets the base typography of a %s Item', (kind) => {
			// Their string comes from the live Feature Match Session rather than from an
			// author, which decides what they say and nothing about how it is set.
			const built = patchGraphicTypography(withKind(kind), kind, { fontSize: 96 });
			const item = itemOf(built, kind);

			expect(item.type !== 'shape' && item.type !== 'media' && item.type !== 'group' && item.typography)
				.toMatchObject({ fontSize: 96, fontWeight: 700 });
		});

		it.each(['clock', 'player-life', 'game-wins'] as const)('gives a %s Item a Graphic Surface Style of its own', (kind) => {
			const built = patchGraphicSurfaceStyle(withKind(kind), kind, { fillOpacity: 0.4 });
			const item = itemOf(built, kind);

			expect(item.type !== 'media' && item.surfaceStyle).toMatchObject({ fillOpacity: 0.4 });
		});

		it.each(['clock', 'player-life'] as const)('bounds a %s Item with a Text Overflow Policy', (kind) => {
			// A live string can be longer than the author ever saw, and text does not
			// render with visible overflow beyond its authored bounds.
			const built = patchGraphicTextOverflow(withKind(kind), kind, { overflowPolicy: 'shrink', minFontSize: 30 });
			const item = itemOf(built, kind);

			expect(item.type === kind && item).toMatchObject({ overflowPolicy: 'shrink', minFontSize: 30 });
		});

		it('sets the life-change animation a Player Life Item marks a change with', () => {
			const built = patchPlayerLifeGraphicItem(withKind('player-life'), 'player-life', {
				lifeAnimation: 'pop',
				lifeAnimationDurationMs: 800,
				lifeAnimationAccentColor: '#ff0055',
			});

			expect(itemOf(built, 'player-life')).toMatchObject({
				lifeAnimation: 'pop',
				lifeAnimationDurationMs: 800,
				lifeAnimationAccentColor: '#ff0055',
			});
		});

		it('sets a Game Wins Item’s display mode and win box dimensions', () => {
			const built = patchGameWinsGraphicItem(withKind('game-wins'), 'game-wins', {
				displayMode: 'number',
				boxOrientation: 'vertical',
				boxWidth: 40,
				boxHeight: 12,
				boxGap: 3,
			});

			expect(itemOf(built, 'game-wins')).toMatchObject({
				displayMode: 'number',
				boxOrientation: 'vertical',
				boxWidth: 40,
				boxHeight: 12,
				boxGap: 3,
			});
		});

		it('shapes a Game Wins Item’s win box rather than its own bounds', () => {
			// A win box is an ordinary painted surface, so a cut-corner one is authored
			// with exactly the controls a Shape Graphic Item uses.
			const built = patchShapeCorner(withKind('game-wins'), 'game-wins', 'topRight', { treatment: 'cut', size: 6 });
			const item = itemOf(built, 'game-wins');

			expect(item.type === 'game-wins' && item.boxGeometry.topRight).toMatchObject({ treatment: 'cut', size: 6 });
			// The indicator's own rectangle is untouched: the geometry is the box’s.
			expect(item).toMatchObject({ width: 768, height: 108 });
		});

		it('sizes a win box preset against the box rather than against the whole indicator', () => {
			// A preset that proposes a height is proposing one for the shape it just
			// initialised. Writing it to the indicator would resize every box at once and
			// leave the shape it was measured for unchanged.
			const built = applyShapeGeometryPreset(withKind('game-wins'), 'game-wins', 'rule');
			const item = itemOf(built, 'game-wins');

			expect(item.type === 'game-wins' && item.boxHeight).toBe(GRAPHIC_RULE_PRESET_HEIGHT);
			expect(item.height).toBe(108);
		});

		it('paints the two win box surfaces independently of the item’s own', () => {
			// An unwon box reads as an empty outline and a won one as a filled pip, which
			// is the distinction the indicator exists to make — so both are ordinary
			// authored surfaces rather than one style with a hardcoded variant.
			const built = applyGraphicSurfaceStyleEdit(
				applyGraphicSurfaceStyleEdit(
					withKind('game-wins'),
					'game-wins',
					'boxSurfaceStyle',
					{ kind: 'solid-fill', color: '#123456' },
				),
				'game-wins',
				'wonBoxSurfaceStyle',
				{ kind: 'glow', patch: { size: 12 } },
			);
			const item = itemOf(built, 'game-wins');
			if (item.type !== 'game-wins')
				throw new Error('expected a Game Wins Item');

			expect(item.boxSurfaceStyle.fill).toEqual({ type: 'solid', color: '#123456' });
			expect(item.wonBoxSurfaceStyle.glow).toMatchObject({ size: 12 });
			// Neither edit reached the other surface, or the item's own.
			expect(item.wonBoxSurfaceStyle.fill).toEqual({ type: 'solid', color: '#22c55e' });
			expect(item.boxSurfaceStyle.glow).toBeUndefined();
			expect(item.surfaceStyle).toBeUndefined();
		});

		it('refuses to clear a win box surface, which always paints one', () => {
			// Both box slots are required by the wire schema, so a caller that asked would
			// be authoring a shape no write accepts.
			const built = withKind('game-wins');

			expect(applyGraphicSurfaceStyleEdit(built, 'game-wins', 'boxSurfaceStyle', { kind: 'present', present: false }))
				.toEqual(built);
			expect(applyGraphicSurfaceStyleEdit(built, 'game-wins', 'wonBoxSurfaceStyle', { kind: 'present', present: false }))
				.toEqual(built);
		});

		it('ignores a win box edit aimed at another Graphic Item kind', () => {
			const built = addGraphicItem(graphic('a'), { kind: 'shape', id: 'bar', ...CANVAS }).graphic;

			expect(applyGraphicSurfaceStyleEdit(built, 'bar', 'boxSurfaceStyle', { kind: 'solid-fill', color: '#000000' }))
				.toEqual(built);
			expect(patchGameWinsGraphicItem(built, 'bar', { displayMode: 'number' })).toEqual(built);
			expect(patchPlayerLifeGraphicItem(built, 'bar', { lifeAnimation: 'pop' })).toEqual(built);
			expect(patchGraphicTextOverflow(built, 'bar', { overflowPolicy: 'clip' })).toEqual(built);
		});
	});
});
