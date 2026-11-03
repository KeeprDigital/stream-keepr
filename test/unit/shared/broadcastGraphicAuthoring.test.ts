import type { BroadcastGraphicConfig, GraphicGroupChildConfig, GraphicGroupItemConfig, GraphicItemConfig, MediaGraphicItemConfig } from '~~/shared/types/graphics';
import { describe, expect, it } from 'vitest';
import {
	addGraphicGroupChild,
	addGraphicItem,
	addSocialProfileProjection,
	applyGraphicSurfaceStyleEdit,
	applyShapeGeometryPreset,
	associateSocialProfileProjection,
	clearGraphicSurfaceStyle,
	clearMediaGraphicItemAsset,
	createBroadcastGraphic,
	deleteBroadcastGraphic,
	deleteGraphicItem,
	deleteGraphicSourceSelection,
	deleteSocialProfileProjection,
	duplicateGraphicItem,
	findGraphicItem,
	flattenGraphicItems,
	GRAPHIC_RULE_PRESET_HEIGHT,
	graphicItemPlacementRefusal,
	graphicItemsGroupRefusal,
	groupGraphicItems,
	moveBroadcastGraphic,
	moveGraphicItem,
	moveGraphicItemToEdge,
	patchDeckListGraphicItem,
	patchGameWinsGraphicItem,
	patchGraphicGlow,
	patchGraphicGroup,
	patchGraphicGroupChildSizing,
	patchGraphicGroupDefaultChildSurfaceStyle,
	patchGraphicItem,
	patchGraphicItemAnimationStagger,
	patchGraphicOutline,
	patchGraphicSurfaceStyle,
	patchGraphicTextOverflow,
	patchGraphicTypography,
	patchMediaFocalPosition,
	patchMediaGraphicItem,
	patchPlayerLifeGraphicItem,
	patchShapeCorner,
	patchShapeGeometry,
	patchSocialProfileProjection,
	placeGraphicItem,
	selectMediaGraphicItemAsset,
	setMediaClipGeometry,
	ungroupGraphicGroup,
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

// A Media Graphic Item, a Social Network Icon, and a Deck List have no Graphic
// Surface Style, so a reading of `surfaceStyle` has to say which kind it
// expected to be looking at.
function surfaced(item: GraphicItemConfig | GraphicGroupChildConfig | undefined) {
	if (!item || item.type === 'media' || item.type === 'social-network-icon' || item.type === 'deck-list')
		throw new Error('expected a Graphic Item carrying a Graphic Surface Style');
	return item;
}

describe('broadcastGraphicAuthoring', () => {
	it('creates a Social Profile Projection with an ordinary starter Presentation Group', () => {
		const source = { key: 'talent', label: 'Talent', kind: 'talent' as const };
		const initial = {
			...graphic('a'),
			sources: [source],
		};

		const projected = addSocialProfileProjection(initial, {
			label: 'Talent social profile',
			sourceKey: source.key,
			projectionKey: 'talent-social-profile',
			presentationGroupId: 'profile-group',
			iconItemId: 'profile-icon',
			handleItemId: 'profile-handle',
			...CANVAS,
		});

		expect(projected.socialProfileProjections).toEqual([
			{
				key: 'talent-social-profile',
				label: 'Talent social profile',
				sourceKey: 'talent',
				presentationGroupId: 'profile-group',
				updatePolicy: 'staged',
				dwellMs: 8_000,
				transition: 'crossfade',
				transitionDurationMs: 250,
			},
		]);
		expect(projected.items).toEqual([
			expect.objectContaining({
				type: 'group',
				id: 'profile-group',
				children: [
					expect.objectContaining({
						type: 'social-network-icon',
						id: 'profile-icon',
						network: { projectionKey: 'talent-social-profile' },
					}),
					expect.objectContaining({
						type: 'text',
						id: 'profile-handle',
						text: '{talent-social-profile.handle}',
					}),
				],
			}),
		]);
		expect(initial.items).toEqual([]);
	});

	it('associates an eligible existing Graphic Group with only one Social Profile Projection', () => {
		const initial = addGraphicItem({
			...graphic('a'),
			sources: [
				{ key: 'left-talent', label: 'Left Talent', kind: 'talent' },
				{ key: 'right-talent', label: 'Right Talent', kind: 'talent' },
			],
		}, { kind: 'group', id: 'existing', ...CANVAS }).graphic;

		const left = associateSocialProfileProjection(initial, {
			label: 'Left profile',
			projectionKey: 'left-profile',
			sourceKey: 'left-talent',
			presentationGroupId: 'existing',
		});
		const refused = associateSocialProfileProjection(left, {
			label: 'Right profile',
			projectionKey: 'right-profile',
			sourceKey: 'right-talent',
			presentationGroupId: 'existing',
		});

		expect(left.socialProfileProjections).toEqual([
			expect.objectContaining({ key: 'left-profile', presentationGroupId: 'existing' }),
		]);
		expect(refused).toEqual(left);
		expect(left.items).toEqual(initial.items);
	});

	it('edits a Social Profile Projection within its authored dwell and transition bounds', () => {
		const initial = addSocialProfileProjection({
			...graphic('a'),
			sources: [
				{ key: 'talent', label: 'Talent', kind: 'talent' },
			],
		}, {
			label: 'Profile',
			sourceKey: 'talent',
			projectionKey: 'profile',
			presentationGroupId: 'group',
			iconItemId: 'icon',
			handleItemId: 'handle',
			...CANVAS,
		});

		const edited = patchSocialProfileProjection(initial, 'profile', {
			label: 'Main Talent',
			updatePolicy: 'live',
			dwellMs: 60_000,
			transition: 'slide-left',
			transitionDurationMs: 2_000,
		});
		const refused = patchSocialProfileProjection(edited, 'profile', { dwellMs: 60_001 });

		expect(edited.socialProfileProjections?.[0]).toMatchObject({
			label: 'Main Talent',
			updatePolicy: 'live',
			dwellMs: 60_000,
			transition: 'slide-left',
			transitionDurationMs: 2_000,
		});
		expect(refused).toEqual(edited);
	});

	it('refuses projection edits that the strict document schema cannot save', () => {
		const initial = addSocialProfileProjection({
			...graphic('a'),
			sources: [
				{ key: 'talent', label: 'Talent', kind: 'talent' },
			],
		}, {
			label: 'Profile',
			sourceKey: 'talent',
			projectionKey: 'profile',
			presentationGroupId: 'group',
			iconItemId: 'icon',
			handleItemId: 'handle',
			...CANVAS,
		});

		expect(patchSocialProfileProjection(initial, 'profile', {
			label: 'x'.repeat(61),
		})).toBe(initial);
		expect(patchSocialProfileProjection(initial, 'profile', { dwellMs: 2_000.5 })).toBe(initial);
		expect(patchSocialProfileProjection(initial, 'profile', { transitionDurationMs: Number.NaN })).toBe(initial);
		expect(patchSocialProfileProjection(initial, 'profile', {
			// The public edit seam deliberately excludes Presentation Group reassignment.
			// This cast pins its runtime boundary against an untyped caller too.
			presentationGroupId: 'other-group',
		} as never)).toBe(initial);
	});

	it('refuses a projection past the strict per-graphic authoring budget without creating an orphan group', () => {
		const source = { key: 'talent', label: 'Talent', kind: 'talent' as const };
		const projections = Array.from({ length: 24 }, (_, index) => ({
			key: `profile-${index}`,
			label: `Profile ${index}`,
			sourceKey: source.key,
			presentationGroupId: `group-${index}`,
			dwellMs: 8_000,
			transition: 'crossfade' as const,
			transitionDurationMs: 250,
		}));
		const initial = addGraphicItem({
			...graphic('a'),
			sources: [source],
			socialProfileProjections: projections,
		}, { kind: 'group', id: 'existing', ...CANVAS }).graphic;

		expect(associateSocialProfileProjection(initial, {
			label: 'Overflow',
			projectionKey: 'overflow',
			sourceKey: source.key,
			presentationGroupId: 'existing',
		})).toBe(initial);
		expect(addSocialProfileProjection(initial, {
			label: 'Overflow',
			projectionKey: 'overflow',
			sourceKey: source.key,
			presentationGroupId: 'orphan-group',
			iconItemId: 'orphan-icon',
			handleItemId: 'orphan-handle',
			...CANVAS,
		})).toBe(initial);
	});

	it('requires an explicit combined deletion for a projection with dependent content', () => {
		const projected = addSocialProfileProjection({
			...graphic('a'),
			sources: [
				{ key: 'talent', label: 'Talent', kind: 'talent' },
			],
		}, {
			label: 'Profile',
			sourceKey: 'talent',
			projectionKey: 'profile',
			presentationGroupId: 'group',
			iconItemId: 'icon',
			handleItemId: 'handle',
			...CANVAS,
		});

		expect(deleteGraphicItem(projected, 'group')).toEqual(projected);
		expect(deleteSocialProfileProjection(projected, 'profile', { deletePresentationGroup: false }))
			.toEqual(projected);

		const removed = deleteSocialProfileProjection(projected, 'profile', { deletePresentationGroup: true });
		expect(removed.socialProfileProjections).toEqual([]);
		expect(removed.items).toEqual([]);
	});

	it('treats a retained projected Placeholder Style as dependent content', () => {
		const projected = addSocialProfileProjection({
			...graphic('a'),
			sources: [
				{ key: 'talent', label: 'Talent', kind: 'talent' },
			],
		}, {
			label: 'Profile',
			sourceKey: 'talent',
			projectionKey: 'profile',
			presentationGroupId: 'group',
			iconItemId: 'icon',
			handleItemId: 'handle',
			...CANVAS,
		});
		const presentationGroup = projected.items[0];
		if (presentationGroup?.type !== 'group')
			throw new Error('expected starter Presentation Group');
		const styleOnly = {
			...projected,
			items: [
				{
					...presentationGroup,
					children: presentationGroup.children.map((child) => {
						if (child.id === 'handle') {
							return {
								...child,
								text: 'literal',
								placeholderStyles: {
									'profile.handle': { fontWeight: 700 },
								},
							};
						}
						if (child.id === 'icon')
							return { ...child, network: 'twitch' as const };
						return child;
					}),
				},
			],
		};

		expect(deleteSocialProfileProjection(styleOnly, 'profile', { deletePresentationGroup: false }))
			.toBe(styleOnly);
	});

	it('keeps a Talent source while a Social Profile Projection still references it', () => {
		const projected = addSocialProfileProjection({
			...graphic('a'),
			sources: [
				{ key: 'talent', label: 'Talent', kind: 'talent' },
			],
		}, {
			label: 'Profile',
			sourceKey: 'talent',
			projectionKey: 'profile',
			presentationGroupId: 'group',
			iconItemId: 'icon',
			handleItemId: 'handle',
			...CANVAS,
		});

		expect(deleteGraphicSourceSelection([projected], 'a', 'talent')).toEqual([projected]);
	});

	it('adds a Broadcast Graphic to the front of the Screen stack without mutating the stack', () => {
		const stack = [
			graphic('a'),
		];

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
		const stack = [
			graphic('a'),
			graphic('b'),
			graphic('c'),
		];

		expect(moveBroadcastGraphic(stack, 'a', 1).map(entry => entry.id)).toEqual(['b', 'a', 'c']);
		expect(moveBroadcastGraphic(stack, 'c', -1).map(entry => entry.id)).toEqual(['a', 'c', 'b']);
	});

	it('leaves the stack order alone when a move would run off either end', () => {
		const stack = [
			graphic('a'),
			graphic('b'),
		];

		expect(moveBroadcastGraphic(stack, 'a', -1).map(entry => entry.id)).toEqual(['a', 'b']);
		expect(moveBroadcastGraphic(stack, 'b', 1).map(entry => entry.id)).toEqual(['a', 'b']);
	});

	it('deletes one Broadcast Graphic and keeps the rest in order', () => {
		const stack = [
			graphic('a'),
			graphic('b'),
			graphic('c'),
		];

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
			surfaceStyle: {
				fill: { type: 'solid', color: '#0077a3' },
				fillOpacity: 0.4,
			},
		});
	});

	it('keeps sibling typography fields when one of them is edited', () => {
		const built = addGraphicItem(graphic('a'), { kind: 'text', id: 'name', ...CANVAS }).graphic;

		const patched = patchGraphicTypography(built, 'name', { fontSize: 96 });
		const first = built.items[0]!;
		const before = first.type === 'text' && first.typography;

		expect(patched.items[0]).toMatchObject({
			typography: {
				...before,
				fontSize: 96,
			},
		});
	});

	it.each([
		[
			'Shape Geometry on text',
			(built: BroadcastGraphicConfig) => patchShapeGeometry(built, 'name', { leftSlant: 12 }),
		],
		[
			'typography on a missing item',
			(built: BroadcastGraphicConfig) => patchGraphicTypography(built, 'missing', { fontSize: 96 }),
		],
		[
			'group arrangement on text',
			(built: BroadcastGraphicConfig) => patchGraphicGroup(built, 'name', { padding: 8 }),
		],
		[
			'media fit on a shape',
			(built: BroadcastGraphicConfig) => patchMediaGraphicItem(built, 'bar', { fit: 'fill' }),
		],
		[
			'a media clip on a shape',
			(built: BroadcastGraphicConfig) => setMediaClipGeometry(built, 'bar', true),
		],
		[
			'a media focal position on a shape',
			(built: BroadcastGraphicConfig) => patchMediaFocalPosition(built, 'bar', { horizontal: 0 }),
		],
		[
			'a win box surface on a shape',
			(built: BroadcastGraphicConfig) => applyGraphicSurfaceStyleEdit(built, 'bar', 'boxSurfaceStyle', { kind: 'solid-fill', color: '#000000' }),
		],
		[
			'a Game Wins display mode on a shape',
			(built: BroadcastGraphicConfig) => patchGameWinsGraphicItem(built, 'bar', { displayMode: 'number' }),
		],
		[
			'a life animation on a shape',
			(built: BroadcastGraphicConfig) => patchPlayerLifeGraphicItem(built, 'bar', { lifeAnimation: 'pop' }),
		],
		[
			'a Text Overflow Policy on a shape',
			(built: BroadcastGraphicConfig) => patchGraphicTextOverflow(built, 'bar', { overflowPolicy: 'clip' }),
		],
	])('ignores %s', (_name, edit) => {
		const built = addGraphicItem(
			addGraphicItem(graphic('a'), { kind: 'text', id: 'name', ...CANVAS }).graphic,
			{ kind: 'shape', id: 'bar', ...CANVAS },
		).graphic;

		expect(edit(built)).toEqual(built);
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
		// The fill's own rules (kind, angle, stops, the two-to-four bound) are shared with a
		// Theme's fill token and tested once, in graphicFill.test.ts. What is the
		// item's own is the colour a new gradient ends on, and which slot an edit reaches.
		it('switches a Graphic Fill between solid and gradient without losing the authored colour', () => {
			const built = applyGraphicSurfaceStyleEdit(
				addGraphicItem(graphic('a'), { kind: 'shape', id: 'bar', ...CANVAS }).graphic,
				'bar',
				'surfaceStyle',
				{ kind: 'solid-fill', color: '#123456' },
			);

			const gradient = applyGraphicSurfaceStyleEdit(built, 'bar', 'surfaceStyle', { kind: 'fill-kind', fillKind: 'linear-gradient' });
			const back = applyGraphicSurfaceStyleEdit(gradient, 'bar', 'surfaceStyle', { kind: 'fill-kind', fillKind: 'solid' });

			expect(gradient.items[0]).toMatchObject({
				surfaceStyle: {
					fill: {
						type: 'linear-gradient',
						angle: 90,
						stops: [
							{ color: '#123456', position: 0 },
							{ color: '#000000', position: 1 },
						],
					},
				},
			});
			expect(back.items[0]).toMatchObject({
				surfaceStyle: {
					fill: { type: 'solid', color: '#123456' },
				},
			});
		});

		it('adds a gradient stop to the slot the edit names', () => {
			const built = applyGraphicSurfaceStyleEdit(
				addGraphicItem(graphic('a'), { kind: 'shape', id: 'bar', ...CANVAS }).graphic,
				'bar',
				'surfaceStyle',
				{ kind: 'fill-kind', fillKind: 'linear-gradient' },
			);

			const grown = applyGraphicSurfaceStyleEdit(built, 'bar', 'surfaceStyle', { kind: 'stop-count', delta: 1 });

			expect(surfaced(grown.items[0]).surfaceStyle?.fill).toMatchObject({
				stops: [
					{ color: '#0077a3', position: 0, opacity: 1 },
					{ color: '#000000', position: 1, opacity: 1 },
					{ color: '#000000', position: 1, opacity: 1 },
				],
			});
		});

		it('adds and removes an outline and a glow without touching the fill', () => {
			const built = addGraphicItem(graphic('a'), { kind: 'shape', id: 'bar', ...CANVAS }).graphic;

			const styled = patchGraphicGlow(
				patchGraphicOutline(built, 'bar', { width: 6 }),
				'bar',
				{ color: '#ff51c7' },
			);
			const stripped = patchGraphicGlow(patchGraphicOutline(styled, 'bar', null), 'bar', null);

			expect(surfaced(styled.items[0]).surfaceStyle).toMatchObject({
				fill: { type: 'solid', color: '#0077a3' },
				outline: { color: '#ffffff', width: 6 },
				glow: { color: '#ff51c7', size: 24, opacity: 0.8 },
			});
			expect(surfaced(stripped.items[0]).surfaceStyle?.outline).toBeUndefined();
			expect(surfaced(stripped.items[0]).surfaceStyle?.glow).toBeUndefined();
			expect(surfaced(stripped.items[0]).surfaceStyle?.fill).toEqual({ type: 'solid', color: '#0077a3' });
		});

		it('gives a Text Graphic Item a Graphic Surface Style, and takes it away again', () => {
			const built = addGraphicItem(graphic('a'), { kind: 'text', id: 'name', ...CANVAS }).graphic;

			const styled = patchGraphicSurfaceStyle(built, 'name', { fillOpacity: 0.75 });
			const cleared = clearGraphicSurfaceStyle(styled, 'name');

			expect(surfaced(built.items[0]).surfaceStyle).toBeUndefined();
			expect(surfaced(styled.items[0]).surfaceStyle).toEqual({
				fill: { type: 'solid', color: '#0077a3' },
				fillOpacity: 0.75,
			});
			expect(surfaced(cleared.items[0]).surfaceStyle).toBeUndefined();
		});
	});

	describe('shape geometry presets', () => {
		it('initialises a Shape Geometry from a preset, and a rule also proposes a height', () => {
			const built = addGraphicItem(graphic('a'), { kind: 'shape', id: 'bar', ...CANVAS }).graphic;

			const cut = applyShapeGeometryPreset(built, 'bar', 'corner-cut');
			const rule = applyShapeGeometryPreset(built, 'bar', 'rule');

			expect(cut.items[0]).toMatchObject({
				geometry: {
					topRight: { treatment: 'cut' },
					bottomLeft: { treatment: 'cut' },
				},
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
				geometry: {
					topLeft: { treatment: 'rounded', size: 8 },
				},
				surfaceStyle: { fillOpacity: 0.2 },
			});
		});

		it('lets a child inherit or override the local style default of its Graphic Group', () => {
			const built = patchGraphicGroupDefaultChildSurfaceStyle(withGroup(), 'cluster', { fillOpacity: 0.3 });

			const inheriting = clearGraphicSurfaceStyle(built, 'child');
			const overriding = patchGraphicSurfaceStyle(inheriting, 'child', { fillOpacity: 1 });
			const removed = patchGraphicGroupDefaultChildSurfaceStyle(built, 'cluster', null);

			expect(group(built).defaultChildSurfaceStyle).toMatchObject({ fillOpacity: 0.3 });
			expect(surfaced(group(inheriting).children[0]).surfaceStyle).toBeUndefined();
			expect(surfaced(group(overriding).children[0]).surfaceStyle).toMatchObject({ fillOpacity: 1 });
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

			expect(group(patched).children[0]).toMatchObject({
				type: 'media',
				sizing: { mode: 'fill', weight: 2 },
			});
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
			});

			expect(media(patched)).toMatchObject({
				asset: REFERENCE,
				mediaKind: 'silent-video',
			});
		});

		it('keeps authored playback settings across a change of asset kind', () => {
			// Playback rate and looping are the author's, not the asset's, so a detour
			// through an image must not discard them.
			const configured = patchMediaGraphicItem(withMedia(), 'logo', { playbackRate: 0.5, loop: false });

			const asImage = selectMediaGraphicItemAsset(configured, 'logo', { asset: REFERENCE, mediaKind: 'image' });
			const asVideo = selectMediaGraphicItemAsset(asImage, 'logo', {
				asset: REFERENCE,
				mediaKind: 'silent-video',
			});

			expect(media(asVideo)).toMatchObject({ playbackRate: 0.5, loop: false });
		});

		it('returns the media kind to image when the asset is unpinned', () => {
			// Leaving it on silent-video would keep offering playback controls on an item
			// that reads "No Graphic Asset" — controls for an asset that is not there.
			const video = selectMediaGraphicItemAsset(
				patchMediaGraphicItem(withMedia(), 'logo', { playbackRate: 0.5, loop: false }),
				'logo',
				{ asset: REFERENCE, mediaKind: 'silent-video' },
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
				{ asset: REFERENCE, mediaKind: 'silent-video' },
			);

			const cleared = clearMediaGraphicItemAsset(pinned, 'logo');

			expect(media(cleared).asset).toBeUndefined();
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
	});
	describe('the context-gated Feature Match Definitions', () => {
		/** A Broadcast Graphic holding one item of a context-gated kind. */
		function withKind(kind: 'clock' | 'player-life' | 'game-wins' | 'deck-list') {
			return addGraphicItem(graphic('a'), { kind, id: kind, ...CANVAS }).graphic;
		}

		function itemOf(built: BroadcastGraphicConfig, id: string) {
			const item = built.items.find(entry => entry.id === id);
			if (!item)
				throw new Error(`expected a ${id} Graphic Item`);
			return item;
		}

		it.each([
			'clock',
			'player-life',
			'game-wins',
			'deck-list',
		] as const)('sets the base typography of a %s Item', (kind) => {
			// Their string comes from the live Feature Match Session rather than from an
			// author, which decides what they say and nothing about how it is set.
			const unpatched = itemOf(withKind(kind), kind);
			const built = patchGraphicTypography(withKind(kind), kind, { fontSize: 96 });
			const item = itemOf(built, kind);
			const typographyOf = (owner: typeof item) => owner.type !== 'shape'
				&& owner.type !== 'media'
				&& owner.type !== 'social-network-icon'
				&& owner.type !== 'group'
				&& owner.typography;

			expect(typographyOf(item))
				.toMatchObject({
					...typographyOf(unpatched),
					fontSize: 96,
				});
		});

		it.each(['clock', 'player-life', 'game-wins'] as const)('gives a %s Item a Graphic Surface Style of its own', (kind) => {
			const built = patchGraphicSurfaceStyle(withKind(kind), kind, { fillOpacity: 0.4 });
			const item = itemOf(built, kind);

			expect(
				item.type !== 'media' && item.type !== 'social-network-icon' && item.type !== 'deck-list'
				&& item.surfaceStyle,
			).toMatchObject({ fillOpacity: 0.4 });
		});

		it.each(['clock', 'player-life'] as const)('bounds a %s Item with a Text Overflow Policy', (kind) => {
			// A live string can be longer than the author ever saw, and text does not
			// render with visible overflow beyond its authored bounds.
			const built = patchGraphicTextOverflow(withKind(kind), kind, { overflowPolicy: 'shrink', minFontSize: 30 });
			const item = itemOf(built, kind);

			expect(item.type === kind && item).toMatchObject({ overflowPolicy: 'shrink', minFontSize: 30 });
		});

		it('sets a Deck List Item’s view, quantity gate, and Player', () => {
			const built = patchDeckListGraphicItem(withKind('deck-list'), 'deck-list', {
				playerSide: 'player2',
				view: 'grid',
				showQuantities: false,
			});

			expect(itemOf(built, 'deck-list')).toMatchObject({
				type: 'deck-list',
				playerSide: 'player2',
				view: 'grid',
				showQuantities: false,
			});
		});

		it('never authors a Text Overflow Policy or a Graphic Surface Style onto a Deck List Item', () => {
			// The overflow is a fixed shrink-then-clip and the item renders cards
			// rather than painting a surface, so both edits resolve to nothing rather
			// than storing fields the wire schema refuses.
			const built = withKind('deck-list');

			expect(patchGraphicTextOverflow(built, 'deck-list', { overflowPolicy: 'shrink', minFontSize: 30 }))
				.toEqual(built);
			expect(patchGraphicSurfaceStyle(built, 'deck-list', { fillOpacity: 0.4 })).toEqual(built);
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
				{
					kind: 'glow',
					patch: { size: 12 },
				},
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
	});
});

describe('duplicating and reordering a Graphic Item', () => {
	function ids() {
		let next = 0;
		return () => `copy-${++next}`;
	}

	it('duplicates a Graphic Item directly in front of itself, offset and uniquely labelled', () => {
		const built = addGraphicItem(addGraphicItem(graphic('a'), { kind: 'text', id: 't', ...CANVAS }).graphic, { kind: 'shape', id: 's', ...CANVAS }).graphic;
		const original = built.items[0]!;

		const { graphic: next, itemId } = duplicateGraphicItem(built, 't', {
			nextId: ids(),
		});

		expect(next.items.map(item => item.id)).toEqual(['t', 'copy-1', 's']);
		expect(itemId).toBe('copy-1');
		expect(next.items[1]).toMatchObject({ label: `${original.label} copy`, x: original.x + 20, y: original.y + 20 });

		const again = duplicateGraphicItem(next, 't', {
			nextId: ids(),
		});
		expect(again.graphic.items[1]!.label).toBe(`${original.label} copy 2`);
	});

	it('duplicates a Graphic Group with fresh copies of its children', () => {
		const built = withGroup();

		const { graphic: next, itemId } = duplicateGraphicItem(built, 'cluster', {
			nextId: ids(),
		});

		const copy = next.items.find(item => item.id === itemId) as GraphicGroupItemConfig;
		expect(copy.children.map(child => child.id)).toEqual(['copy-2']);
		expect(group(next).children.map(child => child.id)).toEqual(['child']);
		expect(new Set(flattenGraphicItems(next).map(item => item.label)).size).toBe(flattenGraphicItems(next).length);
	});

	it('duplicates a group child within its group', () => {
		const { graphic: next, itemId } = duplicateGraphicItem(withGroup(), 'child', {
			nextId: ids(),
		});

		expect(group(next).children.map(child => child.id)).toEqual(['child', itemId]);
	});

	it('duplicates nothing for an unknown item', () => {
		const built = withGroup();

		expect(duplicateGraphicItem(built, 'missing', {
			nextId: ids(),
		})).toEqual({ graphic: built, itemId: '' });
	});

	it('moves a Graphic Item to the front or the back of its own sibling list', () => {
		let built = graphic('a');
		for (const id of ['one', 'two', 'three'])
			built = addGraphicItem(built, { kind: 'shape', id, ...CANVAS }).graphic;

		expect(moveGraphicItemToEdge(built, 'one', 'front').items.map(item => item.id)).toEqual(['two', 'three', 'one']);
		expect(moveGraphicItemToEdge(built, 'three', 'back').items.map(item => item.id)).toEqual(['three', 'one', 'two']);
		expect(moveGraphicItemToEdge(built, 'three', 'front')).toBe(built);
	});
});

describe('placing a Graphic Item in or out of a Graphic Group (#741)', () => {
	/** Back to front: `lone`; canvas-arranged `box` at (100, 50), padded 10, holding `inner`; row group `row`. */
	function stage(options: { boxRotation?: number; loneRotation?: number } = {}) {
		let built = addGraphicItem(graphic('a'), { kind: 'shape', id: 'lone', ...CANVAS }).graphic;
		built = addGraphicItem(built, { kind: 'group', id: 'box', ...CANVAS }).graphic;
		built = addGraphicGroupChild(built, { kind: 'shape', groupId: 'box', id: 'inner' }).graphic;
		built = addGraphicItem(built, { kind: 'group', id: 'row', ...CANVAS }).graphic;
		built = patchGraphicGroup(built, 'box', { arrangement: 'canvas', padding: 10 });
		built = patchGraphicItem(built, 'box', {
			x: 100,
			y: 50,
			width: 400,
			height: 300,
			rotation: options.boxRotation,
		});
		built = patchGraphicItem(built, 'lone', {
			x: 300,
			y: 200,
			width: 40,
			height: 20,
			rotation: options.loneRotation,
		});
		return patchGraphicItem(built, 'inner', { x: 5, y: 6, width: 30, height: 10 });
	}

	function located(built: BroadcastGraphicConfig, id: string) {
		const location = findGraphicItem(built, id)!;
		return { parent: location.group?.id ?? null, item: location.item };
	}

	function childIds(built: BroadcastGraphicConfig, groupId: string) {
		const found = built.items.find(item => item.id === groupId);
		return found?.type === 'group'
			? found.children.map(child => child.id)
			: [];
	}

	it.each([
		[
			'to the front',
			2,
			['box', 'row', 'lone'],
		],
		[
			'to the back',
			0,
			['lone', 'box', 'row'],
		],
		[
			'past the front, clamped',
			99,
			['box', 'row', 'lone'],
		],
	])('reorders a Graphic Item within its own sibling list %s', (_case, index, order) => {
		expect(placeGraphicItem(stage(), 'lone', { groupId: null, index }).items.map(item => item.id)).toEqual(order);
	});

	it('answers the same graphic when the item already sits there, or is unknown', () => {
		const built = stage();

		expect(placeGraphicItem(built, 'lone', { groupId: null, index: 0 })).toBe(built);
		expect(placeGraphicItem(built, 'missing', { groupId: null, index: 0 })).toBe(built);
	});

	// E13: a canvas group's space is the canvas less its padded corner.
	it('keeps an item drawn where it was: rebased into group space, and back out', () => {
		const into = placeGraphicItem(stage(), 'lone', { groupId: 'box', index: 0 });

		expect(located(into, 'lone')).toMatchObject({
			parent: 'box',
			item: {
				x: 190,
				y: 140,
				width: 40,
				height: 20,
			},
		});
		expect(childIds(into, 'box')).toEqual(['lone', 'inner']);

		const out = placeGraphicItem(into, 'lone', { groupId: null, index: 0 });
		expect(located(out, 'lone')).toMatchObject({
			parent: null,
			item: { x: 300, y: 200 },
		});
		expect(out.items.map(item => item.id)).toEqual(['lone', 'box', 'row']);
	});

	// Top-left: unturning (300, 200) a quarter about the box's corner (100, 50) gives (250, -150).
	// Centre: the item's centre (320, 210) unturned about the box's centre (300, 200) gives (310, 180).
	it.each([
		[
			'top-left',
			{ x: 140, y: -210 },
		],
		[
			'center',
			{ x: 180, y: 110 },
		],
	] as const)('keeps an item drawn where it was across a rotated canvas group, turned against the group, both anchored %s', (anchor, rebased) => {
		let built = patchGraphicItem(stage({ boxRotation: 90 }), 'box', { anchor });
		built = patchGraphicItem(built, 'lone', { anchor });
		const into = placeGraphicItem(built, 'lone', { groupId: 'box', index: 1 });

		expect(located(into, 'lone').item).toMatchObject({ ...rebased, rotation: -90 });

		const out = located(placeGraphicItem(into, 'lone', { groupId: null, index: 0 }), 'lone').item;
		expect(out).toMatchObject({ x: 300, y: 200 });
		expect(out.rotation ?? 0).toBe(0);
	});

	it('takes a child out in canvas space, leaving its group sizing and its group\'s stagger behind', () => {
		let built = patchGraphicGroupChildSizing(stage(), 'inner', { mode: 'fill' });
		built = patchGraphicItemAnimationStagger(built, 'box', 'enter', {
			itemIds: ['inner'],
		});

		const out = placeGraphicItem(built, 'inner', { groupId: null, index: 3 });

		expect(located(out, 'inner')).toMatchObject({
			parent: null,
			item: { x: 115, y: 66 },
		});
		expect(located(out, 'inner').item.sizing).toBeUndefined();
		expect((out.items.find(item => item.id === 'box') as GraphicGroupItemConfig).animation?.stagger).toBeUndefined();
		expect(out.items.map(item => item.id)).toEqual(['lone', 'box', 'row', 'inner']);
	});

	// E14: a row or column child has no rotation, so a rotated item is refused rather than straightened.
	it.each([
		[
			'a rotated item into a row group',
			{ loneRotation: 15 },
			'lone',
			'row',
			'rotated-into-arranged-group',
		],
		[
			'a rotated item into a canvas group',
			{ loneRotation: 15 },
			'lone',
			'box',
			null,
		],
		[
			'an unrotated item into a row group',
			{},
			'lone',
			'row',
			null,
		],
		[
			'a whole turn into a row group',
			{ loneRotation: 360 },
			'lone',
			'row',
			null,
		],
		[
			'a group into a group',
			{},
			'box',
			'row',
			'group-into-group',
		],
		[
			'an item into something not a group',
			{},
			'inner',
			'lone',
			'not-a-group',
		],
	] as const)('refuses or admits %s', (_case, options, itemId, groupId, refusal) => {
		const built = stage(options);

		expect(graphicItemPlacementRefusal(built, itemId, groupId)).toBe(refusal);
		const placed = placeGraphicItem(built, itemId, { groupId, index: 0 });
		if (refusal)
			expect(placed).toBe(built);
		else
			expect(located(placed, itemId).parent).toBe(groupId);
	});
});

describe('grouping and ungrouping Graphic Items (#920)', () => {
	/** Back to front: shapes `back` (100, 100, 200×100), `mid` (50, 400, 10×10) and `front` (500, 300, 100×50). */
	function stage(patches: Record<string, Partial<GraphicItemConfig>> = {}) {
		let built = graphic('a');
		for (const id of ['back', 'mid', 'front'])
			built = addGraphicItem(built, { kind: 'shape', id, ...CANVAS }).graphic;
		built = patchGraphicItem(built, 'back', {
			x: 100,
			y: 100,
			width: 200,
			height: 100,
		});
		built = patchGraphicItem(built, 'mid', { x: 50, y: 400, width: 10, height: 10 });
		built = patchGraphicItem(built, 'front', {
			x: 500,
			y: 300,
			width: 100,
			height: 50,
		});
		for (const [id, patch] of Object.entries(patches))
			built = patchGraphicItem(built, id, patch);
		return built;
	}

	function groupOf(built: BroadcastGraphicConfig, id: string): GraphicGroupItemConfig {
		const found = built.items.find(item => item.id === id);
		if (found?.type !== 'group')
			throw new Error('expected a Graphic Group');
		return found;
	}

	function rectOf(item: GraphicItemConfig | GraphicGroupChildConfig | undefined) {
		return item && {
			x: item.x,
			y: item.y,
			width: item.width,
			height: item.height,
			rotation: item.rotation ?? 0,
		};
	}

	// E11: the box is the union of what the members draw, and children keep where they are drawn.
	it.each([
		[
			'unrotated members',
			{},
			{
				x: 100,
				y: 100,
				width: 500,
				height: 250,
			},
			{
				back: {
					x: 0,
					y: 0,
					width: 200,
					height: 100,
					rotation: 0,
				},
				front: {
					x: 400,
					y: 200,
					width: 100,
					height: 50,
					rotation: 0,
				},
			},
		],
		[
			'a member turned a quarter about its centre, by the box it turns into',
			{
				back: { anchor: 'center', rotation: 90 },
			},
			{
				x: 150,
				y: 50,
				width: 450,
				height: 300,
			},
			{
				back: {
					x: -50,
					y: 50,
					width: 200,
					height: 100,
					rotation: 90,
				},
				front: {
					x: 350,
					y: 250,
					width: 100,
					height: 50,
					rotation: 0,
				},
			},
		],
	] as const)('wraps %s in a canvas group drawn where they were', (_case, patches, box, children) => {
		const grouped = groupGraphicItems(stage(patches as Record<string, Partial<GraphicItemConfig>>), ['front', 'back'], { id: 'pack' });

		expect(grouped.itemId).toBe('pack');
		expect(grouped.graphic.items.map(item => item.id)).toEqual(['mid', 'pack']);
		const pack = groupOf(grouped.graphic, 'pack');
		expect(pack).toMatchObject({
			arrangement: 'canvas',
			padding: 0,
			clip: false,
			visible: true,
			...box,
		});
		expect(pack.surfaceStyle).toBeUndefined();
		expect(pack.children.map(child => child.id)).toEqual(['back', 'front']);
		expect(Object.fromEntries(pack.children.map(child => [
			child.id,
			rectOf(child),
		]))).toEqual(children);
	});

	it('takes the frontmost member\'s slot among the layers it leaves', () => {
		const grouped = groupGraphicItems(stage(), ['back', 'mid'], { id: 'pack' }).graphic;

		expect(grouped.items.map(item => item.id)).toEqual(['pack', 'front']);
		expect(groupOf(grouped, 'pack').children.map(child => child.id)).toEqual(['back', 'mid']);
	});

	// E9: Graphic Groups do not nest, so only two or more top-level non-group items are grouped.
	// Rows marked `packed` group `back` and `mid` into `pack` first.
	it.each([
		[
			'one item',
			false,
			['back'],
			'too-few',
		],
		[
			'one item named twice',
			false,
			['back', 'back'],
			'too-few',
		],
		[
			'an item and an unknown id',
			false,
			['back', 'missing'],
			'too-few',
		],
		[
			'a group with an item',
			true,
			['pack', 'front'],
			'group-into-group',
		],
		[
			'a group child with an item',
			true,
			['back', 'front'],
			'group-child',
		],
		[
			'two top-level items',
			false,
			['mid', 'front'],
			null,
		],
	] as const)('refuses or admits grouping %s', (_case, packed, itemIds, refusal) => {
		const built = packed
			? groupGraphicItems(stage(), ['back', 'mid'], { id: 'pack' }).graphic
			: stage();

		expect(graphicItemsGroupRefusal(built, itemIds)).toBe(refusal);
		const grouped = groupGraphicItems(built, itemIds, { id: 'next' });
		if (refusal)
			expect(grouped.graphic).toBe(built);
		else
			expect(grouped.itemId).toBe('next');
	});

	/** Back to front: shape `lone`, then group `pack` holding shapes `a`, `b` and `c`, then shape `top`. */
	function packed(groupPatch: Partial<GraphicGroupItemConfig>, children: Record<'a' | 'b' | 'c', Partial<GraphicGroupChildConfig>>) {
		let built = addGraphicItem(graphic('a'), { kind: 'shape', id: 'lone', ...CANVAS }).graphic;
		built = addGraphicItem(built, { kind: 'group', id: 'pack', ...CANVAS }).graphic;
		for (const id of ['a', 'b', 'c'] as const) {
			built = addGraphicGroupChild(built, { kind: 'shape', groupId: 'pack', id }).graphic;
			built = patchGraphicItem(built, id, children[id] as Partial<GraphicItemConfig>);
		}
		built = addGraphicItem(built, { kind: 'shape', id: 'top', ...CANVAS }).graphic;
		return patchGraphicItem(built, 'pack', groupPatch as Partial<GraphicItemConfig>);
	}

	// E12: children land on the canvas where their group drew them, in its slot and their order.
	// Row: 380 inner, less a 20 gap and `a`'s fixed 100, leaves 260 for `b` to fill; both centred across 80.
	// Turned: `a`'s corner (115, 66) turned a quarter about the group's corner (100, 50) lands on (84, 65); `b` turns 300 + 90, a 30.
	it.each([
		[
			'a canvas group',
			{
				arrangement: 'canvas',
				x: 100,
				y: 50,
				width: 400,
				height: 300,
				padding: 10,
			},
			{
				a: { x: 5, y: 6, width: 30, height: 10 },
				b: {
					x: 50,
					y: 60,
					width: 20,
					height: 20,
					rotation: 45,
				},
				c: { x: 0, y: 0, width: 10, height: 10 },
			},
			{
				a: {
					x: 115,
					y: 66,
					width: 30,
					height: 10,
					rotation: 0,
				},
				b: {
					x: 160,
					y: 120,
					width: 20,
					height: 20,
					rotation: 45,
				},
				c: {
					x: 110,
					y: 60,
					width: 10,
					height: 10,
					rotation: 0,
				},
			},
		],
		[
			'a canvas group turned a quarter about its corner',
			{
				arrangement: 'canvas',
				x: 100,
				y: 50,
				width: 400,
				height: 300,
				padding: 10,
				rotation: 90,
			},
			{
				a: { x: 5, y: 6, width: 30, height: 10 },
				b: {
					x: 0,
					y: 0,
					width: 10,
					height: 10,
					rotation: 300,
				},
				c: { x: 0, y: 0, width: 10, height: 10 },
			},
			{
				a: {
					x: 84,
					y: 65,
					width: 30,
					height: 10,
					rotation: 90,
				},
				b: {
					x: 90,
					y: 60,
					width: 10,
					height: 10,
					rotation: 30,
				},
				c: {
					x: 90,
					y: 60,
					width: 10,
					height: 10,
					rotation: 90,
				},
			},
		],
		[
			'a row group, one child filling and a hidden one laid out by nobody',
			{
				arrangement: 'row',
				x: 100,
				y: 50,
				width: 400,
				height: 100,
				padding: 10,
				gap: 20,
				align: 'center',
				justify: 'start',
			},
			{
				a: {
					width: 999,
					height: 40,
					sizing: { mode: 'fixed', size: 100, weight: 1 },
				},
				b: {
					width: 5,
					height: 20,
					sizing: { mode: 'fill', size: 0, weight: 1 },
				},
				c: {
					x: 1,
					y: 2,
					width: 10,
					height: 10,
					visible: false,
				},
			},
			{
				a: {
					x: 110,
					y: 80,
					width: 100,
					height: 40,
					rotation: 0,
				},
				b: {
					x: 230,
					y: 90,
					width: 260,
					height: 20,
					rotation: 0,
				},
				c: {
					x: 111,
					y: 62,
					width: 10,
					height: 10,
					rotation: 0,
				},
			},
		],
		[
			'a column group, stretched across and packed to its end',
			{
				arrangement: 'column',
				x: 0,
				y: 0,
				width: 200,
				height: 300,
				padding: 0,
				gap: 10,
				align: 'stretch',
				justify: 'end',
			},
			{
				a: { width: 80, height: 50 },
				b: {
					width: 80,
					height: 999,
					sizing: { mode: 'fixed', size: 60, weight: 1 },
				},
				c: { width: 80, height: 20, rotation: 30 },
			},
			{
				a: {
					x: 0,
					y: 150,
					width: 200,
					height: 50,
					rotation: 0,
				},
				b: {
					x: 0,
					y: 210,
					width: 200,
					height: 60,
					rotation: 0,
				},
				c: {
					x: 0,
					y: 280,
					width: 200,
					height: 20,
					rotation: 0,
				},
			},
		],
		[
			'a row group spacing its children between its ends',
			{
				arrangement: 'row',
				x: 0,
				y: 0,
				width: 300,
				height: 100,
				padding: 0,
				gap: 0,
				align: 'start',
				justify: 'space-between',
			},
			{
				a: { width: 50, height: 10 },
				b: { width: 50, height: 20 },
				c: { width: 50, height: 30 },
			},
			{
				a: {
					x: 0,
					y: 0,
					width: 50,
					height: 10,
					rotation: 0,
				},
				b: {
					x: 125,
					y: 0,
					width: 50,
					height: 20,
					rotation: 0,
				},
				c: {
					x: 250,
					y: 0,
					width: 50,
					height: 30,
					rotation: 0,
				},
			},
		],
	] as const)('ungroups %s without moving a child', (_case, groupPatch, children, landed) => {
		const built = packed(groupPatch as Partial<GraphicGroupItemConfig>, children as Record<'a' | 'b' | 'c', Partial<GraphicGroupChildConfig>>);

		const ungrouped = ungroupGraphicGroup(built, 'pack');

		expect(ungrouped.itemIds).toEqual(['a', 'b', 'c']);
		expect(ungrouped.graphic.items.map(item => item.id)).toEqual(['lone', 'a', 'b', 'c', 'top']);
		expect(Object.fromEntries(['a', 'b', 'c'].map(id => [
			id,
			rectOf(findGraphicItem(ungrouped.graphic, id)?.item),
		]))).toEqual(landed);
		expect(ungrouped.graphic.items.some(item => item.sizing)).toBe(false);
	});

	it('ungroups what it grouped back where it was drawn', () => {
		const built = stage({
			back: { anchor: 'center', rotation: 90 },
		});
		const ungrouped = ungroupGraphicGroup(groupGraphicItems(built, ['back', 'front'], { id: 'pack' }).graphic, 'pack').graphic;

		expect(ungrouped.items.map(item => item.id)).toEqual(['mid', 'back', 'front']);
		expect(ungrouped.items.map(rectOf)).toEqual(['mid', 'back', 'front'].map(id => rectOf(findGraphicItem(built, id)?.item)));
	});

	// E12: what a child inherited is baked in; the group's clipping and animation go with it.
	// The group defaults its children's surface to fill opacity 0.5, bound to `panel`, clips, and staggers `kid`.
	// Hidden row: 380 inner less `kid`'s 50 leaves 330, packed to the end of a row padded 10 at (100, 50).
	it.each([
		[
			'a Text Graphic Item holding no surface takes the group\'s default, bound as it was',
			'text',
			{},
			null,
			{
				visible: true,
				surfaceStyle: { fillOpacity: 0.5 },
				themeBindings: { surfaceStyle: 'panel' },
			},
		],
		[
			'a Shape Graphic Item keeps its own surface',
			'shape',
			{},
			0.25,
			{
				visible: true,
				surfaceStyle: { fillOpacity: 0.25 },
			},
		],
		[
			'a Media Graphic Item paints no surface, so takes none',
			'media',
			{},
			null,
			{ visible: true },
		],
		[
			'a hidden row group\'s child is hidden, where the row laid it out',
			'shape',
			{
				arrangement: 'row',
				visible: false,
				x: 100,
				y: 50,
				width: 400,
				height: 100,
				padding: 10,
				gap: 0,
				align: 'start',
				justify: 'end',
			},
			null,
			{
				visible: false,
				x: 440,
				y: 60,
				width: 50,
				height: 20,
			},
		],
	] as const)('bakes what a child inherits: %s', (_case, kind, groupPatch, own, baked) => {
		let built = addGraphicItem(graphic('a'), { kind: 'group', id: 'pack', ...CANVAS }).graphic;
		built = addGraphicGroupChild(built, { kind, groupId: 'pack', id: 'kid' }).graphic;
		built = patchGraphicItem(built, 'kid', { x: 0, y: 0, width: 50, height: 20 });
		if (own !== null)
			built = patchGraphicSurfaceStyle(built, 'kid', { fillOpacity: own });
		built = patchGraphicGroupDefaultChildSurfaceStyle(built, 'pack', { fillOpacity: 0.5 });
		built = patchGraphicItem(built, 'pack', {
			arrangement: 'canvas',
			clip: true,
			...groupPatch,
			themeBindings: { defaultChildSurfaceStyle: 'panel' },
		} as Partial<GraphicItemConfig>);
		built = patchGraphicItemAnimationStagger(built, 'pack', 'enter', {
			itemIds: ['kid'],
		});

		const ungrouped = ungroupGraphicGroup(built, 'pack').graphic;

		expect(ungrouped.items.map(item => item.id)).toEqual(['kid']);
		expect(ungrouped.items[0]).toMatchObject(baked);
		expect('surfaceStyle' in ungrouped.items[0]!).toBe(kind !== 'media');
		expect(ungrouped.items[0]!.animation).toBeUndefined();
	});

	it.each([
		['a Graphic Item that is not a group', 'lone'],
		['an unknown id', 'missing'],
		['a Social Profile Projection\'s Presentation Group', 'pack'],
	])('answers the same graphic ungrouping %s', (_case, itemId) => {
		let built = packed({ arrangement: 'canvas' }, { a: {}, b: {}, c: {} });
		built = {
			...built,
			socialProfileProjections: [
				{ key: 'talent', sourceKey: 'talent', presentationGroupId: 'pack' },
			],
		} as BroadcastGraphicConfig;

		expect(ungroupGraphicGroup(built, itemId)).toEqual({ graphic: built, itemIds: [] });
	});
});
