import type { GraphicSurfaceStyle } from '../../shared/types/graphics';
import type { GraphicAssetReference } from '../../shared/types/graphicsAsset';
import type { FeatureMatchLayoutConfig } from '../../shared/types/screenConfig';
import { createFeatureMatchLayoutComposition } from '../../shared/featureMatchLayoutComposition';
import { addGraphicGroupChild, addGraphicItem } from '../../shared/modules/graphics';

/**
 * A Feature Match Layout with every optional field of the vocabulary populated.
 *
 * The counterpart of `maximalBroadcastGraphicDocument`, and it exists for the same
 * reason: a round-trip across a `.sklayout` Template Package can only prove a field
 * survives if the document being round-tripped has it. Across an installation
 * boundary a dropped field is invisible — indistinguishable from one the sending
 * installation legitimately did not have — so the guard has to be a document with
 * nothing absent, compared whole.
 *
 * ## What it deliberately does not carry
 *
 * - **A Feature Match Slot.** There is nowhere to put one, which is the point: the
 *   assignment lives on the mode configuration beside the layout. A fixture with a
 *   `featureMatchId` would not be a layout.
 * - **Graphic Inputs, Graphic Source Selections, Graphic Input Bindings, or a
 *   Graphic Style Set link** on the composition. A Feature Match Overlay binds a
 *   fixed host token catalogue instead of declaring inputs, and the layout
 *   composition schema refuses all four.
 * - **A Frame media background URL.** `mediaBackground.url` is a remote resource,
 *   and the Template Package envelope refuses any document that depends on one. A
 *   layout using it cannot be exported at all, so the fixture carries the field
 *   unset rather than pretending otherwise.
 */

const CANVAS = { canvasWidth: 1920, canvasHeight: 1080 };

function maximalSurfaceStyle(): GraphicSurfaceStyle {
	return {
		fill: {
			type: 'linear-gradient',
			angle: 135,
			stops: [
				{ color: '#0077a3', position: 0, opacity: 1 },
				{ color: '#00394f', position: 1, opacity: 0.4 },
			],
		},
		fillOpacity: 0.9,
		outline: { color: '#ffffff', width: 3 },
		glow: { color: '#00d9ff', size: 18, opacity: 0.6 },
	};
}

export interface MaximalFeatureMatchLayoutOptions {
	/** The exact revision the Frame's background image pins. */
	frameAsset: GraphicAssetReference;
	/** The exact revision the composition's Media Graphic Item pins. */
	itemAsset: GraphicAssetReference;
}

export function maximalFeatureMatchLayoutDocument(
	options: MaximalFeatureMatchLayoutOptions,
): FeatureMatchLayoutConfig {
	const base = createFeatureMatchLayoutComposition();
	// Every branch of `GraphicItemConfig`. All three context-gated Definitions belong
	// here rather than only in the Broadcast Graphic fixture: a Feature Match Overlay
	// is the host that actually declares the `feature-match` context, so Clock, Player
	// Life, and Game Wins are Definitions a real layout places.
	const withGroup = addGraphicItem(base, { kind: 'group', id: 'cluster', ...CANVAS }).graphic;
	const withChild = addGraphicGroupChild(withGroup, { kind: 'shape', groupId: 'cluster', id: 'child' }).graphic;
	const withName = addGraphicItem(withChild, { kind: 'text', id: 'player1-name', ...CANVAS }).graphic;
	const withBackdrop = addGraphicItem(withName, { kind: 'media', id: 'backdrop', ...CANVAS }).graphic;
	const withClock = addGraphicItem(withBackdrop, { kind: 'clock', id: 'clock', ...CANVAS }).graphic;
	const withLife = addGraphicItem(withClock, { kind: 'player-life', id: 'life', ...CANVAS }).graphic;
	const composition = addGraphicItem(withLife, { kind: 'game-wins', id: 'wins', ...CANVAS }).graphic;

	const group = composition.items.find(item => item.id === 'cluster');
	if (group?.type !== 'group')
		throw new Error('expected a Graphic Group');
	const child = group.children[0];
	if (child?.type !== 'shape')
		throw new Error('expected a Shape Graphic Item inside the Graphic Group');
	const name = composition.items.find(item => item.id === 'player1-name');
	if (name?.type !== 'text')
		throw new Error('expected a Text Graphic Item');
	const backdrop = composition.items.find(item => item.id === 'backdrop');
	if (backdrop?.type !== 'media')
		throw new Error('expected a Media Graphic Item');
	const clock = composition.items.find(item => item.id === 'clock');
	if (clock?.type !== 'clock')
		throw new Error('expected a Clock Graphic Item');
	const life = composition.items.find(item => item.id === 'life');
	if (life?.type !== 'player-life')
		throw new Error('expected a Player Life Graphic Item');
	const wins = composition.items.find(item => item.id === 'wins');
	if (wins?.type !== 'game-wins')
		throw new Error('expected a Game Wins Graphic Item');

	backdrop.asset = { ...options.itemAsset };
	backdrop.clipGeometry = {
		topLeft: { treatment: 'rounded', size: 12 },
		topRight: { treatment: 'cut', size: 8 },
		bottomRight: { treatment: 'square', size: 0 },
		bottomLeft: { treatment: 'rounded', size: 4 },
		leftSlant: 6,
		rightSlant: 0,
	};
	backdrop.videoCompatibility = 'all-supported';
	backdrop.rotation = 3;
	backdrop.opacity = 0.85;
	backdrop.playbackRate = 1.25;
	backdrop.loop = false;

	// Two catalogue tokens in one template, and a Graphic Placeholder Style on a
	// third — three distinct terms of the binding vocabulary for the package to
	// declare. `{player1name}` is deliberately mis-cased: it is a placeholder the
	// catalogue does not have, which renders as an absence rather than an error, and
	// a package must carry it without claiming a capability for it.
	name.text = '{player1Name} · {player1Record} {player1name}';
	name.placeholderStyles = {
		player1Name: {
			fontId: 'inter',
			fontSize: 72,
			fontWeight: 900,
			fontStyle: 'italic',
			textTransform: 'uppercase',
			letterSpacing: 2,
			color: '#ffcc00',
		},
		player1Deck: { fontId: 'saira-condensed', fontSize: 32 },
	};
	name.surfaceStyle = maximalSurfaceStyle();
	name.rotation = -2;

	child.sizing = { mode: 'fill', size: 240, weight: 2 };
	child.surfaceStyle = maximalSurfaceStyle();

	clock.surfaceStyle = maximalSurfaceStyle();
	clock.rotation = 1;

	life.surfaceStyle = maximalSurfaceStyle();
	life.playerSide = 'player2';
	life.lifeAnimation = 'slide';
	life.lifeAnimationDurationMs = 620;
	life.lifeAnimationAccentColor = '#ff3366';

	wins.surfaceStyle = maximalSurfaceStyle();
	wins.playerSide = 'player2';
	wins.displayMode = 'number';
	wins.boxOrientation = 'vertical';
	wins.boxGeometry = {
		topLeft: { treatment: 'cut', size: 6 },
		topRight: { treatment: 'rounded', size: 10 },
		bottomRight: { treatment: 'rounded', size: 10 },
		bottomLeft: { treatment: 'square', size: 0 },
		leftSlant: 2,
		rightSlant: -2,
	};
	wins.boxSurfaceStyle = maximalSurfaceStyle();
	wins.wonBoxSurfaceStyle = {
		fill: { type: 'solid', color: '#22c55e' },
		fillOpacity: 1,
		outline: { color: '#ffffff', width: 2 },
		glow: { color: '#22c55e', size: 12, opacity: 0.5 },
	};

	group.surfaceStyle = maximalSurfaceStyle();
	group.defaultChildSurfaceStyle = {
		fill: { type: 'solid', color: '#101820' },
		fillOpacity: 0.75,
		outline: { color: '#334155', width: 1 },
		glow: { color: '#000000', size: 4, opacity: 0.3 },
	};

	composition.animation = {
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
			'enter': { order: 'list', step: 80, itemIds: ['player1-name', 'cluster'] },
			'on-screen': { order: 'reverse-list', step: 40, itemIds: ['cluster'] },
			'update': { order: 'list', step: 20, itemIds: ['player1-name'] },
			'exit': { order: 'reverse-list', step: 60, itemIds: ['cluster', 'backdrop', 'clock', 'life', 'wins'] },
		},
	};
	group.animation = {
		enter: { duration: 300, easing: 'linear', delay: 0, fade: { opacity: 0 } },
		stagger: { enter: { order: 'list', step: 30, itemIds: ['child'] } },
	};
	name.animation = {
		exit: { duration: 150, easing: 'ease-in', delay: 50, fade: { opacity: 0 } },
	};

	return {
		frame: {
			backgroundColor: '#0b1220',
			opacity: 0.95,
			backgroundImage: { ...options.frameAsset },
			backgroundImageFit: 'cover',
			gradient: 'linear-gradient(180deg, #0b1220 0%, #000000 100%)',
			borderTopVisible: true,
			borderRightVisible: false,
			borderBottomVisible: true,
			borderLeftVisible: false,
			borderVisible: true,
			borderColor: '#0077a3',
			borderWidth: 6,
			glowColor: '#00d9ff',
			glowSize: 14,
			glowOpacity: 0.7,
			animation: {
				enabled: true,
				effect: 'waves',
				opacity: 0.6,
				highlightColor: '#00d9ff',
				midtoneColor: '#0077a3',
				lowlightColor: '#00394f',
				baseColor: '#000000',
				color1: '#ff0055',
				color2: '#00d9ff',
				backgroundColor: '#0b1220',
				blurFactor: 0.4,
				speed: 1.5,
				zoom: 1.2,
				amplitudeFactor: 2,
				ringFactor: 3,
				rotationFactor: 0.5,
				xOffset: 0.1,
				yOffset: -0.2,
				color: '#ffffff',
				shininess: 40,
				waveHeight: 25,
				waveSpeed: 1.1,
				points: 12,
				maxDistance: 30,
				spacing: 18,
				showDots: true,
				size: 4,
				showLines: false,
				mouseDriftEnabled: true,
				mouseDriftMode: 'orbit',
				mouseDriftSeconds: 12,
				mouseDriftRadius: 0.4,
			},
		},
		// Every Source Role, so the whole vocabulary is exercised by one package.
		sources: [
			{
				id: 'main-source',
				label: 'Main Match Source',
				visible: true,
				anchor: 'center',
				configurationVersion: 1,
				sourceRole: 'main',
				frameCutout: true,
				x: 400,
				y: 90,
				width: 1500,
				height: 900,
				framingStyle: {
					backgroundColor: '#000000',
					backgroundOpacity: 0.2,
					backgroundGradient: 'linear-gradient(90deg, #000000 0%, #0077a3 100%)',
					borderTopVisible: true,
					borderRightVisible: true,
					borderBottomVisible: false,
					borderLeftVisible: true,
					borderVisible: true,
					borderColor: '#0077a3',
					borderWidth: 4,
					borderRadius: 8,
					borderRadiusTopLeft: 12,
					borderRadiusTopRight: 4,
					borderRadiusBottomRight: 0,
					borderRadiusBottomLeft: 6,
					glowColor: '#00d9ff',
					glowSize: 10,
					glowOpacity: 0.5,
				},
			},
			{
				id: 'player1-source',
				label: 'Player 1 Source',
				visible: true,
				anchor: 'top-left',
				sourceRole: 'player1',
				frameCutout: true,
				x: 24,
				y: 16,
				width: 340,
				height: 250,
			},
			{
				id: 'player2-source',
				label: 'Player 2 Source',
				visible: false,
				anchor: 'bottom-left',
				sourceRole: 'player2',
				frameCutout: false,
				x: 24,
				y: 800,
				width: 340,
				height: 250,
			},
		],
		composition,
	};
}
