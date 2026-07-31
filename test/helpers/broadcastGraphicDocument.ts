import type { BroadcastGraphicConfig } from '../../shared/types/graphics';
import type { GraphicAssetReference } from '../../shared/types/graphicsAsset';
import {
	addGraphicGroupChild,
	addGraphicItem,
} from '../../shared/modules/graphics';

/**
 * A Broadcast Graphic with every optional field of the vocabulary populated.
 *
 * It exists for round-trip assertions across a Template Package. A copy built by
 * naming the fields to keep silently drops every field added to the vocabulary
 * afterwards, and across an installation boundary the loss is invisible: a dropped
 * field is indistinguishable from one the *sending* installation legitimately did
 * not have, which is exactly what a version-pinned envelope is designed to tolerate.
 * Nothing in the received bytes says anything is missing.
 *
 * So the guard is a document with nothing absent, round-tripped and compared whole.
 * It fails the moment the vocabulary grows a field the export or import path does
 * not carry, rather than when somebody remembers to update a test — and it fails at
 * authoring time rather than after packages are already in the wild, where
 * re-exporting repairs nothing.
 *
 * Built through the same authoring operations an editor uses, so its base items can
 * never drift from what the editor actually produces.
 */

const CANVAS = { canvasWidth: 1920, canvasHeight: 1080 };

export interface MaximalBroadcastGraphicOptions {
	id?: string;
	name?: string;
	/** The exact revision the Media Graphic Item pins. */
	asset: GraphicAssetReference;
}

export function maximalBroadcastGraphicDocument(
	options: MaximalBroadcastGraphicOptions,
): BroadcastGraphicConfig {
	const base: BroadcastGraphicConfig = {
		id: options.id ?? 'lower-third',
		name: options.name ?? 'Lower third',
		items: [],
	};
	const withGroup = addGraphicItem(base, { kind: 'group', id: 'cluster', ...CANVAS }).graphic;
	const withChild = addGraphicGroupChild(withGroup, { kind: 'shape', groupId: 'cluster', id: 'child' }).graphic;
	const withHeadline = addGraphicItem(withChild, { kind: 'text', id: 'headline', ...CANVAS }).graphic;
	const document = addGraphicItem(withHeadline, { kind: 'media', id: 'backdrop', ...CANVAS }).graphic;

	const group = document.items.find(item => item.id === 'cluster');
	if (group?.type !== 'group')
		throw new Error('expected a Graphic Group');
	const headline = document.items.find(item => item.id === 'headline');
	if (headline?.type !== 'text')
		throw new Error('expected a Text Graphic Item');
	const backdrop = document.items.find(item => item.id === 'backdrop');
	if (backdrop?.type !== 'media')
		throw new Error('expected a Media Graphic Item');

	// The one field a Template Package is *defined* to rewrite, so the round trip has
	// something to prove it rewrote as well as something to prove it carried.
	backdrop.asset = { ...options.asset };
	backdrop.clipGeometry = {
		topLeft: { treatment: 'rounded', size: 12 },
		topRight: { treatment: 'cut', size: 8 },
		bottomRight: { treatment: 'square', size: 0 },
		bottomLeft: { treatment: 'rounded', size: 4 },
		leftSlant: 6,
		rightSlant: 0,
	};
	backdrop.rotation = 3;
	backdrop.opacity = 0.85;
	backdrop.playbackRate = 1.25;
	backdrop.loop = false;

	headline.text = 'Match point for {headline}';
	headline.placeholderStyles = { headline: { color: '#ffcc00', fontWeight: 900 } };
	headline.rotation = -2;

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
			'exit': { order: 'reverse-list', step: 60, itemIds: ['cluster', 'backdrop'] },
		},
	};
	group.animation = {
		enter: { duration: 300, easing: 'linear', delay: 0, fade: { opacity: 0 } },
		stagger: { enter: { order: 'list', step: 30, itemIds: ['child'] } },
	};
	headline.animation = {
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
	document.bindings = [{ inputKey: 'headline', sourceKey: 'player', fieldId: 'player.name' }];

	return document;
}
