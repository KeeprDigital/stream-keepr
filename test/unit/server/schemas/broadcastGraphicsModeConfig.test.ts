import { describe, expect, it } from 'vitest';
import {
	broadcastGraphicsModeConfigSchema,
	MAX_BROADCAST_GRAPHICS_PER_SCREEN,
	MAX_GRAPHIC_CHANNELS_PER_SCREEN,
	MAX_GRAPHIC_GROUP_CHILDREN,
	MAX_GRAPHIC_INPUTS_PER_BROADCAST_GRAPHIC,
	MAX_GRAPHIC_INPUTS_PER_BROADCAST_GRAPHICS_SCREEN,
	MAX_GRAPHIC_ITEM_ID_LENGTH,
	MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHIC,
	MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHICS_SCREEN,
	MAX_GRAPHIC_PLACEHOLDER_STYLES_PER_TEXT_ITEM,
	modeConfigPatchSchemaMap,
	modeConfigsMapSchema,
} from '~~/server/schemas/api/screen';
import { addGraphicItem, getGraphicItemDefinition } from '~~/shared/modules/graphics';
import {
	MAX_GRAPHIC_ANIMATION_DELAY_MS,
	MAX_GRAPHIC_ANIMATION_DURATION_MS,
	MAX_GRAPHIC_ANIMATION_SCALE,
	MAX_GRAPHIC_ANIMATION_STAGGER_STEP_MS,
	MAX_GRAPHIC_TEXT_LENGTH,
	MIN_GRAPHIC_ANIMATION_DURATION_MS,
} from '~~/shared/types/graphics';
import { getDefaultConfigForMode } from '~~/shared/types/screenConfig';
import { randomUuid } from '~~/shared/utils/uuid';

const SQUARE = { treatment: 'square' as const, size: 0 };
const GEOMETRY = {
	topLeft: SQUARE,
	topRight: SQUARE,
	bottomRight: SQUARE,
	bottomLeft: SQUARE,
	leftSlant: 0,
	rightSlant: 0,
};

function shapeItem(id: string, overrides: Record<string, unknown> = {}) {
	return {
		type: 'shape' as const,
		id,
		label: id,
		visible: true,
		anchor: 'top-left' as const,
		x: 0,
		y: 0,
		width: 10,
		height: 10,
		geometry: GEOMETRY,
		surfaceStyle: {
			fill: { type: 'solid', color: '#ffffff' },
			fillOpacity: 1,
		},
		...overrides,
	};
}

function mediaItem(id: string, overrides: Record<string, unknown> = {}) {
	return {
		type: 'media' as const,
		id,
		label: id,
		visible: true,
		anchor: 'top-left' as const,
		x: 0,
		y: 0,
		width: 10,
		height: 10,
		asset: { assetId: 'asset-1', revisionId: 'revision-1' },
		mediaKind: 'image' as const,
		fit: 'cover' as const,
		focalPosition: { horizontal: 0.5, vertical: 0.5 },
		opacity: 1,
		playbackRate: 1,
		loop: true,
		...overrides,
	};
}

function socialNetworkIconItem(id: string, overrides: Record<string, unknown> = {}) {
	return {
		type: 'social-network-icon' as const,
		id,
		label: id,
		visible: true,
		anchor: 'top-left' as const,
		x: 0,
		y: 0,
		width: 64,
		height: 64,
		network: 'twitch' as const,
		color: '#9146ff',
		opacity: 0.8,
		...overrides,
	};
}

function graphic(id: string, itemCount = 0) {
	return {
		id,
		name: id,
		items: Array.from({ length: itemCount }, (_, index) => shapeItem(`${id}-${index}`)),
	};
}

function textInput(key: string) {
	return {
		type: 'text' as const,
		key,
		label: key,
		required: false,
		updatePolicy: 'staged' as const,
		default: '',
		maxLength: MAX_GRAPHIC_TEXT_LENGTH,
	};
}

function messages(result: { error?: { issues: Array<{ message: string }> } }) {
	return result.error?.issues.map(issue => issue.message) ?? [];
}

/** A Text Graphic Item at the definition's defaults. */
function textItem(id: string) {
	return getGraphicItemDefinition('text').createDefault({
		id,
		label: id,
		canvasWidth: 1920,
		canvasHeight: 1080,
	});
}

describe('broadcastGraphicsModeConfigSchema', () => {
	it('names the Broadcast Graphics cap rather than reporting a byte count', () => {
		const graphics = Array.from(
			{ length: MAX_BROADCAST_GRAPHICS_PER_SCREEN + 1 },
			(_, index) => graphic(`graphic-${index}`),
		);

		const result = broadcastGraphicsModeConfigSchema.safeParse({ graphics });

		expect(result.success).toBe(false);
		expect(messages(result)).toEqual([
			`A Broadcast Graphics Screen must not carry more than ${MAX_BROADCAST_GRAPHICS_PER_SCREEN} Broadcast Graphics`,
		]);
	});

	it('names the Graphic Item cap rather than reporting a byte count', () => {
		const result = broadcastGraphicsModeConfigSchema.safeParse({
			graphics: [
				graphic('lower-third', MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHIC + 1),
			],
		});

		expect(result.success).toBe(false);
		// The per-graphic and whole-Screen caps coincide, so both may be reported.
		expect(messages(result)).toContain(
			`A Broadcast Graphic must not contain more than ${MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHIC} Graphic Items`,
		);
		expect(messages(result).every(message => !message.includes('bytes'))).toBe(true);
	});

	it('names the whole-Screen Graphic Item cap rather than reporting a byte count', () => {
		// Under the per-graphic and per-Screen caps, but over their product's budget.
		const perGraphic = 40;
		const graphics = Array.from(
			{
				length: Math.ceil((MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHICS_SCREEN + 1) / perGraphic),
			},
			(_, index) => graphic(`graphic-${index}`, perGraphic),
		);

		const result = broadcastGraphicsModeConfigSchema.safeParse({ graphics });

		expect(result.success).toBe(false);
		expect(messages(result)).toEqual([
			`A Broadcast Graphics Screen must not carry more than ${MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHICS_SCREEN} Graphic Items in total`,
		]);
	});

	it('counts Graphic Group children against the whole-Screen Graphic Item cap', () => {
		const groupOf = (id: string, children: number) => ({
			id,
			name: id,
			items: [
				{
					type: 'group' as const,
					id: `${id}-group`,
					label: 'Block',
					visible: true,
					anchor: 'top-left' as const,
					x: 0,
					y: 0,
					width: 100,
					height: 100,
					arrangement: 'row' as const,
					padding: 0,
					gap: 0,
					align: 'stretch' as const,
					justify: 'start' as const,
					clip: false,
					geometry: GEOMETRY,
					children: Array.from({ length: children }, (_, index) => shapeItem(`${id}-child-${index}`)),
				},
			],
		});

		const perGroup = MAX_GRAPHIC_GROUP_CHILDREN + 1;
		const withinCap = Array.from(
			{
				length: Math.floor(MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHICS_SCREEN / perGroup),
			},
			(_, index) => groupOf(`g${index}`, MAX_GRAPHIC_GROUP_CHILDREN),
		);
		const overCap = Array.from(
			{
				length: Math.ceil((MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHICS_SCREEN + 1) / perGroup),
			},
			(_, index) => groupOf(`g${index}`, MAX_GRAPHIC_GROUP_CHILDREN),
		);

		expect(broadcastGraphicsModeConfigSchema.safeParse({ graphics: withinCap }).success).toBe(true);
		expect(broadcastGraphicsModeConfigSchema.safeParse({ graphics: overCap }).success).toBe(false);
	});

	it('accepts a stack at the whole-Screen Graphic Item cap', () => {
		// One Broadcast Graphic filled to its own cap, and the rest sharing whatever
		// the whole-Screen cap has left.
		const spare = MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHICS_SCREEN - MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHIC;
		const graphics = Array.from(
			{ length: MAX_BROADCAST_GRAPHICS_PER_SCREEN },
			(_, index) => graphic(
				`graphic-${index}`,
				index === 0
					? MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHIC
					: (index <= spare
							? 1
							: 0),
			),
		);

		expect(broadcastGraphicsModeConfigSchema.safeParse({ graphics }).success).toBe(true);
	});

	it('accepts one Broadcast Graphic filled to the per-graphic Graphic Item cap', () => {
		const graphics = [
			graphic('lower-third', MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHIC),
		];

		expect(broadcastGraphicsModeConfigSchema.safeParse({ graphics }).success).toBe(true);
	});

	it('accepts a Broadcast Graphic joining a declared Graphic Channel', () => {
		const config = {
			graphics: [
				{
					...graphic('lower-third-a'),
					channelId: 'thirds',
				},
				{
					...graphic('lower-third-b'),
					channelId: 'thirds',
				},
			],
			channels: [
				{ id: 'thirds', name: 'Lower thirds', handoff: 'out-then-in' as const },
			],
		};

		expect(broadcastGraphicsModeConfigSchema.safeParse(config).success).toBe(true);
	});

	it('accepts a Graphic Channel that states no Handoff Policy, because it defaults to Overlap', () => {
		const config = {
			graphics: [],
			channels: [
				{ id: 'thirds', name: 'Lower thirds' },
			],
		};

		expect(broadcastGraphicsModeConfigSchema.safeParse(config).success).toBe(true);
	});

	it('refuses an unknown Graphic Channel Handoff Policy', () => {
		const config = {
			graphics: [],
			channels: [
				{ id: 'thirds', name: 'Lower thirds', handoff: 'queue' },
			],
		};

		expect(broadcastGraphicsModeConfigSchema.safeParse(config).success).toBe(false);
	});

	it('refuses two Graphic Channels sharing one id', () => {
		const config = {
			graphics: [],
			channels: [
				{ id: 'thirds', name: 'Lower thirds' },
				{ id: 'thirds', name: 'Also lower thirds' },
			],
		};
		const result = broadcastGraphicsModeConfigSchema.safeParse(config);

		expect(result.success).toBe(false);
		expect(messages(result)).toContain('Graphic Channel ids must be unique within one Broadcast Graphics Screen');
	});

	it('names the Graphic Channel cap rather than reporting a byte count', () => {
		const channels = Array.from(
			{ length: MAX_GRAPHIC_CHANNELS_PER_SCREEN + 1 },
			(_, index) => ({ id: `channel-${index}`, name: `Channel ${index}` }),
		);
		const result = broadcastGraphicsModeConfigSchema.safeParse({ graphics: [], channels });

		expect(result.success).toBe(false);
		expect(messages(result)).toContain(
			`A Broadcast Graphics Screen must not declare more than ${MAX_GRAPHIC_CHANNELS_PER_SCREEN} Graphic Channels`,
		);
	});

	it('accepts a Broadcast Graphic naming a Graphic Channel the Screen does not declare', () => {
		// The PATCH path drops object-level refinements, so membership that resolves
		// to nothing is the uniform answer; a deleted channel's graphics keep running.
		const config = {
			graphics: [
				{
					...graphic('bug'),
					channelId: 'deleted',
				},
			],
		};

		expect(broadcastGraphicsModeConfigSchema.safeParse(config).success).toBe(true);
	});

	it('accepts a Broadcast Graphics background naming an Animation Effect this build ships', () => {
		const config = {
			graphics: [],
			background: {
				enabled: true,
				effect: 'fog' as const,
				opacity: 0.6,
				params: { speed: 2 },
			},
		};

		expect(broadcastGraphicsModeConfigSchema.safeParse(config).success).toBe(true);
	});

	it('refuses a background naming an Animation Effect outside the closed vocabulary', () => {
		// The vocabulary refusal, at the write path: an effect this installation does
		// not implement is a capability it lacks, not a value it can approximate.
		const config = {
			graphics: [],
			background: { enabled: true, effect: 'vanta-birds', opacity: 0.6 },
		};

		expect(broadcastGraphicsModeConfigSchema.safeParse(config).success).toBe(false);
	});

	it('refuses a background carrying params the named effect does not declare', () => {
		const config = {
			graphics: [],
			background: {
				enabled: true,
				effect: 'fog' as const,
				opacity: 0.6,
				params: { lightColor: '#7dd3fc' },
			},
		};

		expect(broadcastGraphicsModeConfigSchema.safeParse(config).success).toBe(false);
	});

	it('accepts a Screen with no background at all, which is what every Screen ships as', () => {
		expect(broadcastGraphicsModeConfigSchema.safeParse({ graphics: [] }).success).toBe(true);
	});

	it('carries the background through the mode-configuration patch path', () => {
		// The path the editor writes through rebuilds each mode from its field schemas,
		// so a background that only validates in the whole-config schema never reaches it.
		const patch = modeConfigPatchSchemaMap['broadcast-graphics'].safeParse({
			background: { enabled: true, effect: 'caustics', opacity: 0.35 },
		});

		expect(patch.success).toBe(true);
		expect(modeConfigPatchSchemaMap['broadcast-graphics'].safeParse({
			background: { enabled: true, effect: 'vanta-birds', opacity: 0.35 },
		}).success).toBe(false);
	});

	it('carries Graphic Channels through the mode-configuration patch path', () => {
		// The path the editors write through rebuilds each mode from its field schemas,
		// so a field that only validates in the whole-config schema never reaches it.
		const patch = modeConfigPatchSchemaMap['broadcast-graphics'].safeParse({
			channels: [
				{ id: 'thirds', name: 'Lower thirds', handoff: 'out-then-in' },
			],
		});

		expect(patch.success).toBe(true);
		expect(modeConfigPatchSchemaMap['broadcast-graphics'].safeParse({
			channels: [
				{ id: 'thirds', name: 'A' },
				{ id: 'thirds', name: 'B' },
			],
		}).success).toBe(false);
	});

	it('names the whole-Screen Graphic Input cap rather than reporting a byte count', () => {
		const perGraphic = MAX_GRAPHIC_INPUTS_PER_BROADCAST_GRAPHIC;
		const graphics = Array.from(
			{
				length: Math.ceil((MAX_GRAPHIC_INPUTS_PER_BROADCAST_GRAPHICS_SCREEN + 1) / perGraphic),
			},
			(_, index) => ({
				...graphic(`graphic-${index}`),
				inputs: Array.from({ length: perGraphic }, (_, entry) => textInput(`k${index}x${entry}`)),
			}),
		);

		const result = broadcastGraphicsModeConfigSchema.safeParse({ graphics });

		expect(result.success).toBe(false);
		expect(messages(result)).toContain(
			`A Broadcast Graphics Screen must not declare more than ${MAX_GRAPHIC_INPUTS_PER_BROADCAST_GRAPHICS_SCREEN} Graphic Inputs in total`,
		);
	});

	it('applies the whole-Screen Graphic Input cap on the patch path the editor writes through', () => {
		// Same reason the Graphic Item cap lives on the array: the patch schema rebuilds
		// each mode from its field schemas and drops object-level refinements.
		const perGraphic = MAX_GRAPHIC_INPUTS_PER_BROADCAST_GRAPHIC;
		const graphics = Array.from(
			{
				length: Math.ceil((MAX_GRAPHIC_INPUTS_PER_BROADCAST_GRAPHICS_SCREEN + 1) / perGraphic),
			},
			(_, index) => ({
				...graphic(`graphic-${index}`),
				inputs: Array.from({ length: perGraphic }, (_, entry) => textInput(`k${index}x${entry}`)),
			}),
		);

		const result = modeConfigPatchSchemaMap['broadcast-graphics'].safeParse({ graphics });

		expect(result.success).toBe(false);
		expect(messages(result)).toContain(
			`A Broadcast Graphics Screen must not declare more than ${MAX_GRAPHIC_INPUTS_PER_BROADCAST_GRAPHICS_SCREEN} Graphic Inputs in total`,
		);
	});

	it('rejects two Graphic Inputs sharing one key, and two bindings for one input', () => {
		// Every placeholder, binding, and Live Control edit addresses an input by key
		// alone, so a duplicate would render, bind, and edit whichever came first.
		const duplicateKeys = broadcastGraphicsModeConfigSchema.safeParse({
			graphics: [
				{
					...graphic('lower-third'),
					inputs: [
						textInput('name'),
						textInput('name'),
					],
				},
			],
		});
		const duplicateBindings = broadcastGraphicsModeConfigSchema.safeParse({
			graphics: [
				{
					...graphic('lower-third'),
					inputs: [
						textInput('name'),
					],
					sources: [
						{ key: 'player', label: 'Player', kind: 'feature-match-slot' },
					],
					bindings: [
						{ inputKey: 'name', sourceKey: 'player', fieldId: 'name' },
						{ inputKey: 'name', sourceKey: 'player', fieldId: 'name' },
					],
				},
			],
		});

		expect(messages(duplicateKeys)).toContain('Graphic Input keys must be unique within one Broadcast Graphic');
		expect(messages(duplicateBindings)).toContain('A Graphic Input may have at most one Graphic Input Binding');
	});

	it('rejects a Graphic Input key a Graphic Text Template could not name', () => {
		const result = broadcastGraphicsModeConfigSchema.safeParse({
			graphics: [
				{
					...graphic('lower-third'),
					inputs: [
						textInput('2 names'),
					],
				},
			],
		});

		expect(result.success).toBe(false);
	});

	it('caps the Graphic Placeholder Styles one Text Graphic Item may define', () => {
		const styles = (count: number) => Object.fromEntries(
			Array.from({ length: count }, (_, index) => [
				`k${index}`,
				{ fontWeight: 700 },
			]),
		);
		const withStyles = (count: number) => ({
			graphics: [
				{
					...graphic('lower-third'),
					items: [
						{
							...textItem('t'),
							placeholderStyles: styles(count),
						},
					],
				},
			],
		});

		expect(broadcastGraphicsModeConfigSchema.safeParse(
			withStyles(MAX_GRAPHIC_PLACEHOLDER_STYLES_PER_TEXT_ITEM),
		).success).toBe(true);
		expect(broadcastGraphicsModeConfigSchema.safeParse(
			withStyles(MAX_GRAPHIC_PLACEHOLDER_STYLES_PER_TEXT_ITEM + 1),
		).success).toBe(false);
	});

	it('applies the whole-Screen Graphic Item cap on the patch path the editor writes through', () => {
		// The patch schema rebuilds each mode from its field schemas, so a cap that
		// lived on the mode-config object would never reach a real write.
		const perGraphic = 40;
		const graphics = Array.from(
			{
				length: Math.ceil((MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHICS_SCREEN + 1) / perGraphic),
			},
			(_, index) => graphic(`graphic-${index}`, perGraphic),
		);

		const result = modeConfigPatchSchemaMap['broadcast-graphics'].safeParse({ graphics });

		expect(result.success).toBe(false);
		expect(messages(result)).toEqual([
			`A Broadcast Graphics Screen must not carry more than ${MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHICS_SCREEN} Graphic Items in total`,
		]);
	});

	it('rejects a null Broadcast Graphics stack, so a patch can never delete the authored stack', () => {
		// null deletes a stored key, which would silently empty the authored stack.
		const result = modeConfigPatchSchemaMap['broadcast-graphics'].safeParse({ graphics: null });

		expect(result.success).toBe(false);
	});

	it('accepts a patch that replaces the whole stack, and one that omits it', () => {
		const patch = modeConfigPatchSchemaMap['broadcast-graphics'];

		expect(patch.safeParse({
			graphics: [
				graphic('bug', 1),
			],
		}).success).toBe(true);
		expect(patch.safeParse({}).success).toBe(true);
	});

	it('accepts the Broadcast Graphics config a new Screen ships with', () => {
		// The shipped default has to satisfy the wire schema, or a Screen switched
		// into Broadcast Graphics could not persist its own starting configuration.
		const result = broadcastGraphicsModeConfigSchema.safeParse(
			getDefaultConfigForMode('broadcast-graphics'),
		);

		expect(result.success).toBe(true);
		expect(result.data?.graphics).toEqual([]);
	});

	it('rejects an unknown Graphic Item kind', () => {
		const result = broadcastGraphicsModeConfigSchema.safeParse({
			graphics: [
				{
					id: 'a',
					name: 'A',
					items: [
						{
							type: 'gauge',
							id: 'meter',
							label: 'Meter',
							visible: true,
							anchor: 'top-left',
							x: 0,
							y: 0,
							width: 10,
							height: 10,
						},
					],
				},
			],
		});

		expect(result.success).toBe(false);
	});

	describe('social network icon Graphic Items', () => {
		function withItems(items: Array<Record<string, unknown>>) {
			return broadcastGraphicsModeConfigSchema.safeParse({
				graphics: [
					{ id: 'a', name: 'A', items },
				],
			});
		}

		it('accepts every statically selected Supported Social Network and rejects invented keys', () => {
			for (const network of [
				'twitch',
				'youtube',
				'x',
				'instagram',
				'tiktok',
				'bluesky',
			]) {
				expect(withItems([
					socialNetworkIconItem(`icon-${network}`, { network }),
				]).success).toBe(true);
			}

			expect(withItems([
				socialNetworkIconItem('icon-mastodon', { network: 'mastodon' }),
			]).success).toBe(false);
		});

		it('bounds opacity and rejects unread configuration fields', () => {
			expect(withItems([
				socialNetworkIconItem('icon', { opacity: 0 }),
			]).success).toBe(true);
			expect(withItems([
				socialNetworkIconItem('icon', { opacity: 1 }),
			]).success).toBe(true);
			expect(withItems([
				socialNetworkIconItem('icon', { opacity: -0.1 }),
			]).success).toBe(false);
			expect(withItems([
				socialNetworkIconItem('icon', { opacity: 1.1 }),
			]).success).toBe(false);
			expect(withItems([
				socialNetworkIconItem('icon', {
					asset: { assetId: 'icon', revisionId: '1' },
				}),
			]).success).toBe(false);
		});

		it('accepts the icon in every ordinary Graphic Group arrangement', () => {
			for (const arrangement of ['row', 'column', 'canvas']) {
				const result = withItems([
					{
						type: 'group',
						id: `group-${arrangement}`,
						label: arrangement,
						visible: true,
						anchor: 'top-left',
						x: 0,
						y: 0,
						width: 100,
						height: 50,
						arrangement,
						padding: 0,
						gap: 0,
						align: 'stretch',
						justify: 'start',
						clip: true,
						geometry: GEOMETRY,
						children: [
							socialNetworkIconItem(`icon-${arrangement}`, {
								sizing: { mode: 'fill', size: 0, weight: 1 },
							}),
						],
					},
				]);

				expect(result.success).toBe(true);
			}
		});

		it('keeps Social Network Icons out of Feature Match Overlay documents', () => {
			const config = structuredClone(getDefaultConfigForMode('feature-match-overlay'));
			config.layout.composition.items = [
				socialNetworkIconItem('social-icon'),
			];

			expect(modeConfigsMapSchema.safeParse({ 'feature-match-overlay': config }).success).toBe(false);
		});

		it('keeps dynamic Social Profile Projection icons and declarations out of Feature Match documents', () => {
			const config = structuredClone(getDefaultConfigForMode('feature-match-overlay')) as unknown as Record<string, any>;
			config.layout.composition.items = [
				socialNetworkIconItem('social-icon', {
					network: { projectionKey: 'profile' },
				}),
			];
			config.layout.composition.socialProfileProjections = [
				{
					key: 'profile',
					label: 'Profile',
					sourceKey: 'talent',
					presentationGroupId: 'profile-group',
					dwellMs: 8_000,
					transition: 'crossfade',
					transitionDurationMs: 250,
				},
			];

			expect(modeConfigsMapSchema.safeParse({ 'feature-match-overlay': config }).success).toBe(false);
		});

		it('keeps Social Profile Projection placeholder styles out of Feature Match documents', () => {
			const config = structuredClone(getDefaultConfigForMode('feature-match-overlay')) as unknown as Record<string, any>;
			const authored = addGraphicItem(
				{ id: 'feature-match', name: 'Feature Match', items: [] },
				{
					kind: 'text',
					id: 'player-name',
					canvasWidth: 1920,
					canvasHeight: 1080,
				},
			).graphic.items[0];
			if (authored?.type !== 'text')
				throw new Error('expected a Feature Match Text Graphic Item');
			authored.placeholderStyles = {
				'profile.handle': { color: '#ffffff' },
			};
			config.layout.composition.items = [authored];

			expect(modeConfigsMapSchema.safeParse({ 'feature-match-overlay': config }).success).toBe(false);
		});
	});

	describe('media Graphic Items', () => {
		function withItems(items: Array<Record<string, unknown>>) {
			return broadcastGraphicsModeConfigSchema.safeParse({
				graphics: [
					{ id: 'a', name: 'A', items },
				],
			});
		}

		it('accepts a Media Graphic Item pinning one exact identity and revision', () => {
			const result = withItems([
				mediaItem('logo'),
			]);

			expect(result.success).toBe(true);
			const item = result.data?.graphics[0]?.items[0];
			expect(item?.type === 'media' && item.asset).toEqual({ assetId: 'asset-1', revisionId: 'revision-1' });
		});

		it('accepts one with no asset pinned, and none with a partial reference', () => {
			// An author places the rectangle before choosing content, so an absent asset
			// is a complete item. Half a reference is not: it pins no exact revision.
			expect(withItems([
				mediaItem('logo', { asset: undefined }),
			]).success).toBe(true);
			expect(withItems([
				mediaItem('logo', {
					asset: { assetId: 'asset-1' },
				}),
			]).success).toBe(false);
			expect(withItems([
				mediaItem('logo', {
					asset: { revisionId: 'revision-1' },
				}),
			]).success).toBe(false);
			expect(withItems([
				mediaItem('logo', {
					asset: { assetId: 'asset-1', revisionId: 'revision-1', latest: true },
				}),
			]).success).toBe(false);
		});

		it('bounds fitting, focal position, opacity, and playback rate', () => {
			expect(withItems([
				mediaItem('logo', { fit: 'stretch' }),
			]).success).toBe(false);
			expect(withItems([
				mediaItem('logo', { mediaKind: 'audio' }),
			]).success).toBe(false);
			expect(withItems([
				mediaItem('logo', {
					focalPosition: { horizontal: 1.5, vertical: 0.5 },
				}),
			]).success).toBe(false);
			expect(withItems([
				mediaItem('logo', {
					focalPosition: { horizontal: 0.5 },
				}),
			]).success).toBe(false);
			expect(withItems([
				mediaItem('logo', { opacity: -0.1 }),
			]).success).toBe(false);
			expect(withItems([
				mediaItem('logo', { playbackRate: 0 }),
			]).success).toBe(false);
			expect(withItems([
				mediaItem('logo', { playbackRate: 8 }),
			]).success).toBe(false);
			expect(withItems([
				mediaItem('logo', { playbackRate: 0.25 }),
			]).success).toBe(true);
			expect(withItems([
				mediaItem('logo', { playbackRate: 4 }),
			]).success).toBe(true);
		});

		it('clips with the canonical Shape Geometry, and rejects the discarded media-clip encoding', () => {
			// The media-clip encoding #89 discarded must not creep back.
			expect(withItems([
				mediaItem('logo', { clipGeometry: GEOMETRY }),
			]).success).toBe(true);
			expect(withItems([
				mediaItem('logo', { clipGeometry: undefined }),
			]).success).toBe(true);
			expect(withItems([
				mediaItem('logo', {
					clipGeometry: {
						topLeft: { kind: 'rounded', size: 8 },
						topRight: { kind: 'square' },
						bottomRight: { kind: 'square' },
						bottomLeft: { kind: 'square' },
						leftEdgeSlant: 4,
					},
				}),
			]).success).toBe(false);
		});

		it('rejects a Graphic Surface Style on a Media Graphic Item', () => {
			// It paints an asset, not a surface, so a fill would be an unread field the
			// compositor silently ignores.
			expect(withItems([
				mediaItem('logo', {
					surfaceStyle: {
						fill: { type: 'solid', color: '#ffffff' },
						fillOpacity: 1,
					},
				}),
			]).success).toBe(false);
		});

		it('accepts a Media Graphic Item as a Graphic Group child with main-axis sizing', () => {
			const result = withItems([
				{
					type: 'group',
					id: 'cluster',
					label: 'Cluster',
					visible: true,
					anchor: 'top-left',
					x: 0,
					y: 0,
					width: 100,
					height: 50,
					arrangement: 'row',
					padding: 0,
					gap: 0,
					align: 'stretch',
					justify: 'start',
					clip: false,
					geometry: GEOMETRY,
					children: [
						mediaItem('badge', {
							sizing: { mode: 'fill', size: 0, weight: 2 },
						}),
					],
				},
			]);

			expect(result.success).toBe(true);
		});

		it('rejects main-axis sizing on a top-level Media Graphic Item', () => {
			// Only a Graphic Group child has a group to be sized inside.
			expect(withItems([
				mediaItem('logo', {
					sizing: { mode: 'fill', size: 0, weight: 2 },
				}),
			]).success).toBe(false);
		});

		it('counts a Media Graphic Item towards the whole-Screen Graphic Item cap', () => {
			const overCap = Array.from(
				{ length: MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHICS_SCREEN + 1 },
				(_, index) => mediaItem(`logo-${index}`),
			);

			expect(withItems(overCap).success).toBe(false);
		});
	});

	it('rejects a Graphic Group inside a Graphic Group', () => {
		const child = {
			type: 'group' as const,
			id: 'inner',
			label: 'Inner',
			visible: true,
			anchor: 'top-left' as const,
			x: 0,
			y: 0,
			width: 10,
			height: 10,
			arrangement: 'row' as const,
			padding: 0,
			gap: 0,
			align: 'stretch' as const,
			justify: 'start' as const,
			clip: false,
			geometry: GEOMETRY,
			children: [],
		};

		const result = broadcastGraphicsModeConfigSchema.safeParse({
			graphics: [
				{
					id: 'a',
					name: 'A',
					items: [
						{
							...child,
							id: 'outer',
							children: [child],
						},
					],
				},
			],
		});

		expect(result.success).toBe(false);
	});

	it('bounds a linear-gradient Graphic Fill to two to four colour stops', () => {
		const withStops = (count: number) => broadcastGraphicsModeConfigSchema.safeParse({
			graphics: [
				{
					id: 'a',
					name: 'A',
					items: [
						shapeItem('bed', {
							surfaceStyle: {
								fill: {
									type: 'linear-gradient',
									angle: 90,
									stops: Array.from({ length: count }, (_, index) => ({
										color: '#ffffff',
										position: index / Math.max(1, count - 1),
										opacity: 1,
									})),
								},
								fillOpacity: 1,
							},
						}),
					],
				},
			],
		}).success;

		expect(withStops(1)).toBe(false);
		expect(withStops(2)).toBe(true);
		expect(withStops(4)).toBe(true);
		expect(withStops(5)).toBe(false);
	});

	it('accepts an item with no Graphic Surface Style of its own', () => {
		const result = broadcastGraphicsModeConfigSchema.safeParse({
			graphics: [
				{
					id: 'a',
					name: 'A',
					items: [
						shapeItem('bare', { surfaceStyle: undefined }),
					],
				},
			],
		});

		expect(result.success).toBe(true);
	});

	it('bounds a Text Graphic Item to the shared text length, and no further', () => {
		const withText = (length: number) => broadcastGraphicsModeConfigSchema.safeParse({
			graphics: [
				{
					id: 'a',
					name: 'A',
					items: [
						{
							type: 'text',
							id: 'name',
							label: 'Text 1',
							visible: true,
							anchor: 'top-left',
							x: 0,
							y: 0,
							width: 10,
							height: 10,
							text: 'T'.repeat(length),
							typography: {
								font: { kind: 'application', fontId: 'inter' },
								fontSize: 64,
								fontWeight: 700,
								fontStyle: 'normal',
								textTransform: 'none',
								letterSpacing: 0,
								lineHeight: 1.15,
								textAlign: 'left',
								color: '#ffffff',
							},
							overflowPolicy: 'ellipsis',
							minFontSize: 24,
						},
					],
				},
			],
		}).success;

		expect(MAX_GRAPHIC_TEXT_LENGTH).toBe(1000);
		expect(withText(MAX_GRAPHIC_TEXT_LENGTH)).toBe(true);
		expect(withText(MAX_GRAPHIC_TEXT_LENGTH + 1)).toBe(false);
	});

	it('rejects duplicate Graphic Item ids, at either level of one Broadcast Graphic', () => {
		// Authoring addresses an item by id alone, across the top level and groups.
		const group = (children: ReturnType<typeof shapeItem>[]) => ({
			type: 'group' as const,
			id: 'cluster',
			label: 'Block',
			visible: true,
			anchor: 'top-left' as const,
			x: 0,
			y: 0,
			width: 100,
			height: 100,
			arrangement: 'row' as const,
			padding: 0,
			gap: 0,
			align: 'stretch' as const,
			justify: 'start' as const,
			clip: false,
			geometry: GEOMETRY,
			children,
		});
		const parse = (items: unknown[]) => broadcastGraphicsModeConfigSchema.safeParse({
			graphics: [
				{ id: 'a', name: 'A', items },
			],
		});

		expect(parse([
			shapeItem('bar'),
			shapeItem('bar'),
		]).success).toBe(false);
		expect(parse([
			shapeItem('bar'),
			group([
				shapeItem('bar'),
			]),
		]).success).toBe(false);
		expect(parse([
			group([
				shapeItem('one'),
				shapeItem('one'),
			]),
		]).success).toBe(false);
		expect(parse([
			shapeItem('bar'),
			group([
				shapeItem('one'),
			]),
		]).success).toBe(true);
		// Two Broadcast Graphics may each hold an item of the same id.
		expect(broadcastGraphicsModeConfigSchema.safeParse({
			graphics: [
				{
					id: 'a',
					name: 'A',
					items: [
						shapeItem('bar'),
					],
				},
				{
					id: 'b',
					name: 'B',
					items: [
						shapeItem('bar'),
					],
				},
			],
		}).success).toBe(true);
	});

	it('bounds a Graphic Item id to the identity length this application writes', () => {
		// Every id this application writes is a uuid; Template Package import proves
		// documents against this same schema, so the bound holds there too.
		const withId = (length: number) => broadcastGraphicsModeConfigSchema.safeParse({
			graphics: [
				{
					id: 'a',
					name: 'A',
					items: [
						shapeItem('i'.repeat(length)),
					],
				},
			],
		}).success;

		expect(MAX_GRAPHIC_ITEM_ID_LENGTH).toBe(64);
		expect(MAX_GRAPHIC_ITEM_ID_LENGTH).toBeGreaterThan(randomUuid().length);
		expect(withId(MAX_GRAPHIC_ITEM_ID_LENGTH)).toBe(true);
		expect(withId(MAX_GRAPHIC_ITEM_ID_LENGTH + 1)).toBe(false);
	});

	it('bounds a staggered id to the same length, because it names a Graphic Item', () => {
		const withStaggeredId = (length: number) => broadcastGraphicsModeConfigSchema.safeParse({
			graphics: [
				{
					id: 'a',
					name: 'A',
					items: [
						shapeItem('bar'),
					],
					animation: {
						stagger: {
							enter: {
								order: 'list',
								step: 100,
								itemIds: [
									's'.repeat(length),
								],
							},
						},
					},
				},
			],
		}).success;

		expect(withStaggeredId(MAX_GRAPHIC_ITEM_ID_LENGTH)).toBe(true);
		expect(withStaggeredId(MAX_GRAPHIC_ITEM_ID_LENGTH + 1)).toBe(false);
	});

	it('rejects main-axis sizing on a top-level Graphic Item, which no group sizes', () => {
		const result = broadcastGraphicsModeConfigSchema.safeParse({
			graphics: [
				{
					id: 'a',
					name: 'A',
					items: [
						shapeItem('bar', {
							sizing: { mode: 'fill', size: 0, weight: 1 },
						}),
					],
				},
			],
		});

		expect(result.success).toBe(false);
	});
});

describe('graphic Animation bounds', () => {
	function withItemAnimation(animation: unknown) {
		return broadcastGraphicsModeConfigSchema.safeParse({
			graphics: [
				{
					id: 'a',
					name: 'A',
					items: [
						shapeItem('bar', { animation }),
					],
				},
			],
		});
	}

	function withGraphicAnimation(animation: unknown) {
		return broadcastGraphicsModeConfigSchema.safeParse({
			graphics: [
				{
					id: 'a',
					name: 'A',
					items: [
						shapeItem('bar'),
					],
					animation,
				},
			],
		});
	}

	const recipe = { duration: 400, easing: 'ease-out' as const, delay: 0 };

	const enter = (patch: Record<string, unknown>) => ({
		enter: {
			...recipe,
			...patch,
		},
	});

	it.each([
		['no Graphic Animation at all', undefined, true],
		[
			'the shortest duration',
			enter({ duration: MIN_GRAPHIC_ANIMATION_DURATION_MS }),
			true,
		],
		[
			'the longest duration',
			enter({ duration: MAX_GRAPHIC_ANIMATION_DURATION_MS }),
			true,
		],
		[
			'a duration under the minimum',
			enter({ duration: MIN_GRAPHIC_ANIMATION_DURATION_MS - 1 }),
			false,
		],
		[
			'a duration over the maximum',
			enter({ duration: MAX_GRAPHIC_ANIMATION_DURATION_MS + 1 }),
			false,
		],
		[
			'the longest delay',
			enter({ delay: MAX_GRAPHIC_ANIMATION_DELAY_MS }),
			true,
		],
		[
			'a delay over the maximum',
			enter({ delay: MAX_GRAPHIC_ANIMATION_DELAY_MS + 1 }),
			false,
		],
		[
			'a negative delay',
			enter({ delay: -1 }),
			false,
		],
		[
			'a free-form easing',
			enter({ easing: 'cubic-bezier(0,0,1,1)' }),
			false,
		],
		[
			'a fade to zero',
			enter({
				fade: { opacity: 0 },
			}),
			true,
		],
		[
			'a fade below zero',
			enter({
				fade: { opacity: -0.1 },
			}),
			false,
		],
		[
			'a fade above one',
			enter({
				fade: { opacity: 1.1 },
			}),
			false,
		],
		[
			'a scale from zero',
			enter({
				scale: { factor: 0, origin: 'center' },
			}),
			true,
		],
		[
			'the largest scale',
			enter({
				scale: { factor: MAX_GRAPHIC_ANIMATION_SCALE, origin: 'top-left' },
			}),
			true,
		],
		[
			'a scale over the maximum',
			enter({
				scale: { factor: MAX_GRAPHIC_ANIMATION_SCALE + 0.01, origin: 'center' },
			}),
			false,
		],
		[
			'an unknown scale origin',
			enter({
				scale: { factor: 1, origin: 'middle' },
			}),
			false,
		],
		[
			'a slide clearing its parent',
			enter({
				slide: { direction: 'north', distanceMode: 'clear-parent', distance: 0 },
			}),
			true,
		],
		[
			'a negative slide distance',
			enter({
				slide: { direction: 'north', distanceMode: 'fixed', distance: -1 },
			}),
			false,
		],
		[
			'an unknown slide direction',
			enter({
				slide: { direction: 'inward', distanceMode: 'fixed', distance: 1 },
			}),
			false,
		],
		[
			'an unknown reveal edge',
			enter({
				reveal: { edge: 'diagonal' },
			}),
			false,
		],
		[
			'a recipe for every lifecycle phase',
			{
				'enter': recipe,
				'on-screen': { ...recipe, pause: 0, repeat: 1 },
				'update': recipe,
				'exit': recipe,
			},
			true,
		],
		[
			'an unknown lifecycle phase',
			{ hover: recipe },
			false,
		],
		[
			'a rotation',
			enter({
				rotate: { degrees: 90 },
			}),
			false,
		],
		[
			'a skew',
			enter({
				skew: { x: 10 },
			}),
			false,
		],
		[
			'a filter',
			enter({
				blur: { radius: 4 },
			}),
			false,
		],
		[
			'keyframes',
			enter({ keyframes: [] }),
			false,
		],
	])('takes a Graphic Item animation with %s → %s', (_case, animation, accepted) => {
		expect(withItemAnimation(animation).success).toBe(accepted);
	});

	it.each([
		[{}, true],
		[
			{ repeat: 100 },
			true,
		],
		[
			{ repeat: 'indefinite' },
			true,
		],
		[
			{ pause: 60000 },
			true,
		],
		[
			{ repeat: 0 },
			false,
		],
		[
			{ repeat: 101 },
			false,
		],
		[
			{ repeat: 1.5 },
			false,
		],
		[
			{ repeat: 'forever' },
			false,
		],
		[
			{ pause: 60001 },
			false,
		],
	])('bounds on-screen repetition and pause: %j → %s', (patch, accepted) => {
		expect(withItemAnimation({
			'on-screen': {
				...recipe,
				pause: 0,
				repeat: 1,
				...patch,
			},
		}).success).toBe(accepted);
	});

	it('refuses on-screen repetition and pause on a phase that does not cycle', () => {
		expect(withItemAnimation({
			enter: { ...recipe, pause: 0, repeat: 2 },
		}).success).toBe(false);
	});

	it('lets a Broadcast Graphic and a Graphic Group stagger their direct items, and nothing else', () => {
		const stagger = {
			order: 'reverse-list' as const,
			step: 120,
			itemIds: ['bar'],
		};

		expect(withGraphicAnimation({
			stagger: { exit: stagger },
		}).success).toBe(true);
		// A Text or Shape Graphic Item has no direct items to order.
		expect(withItemAnimation({
			stagger: { exit: stagger },
		}).success).toBe(false);
	});

	it('bounds a stagger step to ten seconds', () => {
		const stagger = (step: number) => withGraphicAnimation({
			stagger: {
				enter: {
					order: 'list',
					step,
					itemIds: ['bar'],
				},
			},
		}).success;

		expect(stagger(MAX_GRAPHIC_ANIMATION_STAGGER_STEP_MS)).toBe(true);
		expect(stagger(MAX_GRAPHIC_ANIMATION_STAGGER_STEP_MS + 1)).toBe(false);
		expect(stagger(-1)).toBe(false);
	});

	it('accepts a stagger naming an item that is no longer in the composition', () => {
		// Deleting a staggered Graphic Item must not refuse the author's next write.
		expect(withGraphicAnimation({
			stagger: {
				enter: {
					order: 'list',
					step: 100,
					itemIds: ['deleted'],
				},
			},
		}).success).toBe(true);
	});

	it('bounds a stagger to the number of Graphic Items its container holds', () => {
		// A stagger names a subset of its container's direct Graphic Items (#99).
		const staggerOf = (items: number, ids: number) => broadcastGraphicsModeConfigSchema.safeParse({
			graphics: [
				{
					id: 'a',
					name: 'A',
					items: Array.from({ length: items }, (_, index) => shapeItem(`bar-${index}`)),
					animation: {
						stagger: {
							enter: {
								order: 'list' as const,
								step: 100,
								itemIds: Array.from({ length: ids }, (_, index) => `bar-${index}`),
							},
						},
					},
				},
			],
		});

		expect(staggerOf(3, 3).success).toBe(true);
		expect(staggerOf(3, 2).success).toBe(true);
		expect(staggerOf(3, 4).success).toBe(false);
		expect(messages(staggerOf(3, 4))).toContain(
			'A Graphic Animation Stagger must not name more Graphic Items than its container holds',
		);
	});

	it('counts a Graphic Group\'s own children rather than the whole graphic', () => {
		const groupWith = (children: number, ids: number) => broadcastGraphicsModeConfigSchema.safeParse({
			graphics: [
				{
					id: 'a',
					name: 'A',
					items: [
						{
							type: 'group' as const,
							id: 'cluster',
							label: 'Cluster',
							visible: true,
							anchor: 'top-left' as const,
							x: 0,
							y: 0,
							width: 100,
							height: 100,
							arrangement: 'row' as const,
							padding: 0,
							gap: 0,
							align: 'stretch' as const,
							justify: 'start' as const,
							clip: false,
							geometry: GEOMETRY,
							children: Array.from({ length: children }, (_, index) => shapeItem(`child-${index}`)),
							animation: {
								stagger: {
									exit: {
										order: 'list' as const,
										step: 100,
										itemIds: Array.from({ length: ids }, (_, index) => `child-${index}`),
									},
								},
							},
						},
					],
					animation: {
						stagger: {
							exit: {
								order: 'list' as const,
								step: 100,
								itemIds: ['cluster'],
							},
						},
					},
				},
			],
		});

		expect(groupWith(4, 4).success).toBe(true);
		expect(groupWith(4, 5).success).toBe(false);
	});

	it('bounds a stagger on the patch path the editor writes through', () => {
		const patch = modeConfigPatchSchemaMap['broadcast-graphics'].safeParse({
			graphics: [
				{
					id: 'a',
					name: 'A',
					items: [
						shapeItem('bar'),
					],
					animation: {
						stagger: {
							enter: {
								order: 'list',
								step: 100,
								itemIds: ['bar', 'gone'],
							},
						},
					},
				},
			],
		});

		expect(patch.success).toBe(false);
	});

	it('applies every animation bound on the patch path the editor writes through', () => {
		const patch = modeConfigPatchSchemaMap['broadcast-graphics'];
		const withDuration = (duration: number) => patch.safeParse({
			graphics: [
				{
					id: 'a',
					name: 'A',
					items: [
						shapeItem('bar', {
							animation: {
								enter: { ...recipe, duration },
							},
						}),
					],
				},
			],
		}).success;

		expect(withDuration(400)).toBe(true);
		expect(withDuration(MAX_GRAPHIC_ANIMATION_DURATION_MS + 1)).toBe(false);
		expect(withDuration(MIN_GRAPHIC_ANIMATION_DURATION_MS - 1)).toBe(false);
	});
});
