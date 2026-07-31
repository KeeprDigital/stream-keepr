import { describe, expect, it } from 'vitest';
import { resolveFeatureMatchOverlayRenderModel } from '~~/app/modules/feature-match-overlay/renderModel';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';

function config() {
	return structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
}

describe('feature Match Overlay render model', () => {
	it('resolves overlay, fill, and key canvas output styles', () => {
		const base = config();

		expect(resolveFeatureMatchOverlayRenderModel({ config: base, output: 'overlay', canvasWidth: 1920, canvasHeight: 1080, displayTime: '' }).canvasStyle.background).toBe('transparent');
		expect(resolveFeatureMatchOverlayRenderModel({ config: base, output: 'fill', canvasWidth: 1920, canvasHeight: 1080, displayTime: '' }).canvasStyle.background).toBe('#000');
		expect(resolveFeatureMatchOverlayRenderModel({ config: base, output: 'key', canvasWidth: 1920, canvasHeight: 1080, displayTime: '' }).frame.fill).toBe('#fff');
	});

	it('backs the Key Output with black at the host root, which is the only thing that does', () => {
		// This host paints its own canvas and mounts the shared compositor above it as
		// a nested layer, so the shared model's canvas backdrop — and the Key matte
		// suite that asserts on it — covers the root role only. Here the Key black comes
		// from this root and from nowhere else.
		//
		// Asserted alongside `fill` rather than left to `frame.fill`, which says what
		// the Frame paints rather than what it paints *onto*: a Frame covering part of
		// the canvas would leave the rest showing whatever the backdrop is, and in the
		// Key Output that has to be black for the alpha matte to mean anything.
		for (const output of ['fill', 'key'] as const) {
			const model = resolveFeatureMatchOverlayRenderModel({
				config: config(),
				output,
				canvasWidth: 1920,
				canvasHeight: 1080,
				displayTime: '',
			});

			expect(model.canvasStyle.background).toBe('#000');
		}

		// And still transparent in the Overlay Output, which composes over whatever is
		// behind the Screen rather than over a backdrop of its own.
		expect(resolveFeatureMatchOverlayRenderModel({
			config: config(),
			output: 'overlay',
			canvasWidth: 1920,
			canvasHeight: 1080,
			displayTime: '',
		}).canvasStyle.background).toBe('transparent');
	});

	it('preserves authoritative sibling list order across every Graphic Item kind', () => {
		const base = config();
		const source = base.layout.items.find(item => item.type === 'source')!;
		const graphicItem = base.layout.items.find(item => item.type === 'graphic-item')!;
		const group = base.layout.items.find(item => item.type === 'graphic-group')!;
		base.layout.items = [
			{ ...graphicItem, id: 'back-graphicItem' },
			{
				id: 'media',
				type: 'media',
				label: 'Media',
				visible: true,
				x: 0,
				y: 0,
				width: 100,
				height: 100,
				mediaKind: 'image',
				fit: 'cover',
				focalPosition: { horizontal: 0.25, vertical: 0.75 },
				opacity: 0.8,
				clipGeometry: {
					topLeft: { kind: 'rounded', size: 8 },
					topRight: { kind: 'cut', size: 12 },
					bottomRight: { kind: 'square' },
					bottomLeft: { kind: 'square' },
					rightEdgeSlant: 16,
				},
			},
			{ ...source, id: 'source' },
			{ ...group, id: 'front-group' },
		];

		const model = resolveFeatureMatchOverlayRenderModel({
			config: base,
			output: 'overlay',
			canvasWidth: 1920,
			canvasHeight: 1080,
			displayTime: '',
		});

		expect(model.layoutItems.map(item => item.item.id))
			.toEqual(['back-graphicItem', 'media', 'source', 'front-group']);
		expect(model.layoutItems.every(item => item.style.zIndex === undefined)).toBe(true);
		expect(model.mediaItems[0]!.contentStyle).toMatchObject({
			objectFit: 'cover',
			objectPosition: '25% 75%',
			opacity: 0.8,
			borderRadius: '8px 0px 0px 0px',
		});
		expect(model.mediaItems[0]!.contentStyle.clipPath).toContain('polygon(');
	});

	it('renders image and VP9-alpha Media Graphic Items as grayscale alpha mattes in Key Output', () => {
		const base = config();
		base.layout.items = [{
			id: 'alpha-video',
			type: 'media',
			label: 'Alpha video',
			visible: true,
			x: 0,
			y: 0,
			width: 320,
			height: 180,
			mediaKind: 'silent-video',
			fit: 'contain',
			focalPosition: { horizontal: 0.5, vertical: 0.5 },
			opacity: 0.6,
			videoCompatibility: 'chromium-transparency',
			videoTarget: 'chromium',
		}];

		const overlay = resolveFeatureMatchOverlayRenderModel({
			config: base,
			output: 'overlay',
			canvasWidth: 1920,
			canvasHeight: 1080,
			displayTime: '',
		});
		const key = resolveFeatureMatchOverlayRenderModel({
			config: base,
			output: 'key',
			canvasWidth: 1920,
			canvasHeight: 1080,
			displayTime: '',
		});

		expect(overlay.mediaItems[0]!.contentStyle.filter).toBeUndefined();
		expect(key.mediaItems[0]!.contentStyle).toMatchObject({
			filter: 'brightness(0) invert(1)',
			opacity: 0.6,
		});
	});

	it('keeps transparent frame backgrounds from falling back to SVG black', () => {
		const base = config();
		base.layout.frame.backgroundColor = '';

		expect(resolveFeatureMatchOverlayRenderModel({ config: base, output: 'overlay', canvasWidth: 1920, canvasHeight: 1080, displayTime: '' }).frame.fill).toBe('transparent');

		base.layout.frame.backgroundColor = 'transparent';

		expect(resolveFeatureMatchOverlayRenderModel({ config: base, output: 'overlay', canvasWidth: 1920, canvasHeight: 1080, displayTime: '' }).frame.fill).toBe('transparent');
	});

	it('resolves source cutout paths for visible cutout Source Items', () => {
		const base = config();
		const source = base.layout.items.find(item => item.type === 'source')!;
		base.layout.items = [
			{ ...source, id: 'source-a', visible: true, frameCutout: true, x: 10, y: 20, width: 300, height: 200 },
			{ ...source, id: 'source-b', visible: true, frameCutout: false },
		];

		const model = resolveFeatureMatchOverlayRenderModel({ config: base, output: 'overlay', canvasWidth: 1920, canvasHeight: 1080, displayTime: '' });

		expect(model.sourceCutouts).toHaveLength(1);
		expect(model.sourceCutouts[0]).toEqual({ id: 'source-a', path: expect.stringContaining('M ') });
	});

	it('renders Template Slot values from Feature Match Slot data and Event metadata', () => {
		const base = config();
		const model = resolveFeatureMatchOverlayRenderModel({
			config: base,
			output: 'overlay',
			canvasWidth: 1920,
			canvasHeight: 1080,
			displayTime: '',
			event: { name: 'Event Name', displayRecordSeparator: '/', displayHideZeroDraws: true },
			featureMatch: {
				player1Data: { name: 'Alice', wins: 3, losses: 1, draws: 0, gameData: { deckName: 'Burn', deckColors: 'R' } },
				player2Data: { name: 'Bob' },
				bestOf: 3,
			},
		});

		const lines = model.graphicItems.renderTemplateLinesForSide('{name} {record} {deck}', 'player1');

		expect(lines.map(line => line.map(segment => segment.text).join('')).join('\n')).toContain('Alice 3/1 Burn');
		expect(model.graphicItems.deckColors('player1')).toBe('R');
	});

	it('passes spacer width through Template Slot rendering', () => {
		const base = config();
		const model = resolveFeatureMatchOverlayRenderModel({
			config: base,
			output: 'overlay',
			canvasWidth: 1920,
			canvasHeight: 1080,
			displayTime: '',
			featureMatch: {
				player1Data: { name: 'Alice', wins: 3, losses: 1 },
				bestOf: 3,
			},
		});

		expect(model.graphicItems.renderTemplateLinesForSide('{name}{spacer}{record}', 'player1', undefined, 48)[0]).toEqual([
			{ text: 'Alice', token: 'name', deckColors: false, style: undefined },
			{ text: '', deckColors: false, spacer: true, spacerWidth: '48px', token: undefined, style: undefined },
			{ text: '3-1', token: 'record', deckColors: false, style: undefined },
		]);
	});

	it('resolves only registered application font capabilities', () => {
		const base = config();
		base.layout.items = [
			{
				id: 'registered-font',
				type: 'graphic-item',
				label: 'Registered Font',
				visible: true,
				x: 0,
				y: 0,
				width: 320,
				height: 80,
				graphicItem: { type: 'clock' },
				surfaceStyle: { font: { kind: 'application', fontId: 'saira-condensed' } },
			},
			{
				id: 'unknown-font',
				type: 'graphic-item',
				label: 'Unknown Font',
				visible: true,
				x: 0,
				y: 100,
				width: 320,
				height: 80,
				graphicItem: { type: 'clock' },
				surfaceStyle: {
					font: { kind: 'application', fontId: 'Impact, Arial Black, sans-serif' },
				} as never,
			},
		];

		const model = resolveFeatureMatchOverlayRenderModel({ config: base, output: 'overlay', canvasWidth: 1920, canvasHeight: 1080, displayTime: '' });

		expect(model.graphicItemItems[0]!.style.fontFamily).toBe('var(--font-saira-condensed)');
		expect(model.graphicItemItems[1]!.style.fontFamily).toBeUndefined();
	});

	it('resolves game win boxes and key output game-win styles', () => {
		const base = config();
		const graphicItem = { type: 'game-wins' as const, playerSide: 'player1' as const, displayMode: 'boxes' as const, boxOrientation: 'vertical' as const, boxWidth: 22, boxHeight: 22, boxGap: 8, boxBorderWidth: 5 };
		const legacyGraphicItem = { type: 'game-wins' as const, playerSide: 'player1' as const, displayMode: 'boxes' as const, boxOrientation: 'vertical' as const, boxWidth: 22, boxHeight: 22 };
		const model = resolveFeatureMatchOverlayRenderModel({
			config: base,
			output: 'key',
			canvasWidth: 1920,
			canvasHeight: 1080,
			displayTime: '',
			featureMatch: { bestOf: 5 },
			matchState: { player1: { gameWins: 2 } },
		});

		expect(model.graphicItems.gameWinCount(graphicItem)).toBe(2);
		expect(model.graphicItems.gameWinBoxes(graphicItem)).toEqual([true, true, false]);
		expect(model.graphicItems.gameWinsContainerStyle(graphicItem, { padding: 4 })).toMatchObject({
			'--game-win-gap': '8px',
			'--game-win-direction': 'column',
		});
		expect(model.graphicItems.gameWinBoxStyle(graphicItem, { borderWidth: 2 }, true)).toMatchObject({
			background: '#fff',
			border: expect.stringContaining('5px solid #fff'),
		});
		expect(model.graphicItems.gameWinsContainerStyle(legacyGraphicItem, { padding: 4 })).toMatchObject({
			'--game-win-gap': '4px',
		});
		expect(model.graphicItems.gameWinBoxStyle(legacyGraphicItem, { borderWidth: 2 }, true)).toMatchObject({
			border: expect.stringContaining('2px solid #fff'),
		});
	});

	it('composes graphicItem gradient backgrounds over configured base colors', () => {
		const base = config();
		base.layout.items = [
			{
				id: 'gradient-graphicItem',
				type: 'graphic-item',
				label: 'Gradient Graphic Item',
				visible: true,
				x: 0,
				y: 0,
				width: 320,
				height: 80,
				graphicItem: { type: 'clock' },
				surfaceStyle: {
					backgroundColor: '#123456',
					backgroundOpacity: 0.5,
					backgroundGradient: 'linear-gradient(red, blue)',
				},
			},
			{
				id: 'gradient-only-graphicItem',
				type: 'graphic-item',
				label: 'Gradient Only Graphic Item',
				visible: true,
				x: 0,
				y: 100,
				width: 320,
				height: 80,
				graphicItem: { type: 'clock' },
				surfaceStyle: {
					backgroundOpacity: 1,
					backgroundGradient: 'linear-gradient(green, yellow)',
				},
			},
		];

		const model = resolveFeatureMatchOverlayRenderModel({ config: base, output: 'overlay', canvasWidth: 1920, canvasHeight: 1080, displayTime: '' });

		expect(model.graphicItemItems[0]!.style.background).toBe('linear-gradient(red, blue), rgba(18, 52, 86, 0.5)');
		expect(model.graphicItemItems[1]!.style.background).toBe('linear-gradient(green, yellow)');
	});

	it('keeps transparent graphicItem backgrounds transparent when opacity is enabled', () => {
		const base = config();
		base.layout.items = [
			{
				id: 'transparent-graphicItem',
				type: 'graphic-item',
				label: 'Transparent Graphic Item',
				visible: true,
				x: 0,
				y: 0,
				width: 320,
				height: 80,
				graphicItem: { type: 'clock' },
				surfaceStyle: {
					backgroundColor: 'transparent',
					backgroundOpacity: 1,
				},
			},
			{
				id: 'no-color-graphicItem',
				type: 'graphic-item',
				label: 'No Color Graphic Item',
				visible: true,
				x: 0,
				y: 100,
				width: 320,
				height: 80,
				graphicItem: { type: 'clock' },
				surfaceStyle: {
					backgroundOpacity: 1,
				},
			},
		];

		const overlayModel = resolveFeatureMatchOverlayRenderModel({ config: base, output: 'overlay', canvasWidth: 1920, canvasHeight: 1080, displayTime: '' });
		const keyModel = resolveFeatureMatchOverlayRenderModel({ config: base, output: 'key', canvasWidth: 1920, canvasHeight: 1080, displayTime: '' });

		expect(overlayModel.graphicItemItems[0]!.style.background).toBe('transparent');
		expect(overlayModel.graphicItemItems[1]!.style.background).toBe('transparent');
		expect(keyModel.graphicItemItems[0]!.style.background).toBe('transparent');
		expect(keyModel.graphicItemItems[1]!.style.background).toBe('transparent');
	});

	it('omits glow when a styled item border is disabled', () => {
		const base = config();
		base.layout.items = [
			{
				id: 'glow-graphicItem',
				type: 'graphic-item',
				label: 'Glow Graphic Item',
				visible: true,
				x: 0,
				y: 0,
				width: 320,
				height: 80,
				graphicItem: { type: 'clock' },
				surfaceStyle: {
					borderVisible: false,
					borderColor: '#ffffff',
					borderWidth: 4,
					glowSize: 8,
					glowOpacity: 1,
				},
			},
		];

		const model = resolveFeatureMatchOverlayRenderModel({ config: base, output: 'overlay', canvasWidth: 1920, canvasHeight: 1080, displayTime: '' });

		expect(model.graphicItemItems[0]!.style.boxShadow).toBeUndefined();
	});

	it('applies glow only to visible item border sides', () => {
		const base = config();
		base.layout.items = [
			{
				id: 'partial-glow-graphicItem',
				type: 'graphic-item',
				label: 'Partial Glow Graphic Item',
				visible: true,
				x: 0,
				y: 0,
				width: 320,
				height: 80,
				graphicItem: { type: 'clock' },
				surfaceStyle: {
					borderVisible: true,
					borderColor: '#ffffff',
					borderWidth: 4,
					borderLeftVisible: false,
					glowSize: 8,
					glowOpacity: 1,
				},
			},
		];

		const model = resolveFeatureMatchOverlayRenderModel({ config: base, output: 'overlay', canvasWidth: 1920, canvasHeight: 1080, displayTime: '' });
		const shadow = String(model.graphicItemItems[0]!.style.boxShadow);

		expect(shadow).toBe('0 -8px 8px -8px #ffffff, 8px 0 8px -8px #ffffff, 0 8px 8px -8px #ffffff');
		expect(shadow).not.toContain('-8px 0');
		expect(shadow).not.toContain('inset');
	});

	it('lays out row Graphic Group children with fixed, content, and fill sizing', () => {
		const base = config();
		base.layout.items = [
			{
				id: 'row-group',
				type: 'graphic-group',
				label: 'Row Group',
				visible: true,
				x: 0,
				y: 0,
				width: 500,
				height: 100,
				arrangement: { mode: 'row', padding: 10, gap: 10, align: 'stretch', justify: 'start' },
				children: [
					{ id: 'fixed', label: 'Fixed', visible: true, type: 'graphic-item', graphicItem: { type: 'clock' }, layout: { mode: 'stack', sizing: { mode: 'fixed', size: 100 } } },
					{ id: 'content', label: 'Content', visible: true, type: 'graphic-item', graphicItem: { type: 'clock' }, layout: { mode: 'stack', sizing: { mode: 'content', size: 80 } } },
					{ id: 'fill', label: 'Fill', visible: true, type: 'graphic-item', graphicItem: { type: 'clock' }, layout: { mode: 'stack', sizing: { mode: 'fill', weight: 1, min: 50 } } },
				],
			},
		];

		const model = resolveFeatureMatchOverlayRenderModel({ config: base, output: 'overlay', canvasWidth: 1920, canvasHeight: 1080, displayTime: '' });
		const children = model.graphicGroups[0]!.children;

		expect(children.map(child => child.id)).toEqual(['fixed', 'content', 'fill']);
		expect(children[0]!.style).toMatchObject({ left: '10px', width: '100px', height: '80px' });
		expect(children[1]!.style).toMatchObject({ left: '120px', width: '80px', height: '80px' });
		expect(children[2]!.style).toMatchObject({ left: '210px', width: '280px', height: '80px' });
	});

	it('separates Graphic Group container appearance from child Graphic Item defaults', () => {
		const base = config();
		base.layout.items = [
			{
				id: 'styled-group',
				type: 'graphic-group',
				label: 'Styled Group',
				visible: true,
				x: 0,
				y: 0,
				width: 500,
				height: 100,
				surfaceStyle: {
					backgroundColor: '#ff0000',
					backgroundOpacity: 1,
					borderVisible: true,
					borderColor: '#00ff00',
				},
				defaultChildSurfaceStyle: {
					textColor: '#123456',
					fontSize: 32,
					backgroundOpacity: 0,
				},
				arrangement: { mode: 'canvas', padding: 0 },
				children: [
					{ id: 'child', label: 'Child', visible: true, type: 'graphic-item', graphicItem: { type: 'clock' }, layout: { mode: 'canvas', x: 10, y: 10, width: 100, height: 40 } },
				],
			},
		];

		const model = resolveFeatureMatchOverlayRenderModel({ config: base, output: 'overlay', canvasWidth: 1920, canvasHeight: 1080, displayTime: '' });
		const group = model.graphicGroups[0]!;
		const child = group.children[0]!;

		expect(group.layers.backdrop.background).toBe('#ff0000');
		expect(group.layers.frame.borderTop).toContain('#00ff00');
		expect(child.style.background).toBe('transparent');
		expect(child.style.color).toBe('#123456');
		expect(child.style.fontSize).toBe('32px');
	});

	it('resolves graphicItem render descriptors so the renderer needs no model access', () => {
		const base = config();
		base.layout.items = [
			{ id: 'text-item', type: 'graphic-item', label: 'Text', visible: true, x: 0, y: 0, width: 320, height: 80, graphicItem: { type: 'text', template: '{name}', playerSide: 'player1' } },
			{ id: 'media-item', type: 'media', label: 'Logo', visible: true, x: 0, y: 100, width: 200, height: 100, mediaKind: 'image', asset: { assetId: 'asset-logo', revisionId: 'revision-logo-7' }, fit: 'contain', focalPosition: { horizontal: 0.5, vertical: 0.5 }, opacity: 0.9 },
			{ id: 'clock-item', type: 'graphic-item', label: 'Clock', visible: true, x: 0, y: 220, width: 160, height: 60, graphicItem: { type: 'clock' } },
			{ id: 'life-item', type: 'graphic-item', label: 'Life', visible: true, x: 0, y: 300, width: 120, height: 60, graphicItem: { type: 'player-life', playerSide: 'player1', lifeAnimation: 'pulse', lifeAnimationDurationMs: 400, lifeAnimationAccentColor: '#ff0000' } },
			{ id: 'wins-item', type: 'graphic-item', label: 'Wins', visible: true, x: 0, y: 380, width: 120, height: 40, graphicItem: { type: 'game-wins', playerSide: 'player1', displayMode: 'boxes', boxWidth: 22, boxHeight: 22 } },
		];

		const model = resolveFeatureMatchOverlayRenderModel({
			config: base,
			output: 'overlay',
			canvasWidth: 1920,
			canvasHeight: 1080,
			displayTime: '12:34',
			featureMatch: {
				player1Data: { name: 'Alice', gameData: { deckName: 'Burn', deckColors: 'R' } },
				bestOf: 5,
			},
			matchState: { player1: { lifeTotal: 17, gameWins: 2 } },
		});
		const renders = new Map(model.graphicItemItems.map(item => [item.id, item.render]));

		const text = renders.get('text-item')!;
		expect(text.type).toBe('text');
		if (text.type === 'text') {
			expect(text.lines[0]!.map(segment => segment.text).join('')).toBe('Alice');
			expect(text.deckColors).toBe('R');
		}

		expect(model.mediaItems[0]).toMatchObject({
			src: '/api/graphics-assets/asset-logo/revisions/revision-logo-7/content',
			contentStyle: { objectFit: 'contain', opacity: 0.9 },
		});

		const clock = renders.get('clock-item')!;
		expect(clock.type).toBe('clock');
		if (clock.type === 'clock')
			expect(clock.displayTime).toBe('12:34');

		const life = renders.get('life-item')!;
		expect(life.type).toBe('player-life');
		if (life.type === 'player-life') {
			expect(life.lifeTotal).toBe(17);
			expect(life.animation).toBe('pulse');
			expect(life.durationMs).toBe(400);
			expect(life.accentColor).toBe('#ff0000');
		}

		const wins = renders.get('wins-item')!;
		expect(wins.type).toBe('game-wins');
		if (wins.type === 'game-wins') {
			expect(wins.boxes).toEqual([true, true, false]);
			expect(wins.wins).toBe(2);
			expect(wins.displayMode).toBe('boxes');
			expect(wins.boxStyles.won.background).not.toBe('transparent');
			expect(wins.boxStyles.lost.background).toBe('transparent');
			expect(wins.containerStyle).toMatchObject({ '--game-win-direction': 'row' });
		}
	});

	it('resolves render descriptors for Graphic Group children too', () => {
		const base = config();
		base.layout.items = [
			{
				id: 'group',
				type: 'graphic-group',
				label: 'Group',
				visible: true,
				x: 0,
				y: 0,
				width: 400,
				height: 100,
				arrangement: { mode: 'canvas', padding: 0 },
				children: [
					{ id: 'child-clock', label: 'Clock', visible: true, type: 'graphic-item', graphicItem: { type: 'clock' }, layout: { mode: 'canvas', x: 0, y: 0, width: 100, height: 40 } },
				],
			},
		];

		const model = resolveFeatureMatchOverlayRenderModel({ config: base, output: 'overlay', canvasWidth: 1920, canvasHeight: 1080, displayTime: '09:41' });
		const child = model.graphicGroups[0]!.children[0]!;

		expect(child.render.type).toBe('clock');
		if (child.render.type === 'clock')
			expect(child.render.displayTime).toBe('09:41');
	});

	it('renders an exact silent-video revision as muted inline looping media', () => {
		const base = config();
		base.layout.items = [{
			id: 'video-item',
			type: 'media',
			label: 'Motion ident',
			visible: true,
			x: 0,
			y: 0,
			width: 640,
			height: 360,
			mediaKind: 'silent-video',
			asset: { assetId: 'video-asset', revisionId: 'video-revision-3' },
			fit: 'cover',
			opacity: 0.8,
			clipGeometry: {
				topLeft: { kind: 'rounded', size: 12 },
				topRight: { kind: 'rounded', size: 12 },
				bottomRight: { kind: 'rounded', size: 12 },
				bottomLeft: { kind: 'rounded', size: 12 },
			},
			loop: true,
			playbackRate: 1.25,
			videoCompatibility: 'all-supported',
			videoTarget: 'safari',
		}];

		const model = resolveFeatureMatchOverlayRenderModel({
			config: base,
			output: 'overlay',
			canvasWidth: 1920,
			canvasHeight: 1080,
			displayTime: '',
		});
		expect(model.mediaItems[0]).toMatchObject({
			src: '/api/graphics-assets/video-asset/revisions/video-revision-3/content',
			item: {
				mediaKind: 'silent-video',
				loop: true,
				playbackRate: 1.25,
				videoCompatibility: 'all-supported',
				videoTarget: 'safari',
				opacity: 0.8,
				focalPosition: { horizontal: 0.5, vertical: 0.5 },
				clipGeometry: {
					topLeft: { kind: 'rounded', size: 12 },
					topRight: { kind: 'rounded', size: 12 },
					bottomRight: { kind: 'rounded', size: 12 },
					bottomLeft: { kind: 'rounded', size: 12 },
				},
			},
		});
	});

	it('renders a silent-video Media Graphic Item inside its Graphic Group stacking context', () => {
		const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
		const group = config.layout.items.find(item => item.type === 'graphic-group');
		if (group?.type !== 'graphic-group')
			throw new Error('Expected a Graphic Group fixture');
		group.children = [
			{
				id: 'back-video',
				type: 'media',
				label: 'Background loop',
				visible: true,
				layout: { mode: 'canvas', x: 10, y: 8, width: 240, height: 120 },
				asset: {
					assetId: 'group-video-asset' as never,
					revisionId: 'group-video-revision-9' as never,
				},
				mediaKind: 'silent-video',
				fit: 'cover',
				focalPosition: { horizontal: 0.2, vertical: 0.75 },
				opacity: 0.65,
				clipGeometry: {
					topLeft: { kind: 'rounded', size: 12 },
					topRight: { kind: 'square' },
					bottomRight: { kind: 'cut', size: 10 },
					bottomLeft: { kind: 'square' },
				},
				loop: false,
				playbackRate: 1.25,
				videoCompatibility: 'chromium-transparency',
				videoTarget: 'chromium',
			},
			{
				id: 'front-clock',
				type: 'graphic-item',
				label: 'Clock',
				visible: true,
				graphicItem: { type: 'clock' },
				layout: { mode: 'canvas', x: 20, y: 16, width: 100, height: 40 },
			},
		];
		config.layout.items = [group];

		const model = resolveFeatureMatchOverlayRenderModel({
			config,
			output: 'overlay',
			canvasWidth: 1920,
			canvasHeight: 1080,
			displayTime: '12:34',
			graphicAssetContentPath: reference =>
				`/exact/${reference.assetId}/${reference.revisionId}`,
		});

		const renderedGroup = model.graphicGroups[0]!;
		expect(renderedGroup.layers.shell).toMatchObject({ isolation: 'isolate' });
		expect(renderedGroup.children.map(child => [child.kind, child.id]))
			.toEqual([['media', 'back-video'], ['graphic-item', 'front-clock']]);
		const media = renderedGroup.children[0]!;
		expect(media.kind === 'media' ? media : undefined).toMatchObject({
			src: '/exact/group-video-asset/group-video-revision-9',
			item: {
				mediaKind: 'silent-video',
				loop: false,
				playbackRate: 1.25,
				videoCompatibility: 'chromium-transparency',
				videoTarget: 'chromium',
			},
			style: {
				left: '10px',
				top: '8px',
				width: '240px',
				height: '120px',
			},
			contentStyle: {
				objectFit: 'cover',
				objectPosition: '20% 75%',
				opacity: 0.65,
			},
		});
		expect(media.style).not.toHaveProperty('zIndex');
	});

	it('emits pre-layered Graphic Group styles: positional shell, backdrop, children, frame', () => {
		const base = config();
		base.layout.items = [
			{
				id: 'layered-group',
				type: 'graphic-group',
				label: 'Layered Group',
				visible: true,
				x: 10,
				y: 20,
				width: 500,
				height: 100,
				surfaceStyle: {
					backgroundColor: '#ff0000',
					backgroundOpacity: 1,
					borderVisible: true,
					borderColor: '#00ff00',
					padding: 12,
				},
				arrangement: { mode: 'canvas', padding: 0 },
				children: [],
			},
		];

		const model = resolveFeatureMatchOverlayRenderModel({ config: base, output: 'overlay', canvasWidth: 1920, canvasHeight: 1080, displayTime: '' });
		const layers = model.graphicGroups[0]!.layers;

		// Shell: geometry only — visual styling lives on the layers beneath.
		expect(layers.shell).toMatchObject({ left: '10px', top: '20px', width: '500px', height: '100px', position: 'absolute', overflow: 'visible' });
		expect(layers.shell.background).toBeUndefined();
		expect(layers.shell.padding).toBeUndefined();
		expect(layers.shell.border).toBeUndefined();
		expect(layers.shell.boxShadow).toBeUndefined();

		// Backdrop paints the background under the children.
		expect(layers.backdrop.background).toBe('#ff0000');
		expect(layers.backdrop.zIndex).toBe(0);

		// Children clip to the group bounds above the backdrop.
		expect(layers.children).toMatchObject({ overflow: 'hidden', zIndex: 1 });

		// Frame carries borders and glow on top.
		expect(layers.frame.borderTop).toContain('#00ff00');
		expect(layers.frame.background).toBe('transparent');
		expect(layers.frame.zIndex).toBe(2);
	});

	it('composites the group gradient over the base color on the backdrop only', () => {
		const base = config();
		base.layout.items = [
			{
				id: 'gradient-group',
				type: 'graphic-group',
				label: 'Gradient Group',
				visible: true,
				x: 0,
				y: 0,
				width: 500,
				height: 100,
				surfaceStyle: {
					backgroundColor: '#123456',
					backgroundOpacity: 0.5,
					backgroundGradient: 'linear-gradient(red, blue)',
				},
				arrangement: { mode: 'canvas', padding: 0 },
				children: [],
			},
		];

		const overlayModel = resolveFeatureMatchOverlayRenderModel({ config: base, output: 'overlay', canvasWidth: 1920, canvasHeight: 1080, displayTime: '' });
		const keyModel = resolveFeatureMatchOverlayRenderModel({ config: base, output: 'key', canvasWidth: 1920, canvasHeight: 1080, displayTime: '' });

		expect(overlayModel.graphicGroups[0]!.layers.backdrop.background).toBe('linear-gradient(red, blue), #123456');
		expect(overlayModel.graphicGroups[0]!.layers.backdrop.opacity).toBe(0.5);
		// Key output flattens to the alpha matte — no color gradient.
		expect(String(keyModel.graphicGroups[0]!.layers.backdrop.background)).not.toContain('linear-gradient(red, blue)');
	});

	it('does not inherit Graphic Group appearance as child defaults', () => {
		const base = config();
		base.layout.items = [
			{
				id: 'group-only-appearance',
				type: 'graphic-group',
				label: 'Group Only Appearance',
				visible: true,
				x: 0,
				y: 0,
				width: 500,
				height: 100,
				surfaceStyle: {
					backgroundColor: '#111111',
					backgroundOpacity: 1,
					textColor: '#abcdef',
					fontSize: 28,
				},
				arrangement: { mode: 'canvas', padding: 0 },
				children: [
					{ id: 'child', label: 'Child', visible: true, type: 'graphic-item', graphicItem: { type: 'clock' }, layout: { mode: 'canvas', x: 10, y: 10, width: 100, height: 40 } },
				],
			},
		];

		const model = resolveFeatureMatchOverlayRenderModel({ config: base, output: 'overlay', canvasWidth: 1920, canvasHeight: 1080, displayTime: '' });
		const child = model.graphicGroups[0]!.children[0]!;

		expect(child.style.background).toBe('transparent');
		expect(child.style.color).toBe('#fff');
		expect(child.style.fontSize).toBe('24px');
	});
});
