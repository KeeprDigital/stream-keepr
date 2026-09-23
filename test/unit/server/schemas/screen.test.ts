import { describe, expect, it } from 'vitest';
import {
	backgroundModeConfigSchema,
	createScreenSchema,
	deckModeConfigSchema,
	featureMatchOverlayModeConfigSchema,
	matchModeConfigSchema,
	metagameModeConfigSchema,
	modeConfigParamsSchema,
	modeConfigPatchSchemaMap,
	playerHistoryModeConfigSchema,
	screenConfigSchema,
	screenParamsSchema,
	standingsModeConfigSchema,
	topCardsModeConfigSchema,
	updateScreenSchema,
} from '~~/server/schemas/api/screen';
import { FEATURE_MATCH_OVERLAY_PRESETS } from '~~/shared/featureMatchOverlayPresets';
import { SCREEN_MODE_VALUES } from '~~/shared/types/enums';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';

// ──────────────── createScreenSchema ────────────────

describe('createScreenSchema', () => {
	const validInput = {
		name: 'Feature Match',
		slug: 'feature-match',
		currentMode: 'background' as const,
	};

	it('accepts valid input with required fields', () => {
		const result = createScreenSchema.safeParse(validInput);
		expect(result.success).toBe(true);
	});

	it('accepts valid input with all optional fields', () => {
		const result = createScreenSchema.safeParse({
			...validInput,
			modeConfigs: {
				'feature-match': {
					featureMatchId: 1,
					showNames: true,
					showRecords: true,
					showDeckNames: false,
					showPronouns: true,
					showClock: true,
					showCounters: false,
				},
			},
			screenConfig: {
				width: 1920,
				height: 1080,
			},
		});
		expect(result.success).toBe(true);
	});

	// Required fields

	it('accepts missing currentMode (has DB default)', () => {
		const { currentMode: _, ...input } = validInput;
		const result = createScreenSchema.safeParse(input);
		expect(result.success).toBe(true);
	});

	// slug regex: lowercase alphanumeric with hyphens
	it('accepts slug with lowercase letters only', () => {
		const result = createScreenSchema.safeParse({ ...validInput, slug: 'overlay' });
		expect(result.success).toBe(true);
	});

	it('accepts slug with numbers', () => {
		const result = createScreenSchema.safeParse({ ...validInput, slug: 'match-1' });
		expect(result.success).toBe(true);
	});

	it('accepts slug with hyphens', () => {
		const result = createScreenSchema.safeParse({ ...validInput, slug: 'feature-match-overlay' });
		expect(result.success).toBe(true);
	});

	it('accepts slug of exactly 50 characters', () => {
		const result = createScreenSchema.safeParse({ ...validInput, slug: 'a'.repeat(50) });
		expect(result.success).toBe(true);
	});

	// currentMode enum
	it('accepts all valid screen modes', () => {
		for (const mode of SCREEN_MODE_VALUES) {
			const result = createScreenSchema.safeParse({ ...validInput, currentMode: mode });
			expect(result.success).toBe(true);
		}
	});

	// modeConfigs
	it('accepts null modeConfigs', () => {
		const result = createScreenSchema.safeParse({ ...validInput, modeConfigs: null });
		expect(result.success).toBe(true);
	});

	// screenConfig
	it('accepts null screenConfig', () => {
		const result = createScreenSchema.safeParse({ ...validInput, screenConfig: null });
		expect(result.success).toBe(true);
	});

	// Omitted fields should be stripped from output
});

// ──────────────── updateScreenSchema ────────────────

describe('updateScreenSchema', () => {
	it('accepts minimal update with only stateVersion', () => {
		const result = updateScreenSchema.safeParse({ stateVersion: 0 });
		expect(result.success).toBe(true);
	});

	it('accepts update with slug', () => {
		const result = updateScreenSchema.safeParse({ slug: 'new-slug', stateVersion: 1 });
		expect(result.success).toBe(true);
	});

	it('accepts stateVersion of 0', () => {
		const result = updateScreenSchema.safeParse({ stateVersion: 0 });
		expect(result.success).toBe(true);
	});
});

// ──────────────── screenConfigSchema ────────────────

describe('screenConfigSchema', () => {
	it('accepts empty object (all fields optional)', () => {
		const result = screenConfigSchema.safeParse({});
		expect(result.success).toBe(true);
	});

	it('accepts valid width and height', () => {
		const result = screenConfigSchema.safeParse({ width: 1920, height: 1080 });
		expect(result.success).toBe(true);
	});

	it('accepts non-negative padding values', () => {
		const result = screenConfigSchema.safeParse({ paddingX: 24, paddingY: 0 });
		expect(result.success).toBe(true);
	});

	it('accepts fractional positive width', () => {
		const result = screenConfigSchema.safeParse({ width: 0.5 });
		expect(result.success).toBe(true);
	});

	it('accepts background string', () => {
		const result = screenConfigSchema.safeParse({ background: '#ff0000' });
		expect(result.success).toBe(true);
	});

	it('accepts primary and secondary text colors', () => {
		const result = screenConfigSchema.safeParse({
			primaryTextColor: '#ffffff',
			secondaryTextColor: '#9ca3af',
		});
		expect(result.success).toBe(true);
	});

	it('accepts colorMode light', () => {
		const result = screenConfigSchema.safeParse({ colorMode: 'light' });
		expect(result.success).toBe(true);
	});

	it('accepts colorMode dark', () => {
		const result = screenConfigSchema.safeParse({ colorMode: 'dark' });
		expect(result.success).toBe(true);
	});

	it('accepts colorMode system', () => {
		const result = screenConfigSchema.safeParse({ colorMode: 'system' });
		expect(result.success).toBe(true);
	});

	it('accepts horizontalAlign values', () => {
		for (const align of ['left', 'center', 'right'] as const) {
			const result = screenConfigSchema.safeParse({ horizontalAlign: align });
			expect(result.success).toBe(true);
		}
	});

	it('accepts verticalAlign values', () => {
		for (const align of ['top', 'center', 'bottom'] as const) {
			const result = screenConfigSchema.safeParse({ verticalAlign: align });
			expect(result.success).toBe(true);
		}
	});
});

// ──────────────── deckModeConfigSchema ────────────────

describe('deckModeConfigSchema', () => {
	const validConfig = {
		deckSource: { type: 'player' as const, playerId: 1 },
		board: 'full' as const,
		sideboardPlacement: 'beside' as const,
		mainboard: {
			view: 'grid' as const,
			columns: 4,
			listColumns: 2,
			cardSize: 'medium' as const,
			dynamicCardSize: false,
			cardGap: 8,
			stackOverlap: 15,
		},
		sideboard: {
			view: 'stack' as const,
			stackOverlap: 35,
		},
	};

	it('accepts valid deck mode config', () => {
		const result = deckModeConfigSchema.safeParse(validConfig);
		expect(result.success).toBe(true);
	});

	it('accepts a Broadcast Deck List source', () => {
		expect(deckModeConfigSchema.safeParse({
			...validConfig,
			deckSource: { type: 'broadcast', broadcastDeckListId: 42 },
		}).success).toBe(true);
	});

	it('requires the canonical discriminated source and rejects the legacy key', () => {
		expect(deckModeConfigSchema.safeParse({ ...validConfig, deckSource: undefined }).success).toBe(false);
		expect(deckModeConfigSchema.safeParse({ ...validConfig, playerId: 1 }).success).toBe(false);
		expect(deckModeConfigSchema.safeParse({ ...validConfig, deckSource: { type: 'invalid', playerId: 1 } }).success).toBe(false);
	});

	it('normalizes the one legacy Deck PATCH boundary and removes playerId', () => {
		const parsed = modeConfigPatchSchemaMap.deck.parse({ playerId: null, showDeckName: false });

		expect(parsed).toEqual({
			deckSource: { type: 'player', playerId: null },
			showDeckName: false,
		});
		expect(parsed).not.toHaveProperty('playerId');
	});

	it('rejects a PATCH that carries both legacy and canonical bindings', () => {
		expect(modeConfigPatchSchemaMap.deck.safeParse({
			playerId: 1,
			deckSource: { type: 'player', playerId: 2 },
		}).success).toBe(false);
	});

	it('accepts a Player source with no selected Player', () => {
		const result = deckModeConfigSchema.safeParse({
			...validConfig,
			deckSource: { type: 'player', playerId: null },
		});
		expect(result.success).toBe(true);
	});

	it('accepts every board selection', () => {
		for (const board of ['full', 'mainboard', 'sideboard'] as const) {
			const result = deckModeConfigSchema.safeParse({ ...validConfig, board });
			expect(result.success).toBe(true);
		}
	});

	it('accepts a sideboard placed below the mainboard', () => {
		const result = deckModeConfigSchema.safeParse({ ...validConfig, sideboardPlacement: 'below' });
		expect(result.success).toBe(true);
	});

	it('rejects the removed board visibility booleans', () => {
		expect(deckModeConfigSchema.safeParse({ ...validConfig, showMainboard: true }).success).toBe(false);
		expect(deckModeConfigSchema.safeParse({ ...validConfig, showSideboard: false }).success).toBe(false);
		expect(deckModeConfigSchema.safeParse({ ...validConfig, sideboardLayout: 'stack' }).success).toBe(false);
	});

	it('rejects flat layout knobs outside a board block', () => {
		expect(deckModeConfigSchema.safeParse({ ...validConfig, viewMode: 'grid' }).success).toBe(false);
		expect(deckModeConfigSchema.safeParse({ ...validConfig, columns: 4 }).success).toBe(false);
		expect(deckModeConfigSchema.safeParse({ ...validConfig, stackOverlap: 15 }).success).toBe(false);
	});

	it('rejects unknown keys and bad values inside a board block', () => {
		expect(deckModeConfigSchema.safeParse({
			...validConfig,
			mainboard: { ...validConfig.mainboard, sideboardLayout: 'stack' },
		}).success).toBe(false);
		expect(deckModeConfigSchema.safeParse({
			...validConfig,
			sideboard: { view: 'carousel' },
		}).success).toBe(false);
		expect(deckModeConfigSchema.safeParse({
			...validConfig,
			mainboard: { ...validConfig.mainboard, columns: 0 },
		}).success).toBe(false);
	});
});

// ──────────────── matchModeConfigSchema ────────────────

describe('standingsModeConfigSchema', () => {
	const validConfig = {
		viewMode: 'all' as const,
		columns: [
			{ key: 'position', visible: true },
			{ key: 'name', visible: true },
			{ key: 'record', visible: true },
			{ key: 'points', visible: true },
			{ key: 'deck', visible: false },
		],
		showArchetypeColors: false,
		maxTableWidth: 1440,
		roundId: 2,
		showHeader: true,
		headerText: 'Standings',
		topNCount: 8,
		sliceStart: 1,
		sliceEnd: 16,
		playerListId: 1,
		revealCount: 8,
		revealOrder: 'bottomUp' as const,
		revealTrigger: 'manual' as const,
		revealIntervalMs: 5000,
		revealedCount: 0,
		rowsPerPage: 8,
		autoPageEnabled: false,
		autoPageIntervalMs: 10000,
		currentPage: 1,
		animateEntries: true,
	};

	it('accepts valid standings mode config', () => {
		const result = standingsModeConfigSchema.safeParse(validConfig);
		expect(result.success).toBe(true);
	});

	it('accepts an omitted maxTableWidth', () => {
		const { maxTableWidth: _, ...input } = validConfig;
		const result = standingsModeConfigSchema.safeParse(input);
		expect(result.success).toBe(true);
	});

	it('accepts an omitted roundId', () => {
		const { roundId: _, ...input } = validConfig;
		const result = standingsModeConfigSchema.safeParse(input);
		expect(result.success).toBe(true);
	});
});

describe('featureMatchOverlayModeConfigSchema', () => {
	it('accepts the default Feature Match Overlay config', () => {
		const result = featureMatchOverlayModeConfigSchema.safeParse(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
		expect(result.success).toBe(true);
	});

	it('accepts every built-in Feature Match Overlay Preset', () => {
		for (const preset of FEATURE_MATCH_OVERLAY_PRESETS) {
			const result = featureMatchOverlayModeConfigSchema.safeParse({
				featureMatchId: null,
				...preset.config,
			});

			expect(result.success, `${preset.id}: ${result.success ? '' : JSON.stringify(result.error.issues)}`).toBe(true);
		}
	});

	it('rejects the legacy widget list, which no longer exists', () => {
		const legacy = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG) as unknown as Record<string, any>;
		legacy.layout.items = [{
			id: 'legacy-widget',
			type: 'widget',
			label: 'Legacy',
			visible: true,
			x: 0,
			y: 0,
			width: 100,
			height: 40,
			widget: { type: 'text', template: '{name}' },
		}];

		expect(featureMatchOverlayModeConfigSchema.safeParse(legacy).success).toBe(false);
	});

	it('rejects a numeric z-index on a Source Item, because list order is the Graphic Layer Order', () => {
		const legacy = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG) as unknown as Record<string, any>;
		legacy.layout.sources[0].zIndex = 4;

		expect(featureMatchOverlayModeConfigSchema.safeParse(legacy).success).toBe(false);
	});

	it('accepts an exact Graphic Asset Reference for the Frame background and rejects a raw URL', () => {
		const referenced = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
		referenced.layout.frame.backgroundImage = {
			assetId: 'asset-frame' as never,
			revisionId: 'revision-frame-3' as never,
		};

		expect(featureMatchOverlayModeConfigSchema.safeParse(referenced).success).toBe(true);
		expect(featureMatchOverlayModeConfigSchema.safeParse({
			...referenced,
			layout: {
				...referenced.layout,
				frame: { ...referenced.layout.frame, backgroundImageUrl: 'https://example.com/frame.png' },
			},
		}).success).toBe(false);
	});

	it('requires the shared item tree rather than treating it as optional', () => {
		const withoutComposition = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG) as unknown as Record<string, any>;
		delete withoutComposition.layout.composition;

		expect(featureMatchOverlayModeConfigSchema.safeParse(withoutComposition).success).toBe(false);
	});

	it('rejects Graphic Inputs on a Feature Match Layout composition, which binds host tokens instead', () => {
		const declaring = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG) as unknown as Record<string, any>;
		declaring.layout.composition.inputs = [{
			type: 'text',
			key: 'headline',
			label: 'Headline',
			required: false,
			updatePolicy: 'staged',
			default: '',
			maxLength: 40,
		}];

		expect(featureMatchOverlayModeConfigSchema.safeParse(declaring).success).toBe(false);
	});

	it('keeps the host-owned Source Item Definition version and rejects a future one', () => {
		const future = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG) as unknown as Record<string, any>;
		future.layout.sources[0].configurationVersion = 2;

		expect(featureMatchOverlayModeConfigSchema.safeParse(future).success).toBe(false);
	});

	it('accepts per-side border visibility on a Source Item, which the host layer kept', () => {
		const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
		config.layout.sources[0]!.framingStyle = {
			borderVisible: true,
			borderColor: '#ffffff',
			borderWidth: 3,
			borderLeftVisible: false,
		};

		expect(featureMatchOverlayModeConfigSchema.safeParse(config).success).toBe(true);
	});

	it('rejects widget-era typography on a Source Item surface style', () => {
		const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG) as unknown as Record<string, any>;
		config.layout.sources[0].framingStyle = { fontSize: 24, textColor: '#ffffff' };

		expect(featureMatchOverlayModeConfigSchema.safeParse(config).success).toBe(false);
	});

	it('accepts frame video background playback settings', () => {
		const result = featureMatchOverlayModeConfigSchema.safeParse({
			...DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG,
			layout: {
				...DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG.layout,
				frame: {
					...DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG.layout.frame,
					mediaBackground: {
						enabled: true,
						type: 'video',
						url: '/backgrounds/feature-loop.mp4',
						fit: 'cover',
						opacity: 0.75,
						playbackRate: 0.5,
						loop: true,
					},
				},
			},
		});

		expect(result.success).toBe(true);
	});

	it('rejects executable or credential-bearing media URLs', () => {
		for (const url of [
			'javascript:alert(1)',
			'data:text/html,<script>alert(1)</script>',
			'//example.com/video.mp4',
			'https://user:secret@example.com/video.mp4',
		]) {
			const result = featureMatchOverlayModeConfigSchema.safeParse({
				...DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG,
				layout: {
					...DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG.layout,
					frame: {
						...DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG.layout.frame,
						mediaBackground: {
							enabled: true,
							type: 'video',
							url,
							fit: 'cover',
							opacity: 1,
							playbackRate: 1,
							loop: true,
						},
					},
				},
			});

			expect(result.success).toBe(false);
		}
	});

	it('accepts persisted anchor selections on a Source Item', () => {
		const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
		config.layout.sources[0]!.anchor = 'center';

		const result = featureMatchOverlayModeConfigSchema.safeParse(config);

		expect(result.success).toBe(true);
		if (result.success)
			expect(result.data.layout.sources[0]!.anchor).toBe('center');
	});

	it('accepts partial top-level Feature Match Overlay patches but validates nested values', () => {
		expect(modeConfigPatchSchemaMap['feature-match-overlay'].safeParse({ featureMatchId: null }).success).toBe(true);
		expect(modeConfigPatchSchemaMap['feature-match-overlay'].safeParse({ layout: { sources: [] } }).success).toBe(false);
	});
});

describe('backgroundModeConfigSchema', () => {
	const colorLayer = { id: 'wash', type: 'color', enabled: true, opacity: 0.4, color: '#0b1020' };
	const gradientLayer = { id: 'grad', type: 'gradient', enabled: true, opacity: 1, gradient: 'linear-gradient(180deg, #000, #123)' };
	const urlImageLayer = { id: 'img-url', type: 'image', enabled: true, opacity: 1, source: { kind: 'url', url: '/backgrounds/plate.png' }, fit: 'cover' };
	const assetImageLayer = { id: 'img-asset', type: 'image', enabled: true, opacity: 1, source: { kind: 'asset', assetId: 'asset-1', revisionId: 'rev-1' }, fit: 'contain' };
	const assetVideoLayer = { id: 'vid-asset', type: 'video', enabled: true, opacity: 1, source: { kind: 'asset', assetId: 'asset-2', revisionId: 'rev-2', videoCompatibility: 'all-supported' }, fit: 'fill', playbackRate: 1.25, loop: true };
	const animationLayer = { id: 'anim', type: 'animation', enabled: true, opacity: 0.6, animation: { effect: 'fog' } };

	it('accepts an ordered stack of every layer type', () => {
		const result = backgroundModeConfigSchema.safeParse({
			layers: [gradientLayer, animationLayer, urlImageLayer, assetImageLayer, assetVideoLayer, colorLayer],
		});
		expect(result.success).toBe(true);
	});

	it('accepts an empty stack — black until configured', () => {
		expect(backgroundModeConfigSchema.safeParse({ layers: [] }).success).toBe(true);
	});

	it('refuses a second animation layer: one WebGL context per memory-tight OBS source', () => {
		const result = backgroundModeConfigSchema.safeParse({
			layers: [animationLayer, { ...animationLayer, id: 'anim-2', enabled: false }],
		});
		expect(result.success).toBe(false);
	});

	it('validates an animation layer selection against the named effect, and refuses one outside the vocabulary', () => {
		expect(backgroundModeConfigSchema.safeParse({
			layers: [{ ...animationLayer, animation: { effect: 'fog', params: { speed: 2 } } }],
		}).success).toBe(true);
		expect(backgroundModeConfigSchema.safeParse({
			layers: [{ ...animationLayer, animation: { effect: 'not-an-effect' } }],
		}).success).toBe(false);
		expect(backgroundModeConfigSchema.safeParse({
			layers: [{ ...animationLayer, animation: { effect: 'fog', params: { lightColor: '#7dd3fc' } } }],
		}).success).toBe(false);
	});

	it('refuses a layer outside the closed type vocabulary and any unknown key', () => {
		expect(backgroundModeConfigSchema.safeParse({
			layers: [{ id: 'x', type: 'starfield', enabled: true, opacity: 1 }],
		}).success).toBe(false);
		expect(backgroundModeConfigSchema.safeParse({
			layers: [{ ...colorLayer, mouseDriftEnabled: true }],
		}).success).toBe(false);
	});

	it('refuses an out-of-range layer opacity', () => {
		expect(backgroundModeConfigSchema.safeParse({
			layers: [{ ...colorLayer, opacity: 1.5 }],
		}).success).toBe(false);
	});

	it('refuses an unsafe media URL source', () => {
		expect(backgroundModeConfigSchema.safeParse({

			layers: [{ ...urlImageLayer, source: { kind: 'url', url: 'javascript:alert(1)' } }],
		}).success).toBe(false);
	});

	it('enforces the one-animation-layer rule on the PATCH path too, because it lives on the layers field', () => {
		expect(modeConfigPatchSchemaMap.background.safeParse({
			layers: [animationLayer, { ...animationLayer, id: 'anim-2' }],
		}).success).toBe(false);
		expect(modeConfigPatchSchemaMap.background.safeParse({
			layers: [animationLayer],
		}).success).toBe(true);
	});
});

describe('modeConfigPatchSchemaMap', () => {
	it('accepts null to clear optional standings fields', () => {
		const result = modeConfigPatchSchemaMap.standings.safeParse({
			roundId: null,
			maxTableWidth: null,
		});

		expect(result.success).toBe(true);
	});

	it('accepts null to clear nullable deck binding fields', () => {
		const result = modeConfigPatchSchemaMap.deck.safeParse({
			playerId: null,
		});

		expect(result.success).toBe(true);
	});
});

// ──────────────── matchModeConfigSchema ────────────────

describe('matchModeConfigSchema', () => {
	const validConfig = {
		featureMatchId: 1,
		showNames: true,
		showRecords: true,
		showDeckNames: false,
		showPronouns: true,
		showClock: true,
		showCounters: false,
	};

	it('accepts valid match mode config', () => {
		const result = matchModeConfigSchema.safeParse(validConfig);
		expect(result.success).toBe(true);
	});

	it('accepts null featureMatchId', () => {
		const result = matchModeConfigSchema.safeParse({ ...validConfig, featureMatchId: null });
		expect(result.success).toBe(true);
	});

	it('validates showNames as boolean', () => {
		const result = matchModeConfigSchema.safeParse({ ...validConfig, showNames: 'yes' });
		expect(result.success).toBe(false);
	});

	it('accepts optional showSeatLabels', () => {
		const result = matchModeConfigSchema.safeParse({ ...validConfig, showSeatLabels: true });
		expect(result.success).toBe(true);
	});

	it('accepts optional leftSidePlayer', () => {
		const result = matchModeConfigSchema.safeParse({ ...validConfig, leftSidePlayer: 'player1' });
		expect(result.success).toBe(true);
	});

	it('accepts optional showTurnControls', () => {
		const result = matchModeConfigSchema.safeParse({ ...validConfig, showTurnControls: true });
		expect(result.success).toBe(true);
	});

	it('accepts optional showOvertime', () => {
		const result = matchModeConfigSchema.safeParse({ ...validConfig, showOvertime: false });
		expect(result.success).toBe(true);
	});

	it('accepts optional showMulliganInfo', () => {
		const result = matchModeConfigSchema.safeParse({ ...validConfig, showMulliganInfo: true });
		expect(result.success).toBe(true);
	});

	it('accepts optional showLgs', () => {
		const result = matchModeConfigSchema.safeParse({ ...validConfig, showLgs: false });
		expect(result.success).toBe(true);
	});

	it('accepts optional showTableNumber', () => {
		const result = matchModeConfigSchema.safeParse({ ...validConfig, showTableNumber: true });
		expect(result.success).toBe(true);
	});

	it('accepts optional allowLifeControls', () => {
		const result = matchModeConfigSchema.safeParse({ ...validConfig, allowLifeControls: true });
		expect(result.success).toBe(true);
	});

	it('accepts optional allowGameWinControls', () => {
		const result = matchModeConfigSchema.safeParse({ ...validConfig, allowGameWinControls: false });
		expect(result.success).toBe(true);
	});

	it('accepts optional allowCounterControls', () => {
		const result = matchModeConfigSchema.safeParse({ ...validConfig, allowCounterControls: true });
		expect(result.success).toBe(true);
	});
});

// ──────────────── metagameModeConfigSchema ────────────────

describe('metagameModeConfigSchema', () => {
	const validConfig = {
		viewMode: 'archetype' as const,
		scope: 'all' as const,
		topN: 8,
		playerListId: 1,
		archetypeFilter: 'Mono Red',
		sortBy: 'metaShare' as const,
		cardSortBy: 'inclusionRate' as const,
		archetypeColumns: [
			{ key: 'archetype', visible: true },
			{ key: 'count', visible: true },
			{ key: 'metaShare', visible: true },
			{ key: 'winRate', visible: true },
			{ key: 'avgPlace', visible: false },
			{ key: 'colors', visible: false },
		],
		cardColumns: [
			{ key: 'card', visible: true },
			{ key: 'manaCost', visible: true },
			{ key: 'type', visible: true },
			{ key: 'inclusionRate', visible: true },
			{ key: 'avgCopies', visible: true },
			{ key: 'totalCopies', visible: true },
			{ key: 'deckCount', visible: true },
			{ key: 'mainboardCount', visible: true },
			{ key: 'sideboardCount', visible: true },
		],
		limit: 50,
		pageSize: 10,
		autoPageEnabled: false,
		autoPageIntervalMs: 10000,
		currentPage: 1,
		showHeader: true,
		headerText: 'Full Field Metagame',
		animateEntries: true,
	};

	it('accepts valid metagame config with column arrays', () => {
		const result = metagameModeConfigSchema.safeParse(validConfig);
		expect(result.success).toBe(true);
	});

	it('defaults minPoints and archetypeLimit for stored configs predating them', () => {
		const result = metagameModeConfigSchema.safeParse(validConfig);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.minPoints).toBe(9);
			expect(result.data.archetypeLimit).toBeNull();
		}
	});

	it('accepts the minPoints scope with explicit minPoints', () => {
		const result = metagameModeConfigSchema.safeParse({ ...validConfig, scope: 'minPoints', minPoints: 12 });
		expect(result.success).toBe(true);
		if (result.success)
			expect(result.data.minPoints).toBe(12);
	});

	it('rejects a negative or fractional minPoints', () => {
		expect(metagameModeConfigSchema.safeParse({ ...validConfig, minPoints: -1 }).success).toBe(false);
		expect(metagameModeConfigSchema.safeParse({ ...validConfig, minPoints: 1.5 }).success).toBe(false);
	});
});

// ──────────────── topCardsModeConfigSchema ────────────────

describe('topCardsModeConfigSchema', () => {
	const validConfig = {
		scope: 'all' as const,
		topN: 8,
		board: 'mainboard' as const,
		sortBy: 'inclusionRate' as const,
		limit: 10,
		excludedCardTypes: ['Land'],
		columns: 5,
		cardSize: 'medium' as const,
		dynamicCardSize: true,
		cardGap: 12,
		showHeader: true,
		showCardNames: true,
		showRankBadges: true,
		statBadge: 'inclusionRate' as const,
		statBadgeSize: 'medium' as const,
	};

	it('accepts a valid top cards config', () => {
		expect(topCardsModeConfigSchema.safeParse(validConfig).success).toBe(true);
	});

	it('accepts an empty excluded-types list', () => {
		expect(topCardsModeConfigSchema.safeParse({ ...validConfig, excludedCardTypes: [] }).success).toBe(true);
	});

	it('rejects an unknown excluded card type', () => {
		expect(topCardsModeConfigSchema.safeParse({ ...validConfig, excludedCardTypes: ['Tribal'] }).success).toBe(false);
	});

	it('rejects a limit above the grid cap', () => {
		expect(topCardsModeConfigSchema.safeParse({ ...validConfig, limit: 61 }).success).toBe(false);
	});

	it('rejects the stat badge showing an unknown metric', () => {
		expect(topCardsModeConfigSchema.safeParse({ ...validConfig, statBadge: 'winRate' }).success).toBe(false);
	});

	it('is strict about unknown keys', () => {
		expect(topCardsModeConfigSchema.safeParse({ ...validConfig, pageSize: 10 }).success).toBe(false);
	});
});

// ──────────────── Page Rotation fields ────────────────

describe('page rotation config fields', () => {
	it('every paginated mode accepts an optional rotationAnchor server timestamp', () => {
		expect(standingsModeConfigSchema.partial().safeParse({ rotationAnchor: 1_700_000_000_000 }).success).toBe(true);
		expect(playerHistoryModeConfigSchema.partial().safeParse({ rotationAnchor: 1_700_000_000_000 }).success).toBe(true);
		expect(metagameModeConfigSchema.partial().safeParse({ rotationAnchor: 1_700_000_000_000 }).success).toBe(true);
	});

	it('rejects a negative or fractional rotationAnchor', () => {
		expect(standingsModeConfigSchema.partial().safeParse({ rotationAnchor: -1 }).success).toBe(false);
		expect(standingsModeConfigSchema.partial().safeParse({ rotationAnchor: 1.5 }).success).toBe(false);
	});

	it('metagame uses the canonical autoPageEnabled name and no longer accepts autoPaging', () => {
		expect(metagameModeConfigSchema.partial().safeParse({ autoPageEnabled: true }).success).toBe(true);
		expect(metagameModeConfigSchema.partial().safeParse({ autoPaging: true }).success).toBe(false);
	});
});

// ──────────────── screenParamsSchema ────────────────

describe('screenParamsSchema', () => {
	it('coerces string id and screenId to numbers', () => {
		const result = screenParamsSchema.safeParse({ id: '1', screenId: '5' });
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.id).toBe(1);
			expect(result.data.screenId).toBe(5);
		}
	});

	it('accepts numeric id and screenId', () => {
		const result = screenParamsSchema.safeParse({ id: 10, screenId: 20 });
		expect(result.success).toBe(true);
	});
});

// ──────────────── modeConfigParamsSchema ────────────────

describe('modeConfigParamsSchema', () => {
	it('accepts valid params with mode', () => {
		const result = modeConfigParamsSchema.safeParse({ id: '1', screenId: '5', mode: 'feature-match' });
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.id).toBe(1);
			expect(result.data.screenId).toBe(5);
			expect(result.data.mode).toBe('feature-match');
		}
	});

	it('accepts all valid mode values', () => {
		for (const mode of SCREEN_MODE_VALUES) {
			const result = modeConfigParamsSchema.safeParse({ id: '1', screenId: '1', mode });
			expect(result.success).toBe(true);
		}
	});

	it('coerces string id and screenId', () => {
		const result = modeConfigParamsSchema.safeParse({ id: '42', screenId: '99', mode: 'background' });
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.id).toBe(42);
			expect(result.data.screenId).toBe(99);
		}
	});
});
