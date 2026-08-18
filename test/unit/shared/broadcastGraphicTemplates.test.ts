import type {
	BroadcastGraphicConfig,
	GraphicAnimationStagger,
	GraphicGroupItemConfig,
	MediaGraphicItemConfig,
	SocialNetworkIconGraphicItemConfig,
} from '~~/shared/types/graphics';
import { describe, expect, it } from 'vitest';
import {
	addGraphicGroupChild,
	addGraphicItem,
	broadcastGraphicTemplateDocument,
	placeBroadcastGraphicTemplate,
} from '~~/shared/modules/graphics';
import { testGraphicAssetReference } from '~~/test/helpers/graphicsAssetIdentities';

const CANVAS = { canvasWidth: 1920, canvasHeight: 1080 };

function graphic(id: string, items: BroadcastGraphicConfig['items'] = []): BroadcastGraphicConfig {
	return { id, name: id, items };
}

/** A Broadcast Graphic holding a Graphic Group with one child, plus a top-level item. */
function composed(): BroadcastGraphicConfig {
	const withGroup = addGraphicItem(graphic('lower-third'), { kind: 'group', id: 'cluster', ...CANVAS }).graphic;
	const withChild = addGraphicGroupChild(withGroup, { kind: 'shape', groupId: 'cluster', id: 'child' }).graphic;
	return addGraphicItem(withChild, { kind: 'text', id: 'headline', ...CANVAS }).graphic;
}

/** A generator with a stable, readable sequence, so an assertion can name ids. */
function sequentialIds(prefix = 'new') {
	let next = 0;
	return () => `${prefix}-${++next}`;
}

function groupOf(config: BroadcastGraphicConfig): GraphicGroupItemConfig {
	const group = config.items.find(item => item.type === 'group');
	if (group?.type !== 'group')
		throw new Error('expected a Graphic Group');
	return group;
}

describe('broadcastGraphicTemplateDocument', () => {
	it('saves the placed Broadcast Graphic\'s composition as the template document', () => {
		const placed = composed();

		const document = broadcastGraphicTemplateDocument(placed);

		expect(document).toEqual(placed);
	});

	it('leaves Graphic Channel membership behind on the Screen it was saved from', () => {
		const document = broadcastGraphicTemplateDocument({ ...composed(), channelId: 'lower-thirds' });

		expect(document.channelId).toBeUndefined();
	});

	it('never shares structure with the placed graphic it was saved from', () => {
		const placed = composed();

		const document = broadcastGraphicTemplateDocument(placed);
		placed.items[1]!.label = 'renamed after saving';
		groupOf(placed).children[0]!.visible = false;

		expect(document.items[1]!.label).not.toBe('renamed after saving');
		expect(groupOf(document).children[0]!.visible).toBe(true);
	});
});

describe('placeBroadcastGraphicTemplate', () => {
	it('places a copy under a new Broadcast Graphic identity', () => {
		const template = { id: 'template-1', name: 'Lower third', document: composed() };

		const placed = placeBroadcastGraphicTemplate(template, { generateId: sequentialIds(), existing: [] });

		expect(placed.id).toBe('new-1');
		expect(placed.name).toBe('Lower third');
	});

	it('never joins the placed copy to a Graphic Channel the document happens to name', () => {
		const template = {
			id: 'template-1',
			name: 'Lower third',
			document: { ...composed(), channelId: 'lower-thirds' },
		};

		const placed = placeBroadcastGraphicTemplate(template, { generateId: sequentialIds(), existing: [] });

		expect(placed.channelId).toBeUndefined();
	});

	it('regenerates every Graphic Item id, including a Graphic Group\'s children', () => {
		const template = { id: 'template-1', name: 'Lower third', document: composed() };

		const placed = placeBroadcastGraphicTemplate(template, { generateId: sequentialIds(), existing: [] });

		const placedIds = [
			...placed.items.map(item => item.id),
			...groupOf(placed).children.map(child => child.id),
		];
		expect(placedIds).not.toContain('cluster');
		expect(placedIds).not.toContain('child');
		expect(placedIds).not.toContain('headline');
		expect(new Set(placedIds).size).toBe(placedIds.length);
	});

	it('copies each Graphic Input default as the placed graphic\'s own initial value', () => {
		const document = composed();
		document.inputs = [{
			type: 'text',
			key: 'headline',
			label: 'Headline',
			required: true,
			updatePolicy: 'staged',
			default: 'Match point',
			maxLength: 60,
		}];
		const template = { id: 'template-1', name: 'Lower third', document };

		const placed = placeBroadcastGraphicTemplate(template, { generateId: sequentialIds(), existing: [] });

		expect(placed.inputs).toEqual(document.inputs);
		placed.inputs![0]!.default = 'Edited on the Screen';
		expect(document.inputs[0]!.default).toBe('Match point');
	});

	it('gives the placed copy independently editable Graphic Source Selections and Graphic Input Bindings', () => {
		const document = composed();
		document.sources = [{ key: 'player', label: 'Player', kind: 'player' }];
		document.bindings = [{ inputKey: 'headline', sourceKey: 'player', fieldId: 'player.displayName' }];
		const template = { id: 'template-1', name: 'Lower third', document };

		const placed = placeBroadcastGraphicTemplate(template, { generateId: sequentialIds(), existing: [] });
		placed.sources![0]!.label = 'Winner';
		placed.bindings!.push({ inputKey: 'other', sourceKey: 'player', fieldId: 'player.pronouns' });

		expect(document.sources[0]!.label).toBe('Player');
		expect(document.bindings).toHaveLength(1);
	});

	it('retains a fixed Talent Social Profile binding without embedding Event Talent data', () => {
		const document = composed();
		document.inputs = [{
			type: 'text',
			key: 'social',
			label: 'Twitch handle',
			required: false,
			updatePolicy: 'staged',
			default: '',
			maxLength: 100,
		}];
		document.sources = [
			{ key: 'event', label: 'Current Event', kind: 'event' },
			{ key: 'talent1', label: 'Talent 1', kind: 'talent', from: { sourceKey: 'event', relation: 'commentator1' } },
		];
		document.bindings = [{ inputKey: 'social', sourceKey: 'talent1', fieldId: 'talent.twitchHandle' }];

		const placed = placeBroadcastGraphicTemplate(
			{ id: 'template-1', name: 'Social lower third', document },
			{ generateId: sequentialIds(), existing: [] },
		);

		expect(placed.sources).toEqual(document.sources);
		expect(placed.bindings).toEqual(document.bindings);
		expect(JSON.stringify(placed)).not.toContain('socialProfiles');
	});

	it('places Social Profile Projections onto the copied Presentation Group identities', () => {
		const document = composed();
		document.sources = [{ key: 'talent', label: 'Talent', kind: 'talent' }];
		document.socialProfileProjections = [{
			key: 'profile',
			label: 'Profile',
			sourceKey: 'talent',
			presentationGroupId: 'cluster',
			dwellMs: 8_000,
			transition: 'crossfade',
			transitionDurationMs: 250,
		}];

		const placed = placeBroadcastGraphicTemplate(
			{ id: 'template-1', name: 'Social lower third', document },
			{ generateId: sequentialIds(), existing: [] },
		);

		expect(placed.socialProfileProjections).toEqual([{
			...document.socialProfileProjections[0],
			presentationGroupId: groupOf(placed).id,
		}]);
		expect(placed.socialProfileProjections![0]!.presentationGroupId).not.toBe('cluster');
		expect(placed.sources).toEqual(document.sources);
		expect(JSON.stringify(placed)).not.toContain('socialProfiles');
	});

	it('carries the authored Graphic Asset Reference of every Media Graphic Item', () => {
		const document = composed();
		const media = addGraphicItem(document, { kind: 'media', id: 'brand', ...CANVAS }).graphic;
		const item = media.items.find(entry => entry.id === 'brand') as MediaGraphicItemConfig;
		item.asset = testGraphicAssetReference('asset-1', 'revision-1');
		item.videoCompatibility = 'chromium-transparency';
		const template = { id: 'template-1', name: 'Lower third', document: media };

		const placed = placeBroadcastGraphicTemplate(template, { generateId: sequentialIds(), existing: [] });

		const placedMedia = placed.items.find(entry => entry.type === 'media') as MediaGraphicItemConfig;
		expect(placedMedia.asset).toEqual({ assetId: 'asset-1', revisionId: 'revision-1' });
		expect(placedMedia.videoCompatibility).toBe('chromium-transparency');
	});

	it('round-trips a Social Network Icon as semantic configuration with no Graphic Asset', () => {
		const authored = addGraphicItem(
			composed(),
			{ kind: 'social-network-icon', id: 'social-icon', ...CANVAS },
		).graphic;
		const icon = authored.items.find(entry => entry.id === 'social-icon') as SocialNetworkIconGraphicItemConfig;
		icon.network = 'tiktok';
		icon.color = '#ff0050';
		icon.opacity = 0.55;
		icon.rotation = 12;
		const template = {
			id: 'template-1',
			name: 'Social lower third',
			document: broadcastGraphicTemplateDocument(authored),
		};

		const placed = placeBroadcastGraphicTemplate(template, { generateId: sequentialIds(), existing: [] });
		const placedIcon = placed.items.find(
			entry => entry.type === 'social-network-icon',
		) as SocialNetworkIconGraphicItemConfig;

		expect(placedIcon.id).not.toBe('social-icon');
		expect(placedIcon).toMatchObject({
			type: 'social-network-icon',
			network: 'tiktok',
			color: '#ff0050',
			opacity: 0.55,
			rotation: 12,
		});
		expect(placedIcon).not.toHaveProperty('asset');
	});

	it('names the copy distinctly when the Screen already carries the template\'s name', () => {
		const template = { id: 'template-1', name: 'Lower third', document: composed() };

		const placed = placeBroadcastGraphicTemplate(template, {
			generateId: sequentialIds(),
			existing: [graphic('a'), { ...graphic('b'), name: 'Lower third' }],
		});

		expect(placed.name).not.toBe('Lower third');
		expect(placed.name.startsWith('Lower third')).toBe(true);
	});

	it('leaves the template document untouched by anything done to the placed copy', () => {
		const document = composed();
		const template = { id: 'template-1', name: 'Lower third', document };

		const placed = placeBroadcastGraphicTemplate(template, { generateId: sequentialIds(), existing: [] });
		placed.items.pop();
		groupOf(placed).children[0]!.label = 'edited';

		expect(document.items).toHaveLength(2);
		expect(groupOf(document).children[0]!.label).not.toBe('edited');
	});

	it('carries the whole-graphic and per-item Graphic Animation of the template', () => {
		const document = composed();
		document.animation = { enter: { duration: 400, easing: 'ease-out', delay: 0, fade: { opacity: 0 } } };
		document.items[1]!.animation = {
			enter: { duration: 300, easing: 'linear', delay: 100, fade: { opacity: 0 } },
		};
		const template = { id: 'template-1', name: 'Lower third', document };

		const placed = placeBroadcastGraphicTemplate(template, { generateId: sequentialIds(), existing: [] });

		expect(placed.animation).toEqual(document.animation);
		expect(placed.items[1]!.animation).toEqual(document.items[1]!.animation);
	});

	it('rewrites a Broadcast Graphic\'s staggered subset onto the placed copy\'s own Graphic Item ids', () => {
		const document = composed();
		// The stagger names both top-level items, listed in reverse of their list order.
		// `itemIds` is a *selection*: the stagger sequence comes from the container's
		// list order restricted to that selection, then reversed for `reverse-list`, so
		// this array's own order carries no meaning. It is written this way so the
		// assertion below pins each entry's mapping rather than a coincidence of order.
		document.animation = {
			enter: { duration: 400, easing: 'ease-out', delay: 0, fade: { opacity: 0 } },
			stagger: { enter: { order: 'list', step: 80, itemIds: ['headline', 'cluster'] } },
			exit: { duration: 200, easing: 'ease-in', delay: 0, fade: { opacity: 0 } },
		};
		document.animation.stagger!.exit = { order: 'reverse-list', step: 60, itemIds: ['cluster'] };
		const template = { id: 'template-1', name: 'Lower third', document };

		const placed = placeBroadcastGraphicTemplate(template, { generateId: sequentialIds(), existing: [] });

		const [cluster, headline] = placed.items.map(item => item.id);
		const enter = placed.animation!.stagger!.enter as GraphicAnimationStagger;
		expect(enter.itemIds).toEqual([headline, cluster]);
		expect(enter.step).toBe(80);
		expect(placed.animation!.stagger!.exit!.itemIds).toEqual([cluster]);
		// A choreography that still named the authored ids would be silently ignored at
		// projection, so every staggered item would animate together at offset zero.
		expect(enter.itemIds).not.toContain('headline');
		expect(enter.itemIds).not.toContain('cluster');
	});

	it('rewrites a Graphic Group\'s own staggered subset onto its copied children', () => {
		const document = composed();
		const group = groupOf(document);
		group.animation = {
			enter: { duration: 300, easing: 'linear', delay: 0, fade: { opacity: 0 } },
			stagger: { enter: { order: 'reverse-list', step: 50, itemIds: ['child'] } },
		};
		const template = { id: 'template-1', name: 'Lower third', document };

		const placed = placeBroadcastGraphicTemplate(template, { generateId: sequentialIds(), existing: [] });

		const placedGroup = groupOf(placed);
		expect(placedGroup.animation!.stagger!.enter!.itemIds)
			.toEqual([placedGroup.children[0]!.id]);
		expect(placedGroup.animation!.stagger!.enter!.itemIds).not.toContain('child');
		expect(placedGroup.animation!.stagger!.enter!.order).toBe('reverse-list');
	});

	it('drops a staggered id that names no Graphic Item of the template', () => {
		const document = composed();
		document.animation = {
			enter: { duration: 400, easing: 'ease-out', delay: 0, fade: { opacity: 0 } },
			stagger: { enter: { order: 'list', step: 80, itemIds: ['headline', 'deleted-long-ago'] } },
		};
		const template = { id: 'template-1', name: 'Lower third', document };

		const placed = placeBroadcastGraphicTemplate(template, { generateId: sequentialIds(), existing: [] });

		// An id that named nothing was already ignored at projection; carrying it into
		// the copy would preserve a reference to an item that never existed there.
		expect(placed.animation!.stagger!.enter!.itemIds).toEqual([placed.items[1]!.id]);
	});

	it('leaves no empty Graphic Animation behind when every staggered id was stale', () => {
		const document = composed();
		document.animation = {
			stagger: { enter: { order: 'list', step: 80, itemIds: ['deleted-long-ago'] } },
		};
		const template = { id: 'template-1', name: 'Lower third', document };

		const placed = placeBroadcastGraphicTemplate(template, { generateId: sequentialIds(), existing: [] });

		// The key is absent rather than present-and-undefined: this shape is persisted
		// as JSON, where the two are indistinguishable, and compared in memory, where
		// they are not.
		expect('animation' in placed).toBe(false);
	});

	it('shares no object with the template document, one level down', () => {
		// `toEqual` passes on identity, so equality cannot see this: a copy that returned
		// the template's own recipe objects would satisfy every other test in this file
		// while making a placed graphic's animation editable through the template.
		const document = composed();
		document.animation = {
			enter: { duration: 400, easing: 'ease-out', delay: 0, fade: { opacity: 0 } },
			exit: { duration: 200, easing: 'ease-in', delay: 0, fade: { opacity: 0 } },
		};
		const template = { id: 'template-1', name: 'Lower third', document };

		const placed = placeBroadcastGraphicTemplate(template, { generateId: sequentialIds(), existing: [] });

		expect(placed.animation).not.toBe(document.animation);
		expect(placed.animation!.enter).not.toBe(document.animation.enter);
		expect(placed.animation!.enter!.fade).not.toBe(document.animation.enter!.fade);
		expect(placed.animation!.exit).not.toBe(document.animation.exit);
	});

	it('shares no object with the template document when a stagger is rewritten', () => {
		const document = composed();
		document.animation = {
			enter: { duration: 400, easing: 'ease-out', delay: 0, fade: { opacity: 0 } },
			stagger: { enter: { order: 'list', step: 80, itemIds: ['headline'] } },
		};
		const template = { id: 'template-1', name: 'Lower third', document };

		const placed = placeBroadcastGraphicTemplate(template, { generateId: sequentialIds(), existing: [] });
		placed.animation!.enter!.duration = 1;
		placed.animation!.stagger!.enter!.step = 1;

		expect(document.animation.enter!.duration).toBe(400);
		expect(document.animation.stagger!.enter!.step).toBe(80);
	});

	it('drops a Graphic Group\'s animation entirely when its only stagger was stale', () => {
		const document = composed();
		const group = groupOf(document);
		group.animation = {
			stagger: { enter: { order: 'list', step: 50, itemIds: ['deleted-long-ago'] } },
		};
		const template = { id: 'template-1', name: 'Lower third', document };

		const placed = placeBroadcastGraphicTemplate(template, { generateId: sequentialIds(), existing: [] });

		expect('animation' in groupOf(placed)).toBe(false);
	});

	it('reports what every template Graphic Item id became', () => {
		const document = composed();
		const template = { id: 'template-1', name: 'Lower third', document };
		const idMap = new Map<string, string>();

		const placed = placeBroadcastGraphicTemplate(template, {
			generateId: sequentialIds(),
			existing: [],
			idMap,
		});

		// A placement failure has to be reportable against an id the author can find in
		// the template, not against one placement generated a moment ago.
		expect(idMap.get('cluster')).toBe(placed.items[0]!.id);
		expect(idMap.get('child')).toBe(groupOf(placed).children[0]!.id);
		expect(idMap.get('headline')).toBe(placed.items[1]!.id);
	});

	/**
	 * The structural guard on the copy itself.
	 *
	 * Placement clones the document and replaces only what it is defined to change, so
	 * a field added to the vocabulary is carried by default. This asserts that
	 * directly: a document with every field populated must come back deeply equal
	 * except for the identities placement rewrites, so it fails when a new field stops
	 * being carried — which no test enumerating the fields the author remembered can do.
	 *
	 * It does *not* catch the opposite mistake. `expected()` below builds its
	 * expectation by cloning the source and rewriting the same identities placement
	 * rewrites, so a field that needed per-placement rewriting and was carried verbatim
	 * would be carried on both sides and pass. That half is not tested here and cannot
	 * be: which fields need rewriting is a fact about the vocabulary rather than about
	 * this document. `placeBroadcastGraphicTemplate` says so at its own doc comment,
	 * which is the only thing standing behind it.
	 */
	it('carries every field of a maximally populated document except what it rewrites', () => {
		const document = composed();
		document.animation = {
			'enter': { duration: 400, easing: 'ease-out', delay: 100, fade: { opacity: 0 } },
			'on-screen': {
				duration: 800,
				easing: 'linear',
				delay: 0,
				pause: 200,
				repeat: 3,
				scale: { factor: 1.1, origin: 'center' },
			},
			'update': { duration: 250, easing: 'ease-in-out', delay: 0, fade: { opacity: 0.5 } },
			'exit': {
				duration: 300,
				easing: 'ease-in',
				delay: 0,
				slide: { direction: 'south', distanceMode: 'fixed', distance: 200 },
				reveal: { edge: 'left' },
			},
			'stagger': {
				'enter': { order: 'list', step: 80, itemIds: ['headline', 'cluster'] },
				'on-screen': { order: 'reverse-list', step: 40, itemIds: ['cluster'] },
				'update': { order: 'list', step: 20, itemIds: ['headline'] },
				'exit': { order: 'reverse-list', step: 60, itemIds: ['cluster', 'headline'] },
			},
		};
		groupOf(document).animation = {
			enter: { duration: 300, easing: 'linear', delay: 0, fade: { opacity: 0 } },
			stagger: { enter: { order: 'list', step: 30, itemIds: ['child'] } },
		};
		document.items[1]!.animation = {
			exit: { duration: 150, easing: 'ease-in', delay: 50, fade: { opacity: 0 } },
		};
		document.inputs = [
			{
				type: 'text',
				key: 'headline',
				label: 'Headline',
				required: true,
				updatePolicy: 'staged',
				default: 'Match point',
				maxLength: 60,
			},
			{
				type: 'choice',
				key: 'corner',
				label: 'Corner',
				required: false,
				updatePolicy: 'live',
				default: 'left',
				options: [{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }],
			},
		];
		document.sources = [{ key: 'player', label: 'Player', kind: 'player' }];
		document.bindings = [{ inputKey: 'headline', sourceKey: 'player', fieldId: 'player.displayName' }];
		const template = { id: 'template-1', name: 'Lower third', document };
		const idMap = new Map<string, string>();

		const placed = placeBroadcastGraphicTemplate(template, {
			generateId: sequentialIds(),
			existing: [],
			idMap,
		});

		/** The document as placement should have rewritten it, built independently. */
		function expected(source: BroadcastGraphicConfig): BroadcastGraphicConfig {
			const rewriteIds = (ids: readonly string[]) => ids.map(id => idMap.get(id) ?? id);
			const rewriteStagger = (animation: any) => animation?.stagger
				? {
						...animation,
						stagger: Object.fromEntries(Object.entries(animation.stagger).map(
							([phase, entry]) => [phase, { ...(entry as any), itemIds: rewriteIds((entry as any).itemIds) }],
						)),
					}
				: animation;

			return {
				...structuredClone(source),
				id: placed.id,
				// The copy is named from the library entry, not from the stored document's
				// own `name` — a renamed template names the graphics placed from it.
				name: template.name,
				animation: rewriteStagger(source.animation),
				items: source.items.map((item) => {
					const copied: any = { ...structuredClone(item), id: idMap.get(item.id) };
					if (copied.type === 'group') {
						copied.children = (item as any).children.map((child: any) => ({
							...structuredClone(child),
							id: idMap.get(child.id),
						}));
						copied.animation = rewriteStagger(copied.animation);
					}
					return copied;
				}),
			};
		}

		expect(placed).toEqual(expected(document));
		// And every id it was defined to rewrite actually changed.
		expect(placed.id).not.toBe(document.id);
		expect(placed.items.map(item => item.id)).not.toEqual(document.items.map(item => item.id));
	});

	it('places two copies of one template with no Graphic Item id in common', () => {
		const template = { id: 'template-1', name: 'Lower third', document: composed() };
		const generateId = sequentialIds();

		const first = placeBroadcastGraphicTemplate(template, { generateId, existing: [] });
		const second = placeBroadcastGraphicTemplate(template, { generateId, existing: [first] });

		const ids = (config: BroadcastGraphicConfig) => [
			config.id,
			...config.items.map(item => item.id),
			...groupOf(config).children.map(child => child.id),
		];
		expect(ids(first).some(id => ids(second).includes(id))).toBe(false);
	});
});
