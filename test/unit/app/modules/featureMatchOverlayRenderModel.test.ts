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

	it('keeps transparent frame backgrounds from falling back to SVG black', () => {
		const base = config();
		base.layout.frame.backgroundColor = '';

		expect(resolveFeatureMatchOverlayRenderModel({ config: base, output: 'overlay', canvasWidth: 1920, canvasHeight: 1080, displayTime: '' }).frame.fill).toBe('transparent');

		base.layout.frame.backgroundColor = 'transparent';

		expect(resolveFeatureMatchOverlayRenderModel({ config: base, output: 'overlay', canvasWidth: 1920, canvasHeight: 1080, displayTime: '' }).frame.fill).toBe('transparent');
	});

	it('resolves source cutout paths for visible cutout Source Regions', () => {
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

		const lines = model.widgets.renderTemplateLinesForSide('{name} {record} {deck}', 'player1');

		expect(lines.map(line => line.map(segment => segment.text).join('')).join('\n')).toContain('Alice 3/1 Burn');
		expect(model.widgets.deckColors('player1')).toBe('R');
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

		expect(model.widgets.renderTemplateLinesForSide('{name}{spacer}{record}', 'player1', undefined, 48)[0]).toEqual([
			{ text: 'Alice', token: 'name', deckColors: false, style: undefined },
			{ text: '', deckColors: false, spacer: true, spacerWidth: '48px', token: undefined, style: undefined },
			{ text: '3-1', token: 'record', deckColors: false, style: undefined },
		]);
	});

	it('resolves registered font ids and preserves legacy raw font stacks', () => {
		const base = config();
		base.layout.items = [
			{
				id: 'registered-font',
				type: 'widget',
				label: 'Registered Font',
				visible: true,
				x: 0,
				y: 0,
				width: 320,
				height: 80,
				widget: { type: 'clock' },
				surfaceStyle: { fontFamily: 'saira-condensed' },
			},
			{
				id: 'legacy-font',
				type: 'widget',
				label: 'Legacy Font',
				visible: true,
				x: 0,
				y: 100,
				width: 320,
				height: 80,
				widget: { type: 'clock' },
				surfaceStyle: { fontFamily: 'Impact, Arial Black, sans-serif' },
			},
		];

		const model = resolveFeatureMatchOverlayRenderModel({ config: base, output: 'overlay', canvasWidth: 1920, canvasHeight: 1080, displayTime: '' });

		expect(model.widgetItems[0]!.style.fontFamily).toBe('var(--font-saira-condensed)');
		expect(model.widgetItems[1]!.style.fontFamily).toBe('Impact, Arial Black, sans-serif');
	});

	it('resolves game win boxes and key output game-win styles', () => {
		const base = config();
		const widget = { type: 'game-wins' as const, playerSide: 'player1' as const, displayMode: 'boxes' as const, boxOrientation: 'vertical' as const, boxWidth: 22, boxHeight: 22, boxGap: 8, boxBorderWidth: 5 };
		const legacyWidget = { type: 'game-wins' as const, playerSide: 'player1' as const, displayMode: 'boxes' as const, boxOrientation: 'vertical' as const, boxWidth: 22, boxHeight: 22 };
		const model = resolveFeatureMatchOverlayRenderModel({
			config: base,
			output: 'key',
			canvasWidth: 1920,
			canvasHeight: 1080,
			displayTime: '',
			featureMatch: { bestOf: 5 },
			matchState: { player1: { gameWins: 2 } },
		});

		expect(model.widgets.gameWinCount(widget)).toBe(2);
		expect(model.widgets.gameWinBoxes(widget)).toEqual([true, true, false]);
		expect(model.widgets.gameWinsContainerStyle(widget, { padding: 4 })).toMatchObject({
			'--game-win-gap': '8px',
			'--game-win-direction': 'column',
		});
		expect(model.widgets.gameWinBoxStyle(widget, { borderWidth: 2 }, true)).toMatchObject({
			background: '#fff',
			border: expect.stringContaining('5px solid #fff'),
		});
		expect(model.widgets.gameWinsContainerStyle(legacyWidget, { padding: 4 })).toMatchObject({
			'--game-win-gap': '4px',
		});
		expect(model.widgets.gameWinBoxStyle(legacyWidget, { borderWidth: 2 }, true)).toMatchObject({
			border: expect.stringContaining('2px solid #fff'),
		});
	});

	it('composes widget gradient backgrounds over configured base colors', () => {
		const base = config();
		base.layout.items = [
			{
				id: 'gradient-widget',
				type: 'widget',
				label: 'Gradient Widget',
				visible: true,
				x: 0,
				y: 0,
				width: 320,
				height: 80,
				widget: { type: 'clock' },
				surfaceStyle: {
					backgroundColor: '#123456',
					backgroundOpacity: 0.5,
					backgroundGradient: 'linear-gradient(red, blue)',
				},
			},
			{
				id: 'gradient-only-widget',
				type: 'widget',
				label: 'Gradient Only Widget',
				visible: true,
				x: 0,
				y: 100,
				width: 320,
				height: 80,
				widget: { type: 'clock' },
				surfaceStyle: {
					backgroundOpacity: 1,
					backgroundGradient: 'linear-gradient(green, yellow)',
				},
			},
		];

		const model = resolveFeatureMatchOverlayRenderModel({ config: base, output: 'overlay', canvasWidth: 1920, canvasHeight: 1080, displayTime: '' });

		expect(model.widgetItems[0]!.style.background).toBe('linear-gradient(red, blue), rgba(18, 52, 86, 0.5)');
		expect(model.widgetItems[1]!.style.background).toBe('linear-gradient(green, yellow)');
	});

	it('keeps transparent widget backgrounds transparent when opacity is enabled', () => {
		const base = config();
		base.layout.items = [
			{
				id: 'transparent-widget',
				type: 'widget',
				label: 'Transparent Widget',
				visible: true,
				x: 0,
				y: 0,
				width: 320,
				height: 80,
				widget: { type: 'clock' },
				surfaceStyle: {
					backgroundColor: 'transparent',
					backgroundOpacity: 1,
				},
			},
			{
				id: 'no-color-widget',
				type: 'widget',
				label: 'No Color Widget',
				visible: true,
				x: 0,
				y: 100,
				width: 320,
				height: 80,
				widget: { type: 'clock' },
				surfaceStyle: {
					backgroundOpacity: 1,
				},
			},
		];

		const overlayModel = resolveFeatureMatchOverlayRenderModel({ config: base, output: 'overlay', canvasWidth: 1920, canvasHeight: 1080, displayTime: '' });
		const keyModel = resolveFeatureMatchOverlayRenderModel({ config: base, output: 'key', canvasWidth: 1920, canvasHeight: 1080, displayTime: '' });

		expect(overlayModel.widgetItems[0]!.style.background).toBe('transparent');
		expect(overlayModel.widgetItems[1]!.style.background).toBe('transparent');
		expect(keyModel.widgetItems[0]!.style.background).toBe('transparent');
		expect(keyModel.widgetItems[1]!.style.background).toBe('transparent');
	});

	it('omits glow when a styled item border is disabled', () => {
		const base = config();
		base.layout.items = [
			{
				id: 'glow-widget',
				type: 'widget',
				label: 'Glow Widget',
				visible: true,
				x: 0,
				y: 0,
				width: 320,
				height: 80,
				widget: { type: 'clock' },
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

		expect(model.widgetItems[0]!.style.boxShadow).toBeUndefined();
	});

	it('applies glow only to visible item border sides', () => {
		const base = config();
		base.layout.items = [
			{
				id: 'partial-glow-widget',
				type: 'widget',
				label: 'Partial Glow Widget',
				visible: true,
				x: 0,
				y: 0,
				width: 320,
				height: 80,
				widget: { type: 'clock' },
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
		const shadow = String(model.widgetItems[0]!.style.boxShadow);

		expect(shadow).toBe('0 -8px 8px -8px #ffffff, 8px 0 8px -8px #ffffff, 0 8px 8px -8px #ffffff');
		expect(shadow).not.toContain('-8px 0');
		expect(shadow).not.toContain('inset');
	});

	it('lays out row Widget Group children with fixed, content, and fill sizing', () => {
		const base = config();
		base.layout.items = [
			{
				id: 'row-group',
				type: 'widget-group',
				label: 'Row Group',
				visible: true,
				x: 0,
				y: 0,
				width: 500,
				height: 100,
				arrangement: { mode: 'row', padding: 10, gap: 10, align: 'stretch', justify: 'start' },
				children: [
					{ id: 'fixed', label: 'Fixed', visible: true, widget: { type: 'clock' }, layout: { mode: 'stack', sizing: { mode: 'fixed', size: 100 } } },
					{ id: 'content', label: 'Content', visible: true, widget: { type: 'clock' }, layout: { mode: 'stack', sizing: { mode: 'content', size: 80 } } },
					{ id: 'fill', label: 'Fill', visible: true, widget: { type: 'clock' }, layout: { mode: 'stack', sizing: { mode: 'fill', weight: 1, min: 50 } } },
				],
			},
		];

		const model = resolveFeatureMatchOverlayRenderModel({ config: base, output: 'overlay', canvasWidth: 1920, canvasHeight: 1080, displayTime: '' });
		const children = model.widgetGroups[0]!.children;

		expect(children.map(child => child.id)).toEqual(['fixed', 'content', 'fill']);
		expect(children[0]!.style).toMatchObject({ left: '10px', width: '100px', height: '80px' });
		expect(children[1]!.style).toMatchObject({ left: '120px', width: '80px', height: '80px' });
		expect(children[2]!.style).toMatchObject({ left: '210px', width: '280px', height: '80px' });
	});

	it('separates Widget Group container appearance from child widget defaults', () => {
		const base = config();
		base.layout.items = [
			{
				id: 'styled-group',
				type: 'widget-group',
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
					{ id: 'child', label: 'Child', visible: true, widget: { type: 'clock' }, layout: { mode: 'canvas', x: 10, y: 10, width: 100, height: 40 } },
				],
			},
		];

		const model = resolveFeatureMatchOverlayRenderModel({ config: base, output: 'overlay', canvasWidth: 1920, canvasHeight: 1080, displayTime: '' });
		const group = model.widgetGroups[0]!;
		const child = group.children[0]!;

		expect(group.layers.backdrop.background).toBe('#ff0000');
		expect(group.layers.frame.borderTop).toContain('#00ff00');
		expect(child.style.background).toBe('transparent');
		expect(child.style.color).toBe('#123456');
		expect(child.style.fontSize).toBe('32px');
	});

	it('resolves widget render descriptors so the renderer needs no model access', () => {
		const base = config();
		base.layout.items = [
			{ id: 'text-item', type: 'widget', label: 'Text', visible: true, x: 0, y: 0, width: 320, height: 80, widget: { type: 'text', template: '{name}', playerSide: 'player1' } },
			{ id: 'image-item', type: 'widget', label: 'Logo', visible: true, x: 0, y: 100, width: 200, height: 100, widget: { type: 'image', asset: { assetId: 'asset-logo', revisionId: 'revision-logo-7' }, fit: 'contain', opacity: 0.9, borderRadius: 8 } },
			{ id: 'clock-item', type: 'widget', label: 'Clock', visible: true, x: 0, y: 220, width: 160, height: 60, widget: { type: 'clock' } },
			{ id: 'life-item', type: 'widget', label: 'Life', visible: true, x: 0, y: 300, width: 120, height: 60, widget: { type: 'player-life', playerSide: 'player1', lifeAnimation: 'pulse', lifeAnimationDurationMs: 400, lifeAnimationAccentColor: '#ff0000' } },
			{ id: 'wins-item', type: 'widget', label: 'Wins', visible: true, x: 0, y: 380, width: 120, height: 40, widget: { type: 'game-wins', playerSide: 'player1', displayMode: 'boxes', boxWidth: 22, boxHeight: 22 } },
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
		const renders = new Map(model.widgetItems.map(item => [item.id, item.render]));

		const text = renders.get('text-item')!;
		expect(text.type).toBe('text');
		if (text.type === 'text') {
			expect(text.lines[0]!.map(segment => segment.text).join('')).toBe('Alice');
			expect(text.deckColors).toBe('R');
		}

		const image = renders.get('image-item')!;
		expect(image.type).toBe('image');
		if (image.type === 'image') {
			expect(image.src).toBe('/api/graphics-assets/asset-logo/revisions/revision-logo-7/content');
			expect(image.imageStyle).toMatchObject({ objectFit: 'contain', opacity: 0.9, borderRadius: '8px', width: '200px', height: '100px' });
		}

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

	it('resolves render descriptors for Widget Group children too', () => {
		const base = config();
		base.layout.items = [
			{
				id: 'group',
				type: 'widget-group',
				label: 'Group',
				visible: true,
				x: 0,
				y: 0,
				width: 400,
				height: 100,
				arrangement: { mode: 'canvas', padding: 0 },
				children: [
					{ id: 'child-clock', label: 'Clock', visible: true, widget: { type: 'clock' }, layout: { mode: 'canvas', x: 0, y: 0, width: 100, height: 40 } },
				],
			},
		];

		const model = resolveFeatureMatchOverlayRenderModel({ config: base, output: 'overlay', canvasWidth: 1920, canvasHeight: 1080, displayTime: '09:41' });
		const child = model.widgetGroups[0]!.children[0]!;

		expect(child.render.type).toBe('clock');
		if (child.render.type === 'clock')
			expect(child.render.displayTime).toBe('09:41');
	});

	it('emits pre-layered Widget Group styles: positional shell, backdrop, children, frame', () => {
		const base = config();
		base.layout.items = [
			{
				id: 'layered-group',
				type: 'widget-group',
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
		const layers = model.widgetGroups[0]!.layers;

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
				type: 'widget-group',
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

		expect(overlayModel.widgetGroups[0]!.layers.backdrop.background).toBe('linear-gradient(red, blue), #123456');
		expect(overlayModel.widgetGroups[0]!.layers.backdrop.opacity).toBe(0.5);
		// Key output flattens to the alpha matte — no color gradient.
		expect(String(keyModel.widgetGroups[0]!.layers.backdrop.background)).not.toContain('linear-gradient(red, blue)');
	});

	it('does not inherit Widget Group appearance as child defaults', () => {
		const base = config();
		base.layout.items = [
			{
				id: 'group-only-appearance',
				type: 'widget-group',
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
					{ id: 'child', label: 'Child', visible: true, widget: { type: 'clock' }, layout: { mode: 'canvas', x: 10, y: 10, width: 100, height: 40 } },
				],
			},
		];

		const model = resolveFeatureMatchOverlayRenderModel({ config: base, output: 'overlay', canvasWidth: 1920, canvasHeight: 1080, displayTime: '' });
		const child = model.widgetGroups[0]!.children[0]!;

		expect(child.style.background).toBe('transparent');
		expect(child.style.color).toBe('#fff');
		expect(child.style.fontSize).toBe('24px');
	});
});
