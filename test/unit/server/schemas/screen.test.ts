import type { FeatureMatchOverlayModeConfig, ModeConfigsMap } from '~~/shared/types/screenConfig';
import { describe, expect, it } from 'vitest';
import {
	archetypeSpotlightModeConfigSchema,
	backgroundModeConfigSchema,
	createScreenSchema,
	deckModeConfigSchema,
	featureMatchLayoutConfigSchema,
	featureMatchModeConfigSchema,
	featureMatchOverlayModeConfigSchema,
	headToHeadModeConfigSchema,
	metagameModeConfigSchema,
	modeConfigParamsSchema,
	modeConfigPatchSchemaMap,
	modeConfigsMapSchema,
	pairingsModeConfigSchema,
	parseModeConfigPatchResult,
	playerHistoryModeConfigSchema,
	screenConfigSchema,
	screenParamsSchema,
	standingsModeConfigSchema,
	topCardsModeConfigSchema,
	updateScreenSchema,
} from '~~/server/schemas/api/screen';
import { FEATURE_MATCH_OVERLAY_PRESETS } from '~~/shared/featureMatchOverlayPresets';
import { SCREEN_MODE_VALUES } from '~~/shared/types/enums';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG, getDefaultConfigForMode, getDisplayDefaultsForMode, resolveScreenModeConfig } from '~~/shared/types/screenConfig';
import { maximalFeatureMatchLayoutDocument } from '~~/test/helpers/featureMatchLayoutDocument';

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

	it('takes its Deck Source in a PATCH only as the canonical source, refusing the retired playerId shorthand', () => {
		// The Deck PATCH form is derived from the contract like every other mode's
		// (#588): no client sends `playerId` since #514, so it is an unknown key.
		expect(modeConfigPatchSchemaMap.deck.parse({ deckSource: { type: 'player', playerId: 3 } }))
			.toEqual({ deckSource: { type: 'player', playerId: 3 } });
		expect(modeConfigPatchSchemaMap.deck.safeParse({ playerId: null, showDeckName: false }).success).toBe(false);
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

// ──────────────── featureMatchModeConfigSchema ────────────────

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

	it('takes a Screen Media Source for the Frame image: an exact library revision or a Remote Media URL', () => {
		const referenced = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
		referenced.layout.frame.backgroundImage = {
			kind: 'asset',
			assetId: 'asset-frame' as never,
			revisionId: 'revision-frame-3' as never,
		};
		const remote = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
		remote.layout.frame.backgroundImage = { kind: 'url', url: 'https://example.com/frame.png' };

		expect(featureMatchOverlayModeConfigSchema.safeParse(referenced).success).toBe(true);
		expect(featureMatchOverlayModeConfigSchema.safeParse(remote).success).toBe(true);
	});

	it('refuses the Frame image as a bare reference, the shape before ADR-0021', () => {
		const bare = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG) as unknown as Record<string, any>;
		bare.layout.frame.backgroundImage = { assetId: 'asset-frame', revisionId: 'revision-frame-3' };

		expect(featureMatchOverlayModeConfigSchema.safeParse(bare).success).toBe(false);
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

	it('accepts per-side border visibility and glow positioning on a Source Item', () => {
		const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
		config.layout.sources[0]!.framingStyle = {
			borderVisible: true,
			borderColor: '#ffffff',
			borderWidth: 3,
			borderLeftVisible: false,
			glowPosition: 'outside',
		};

		expect(featureMatchOverlayModeConfigSchema.safeParse(config).success).toBe(true);
	});

	it('rejects an unknown Source Item glow position', () => {
		const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG) as unknown as Record<string, any>;
		config.layout.sources[0].framingStyle = { glowPosition: 'centre' };

		expect(featureMatchOverlayModeConfigSchema.safeParse(config).success).toBe(false);
	});

	it('rejects widget-era typography on a Source Item surface style', () => {
		const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG) as unknown as Record<string, any>;
		config.layout.sources[0].framingStyle = { fontSize: 24, textColor: '#ffffff' };

		expect(featureMatchOverlayModeConfigSchema.safeParse(config).success).toBe(false);
	});

	function withFrameVideo(mediaBackground: Record<string, unknown>) {
		return {
			...DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG,
			layout: {
				...DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG.layout,
				frame: { ...DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG.layout.frame, mediaBackground },
			},
		};
	}

	const frameVideo = { enabled: true, fit: 'cover', opacity: 0.75, playbackRate: 0.5, loop: true };

	it('takes a Screen Media Source for the Frame video, from either source', () => {
		for (const source of [
			{ kind: 'url', url: '/video/feature-loop.mp4' },
			{ kind: 'asset', assetId: 'asset-loop', revisionId: 'revision-loop' },
		])
			expect(featureMatchOverlayModeConfigSchema.safeParse(withFrameVideo({ ...frameVideo, source })).success, source.kind).toBe(true);
	});

	it('refuses the Frame video as a typed URL, the shape before ADR-0021', () => {
		expect(featureMatchOverlayModeConfigSchema.safeParse(withFrameVideo({
			...frameVideo,
			type: 'video',
			url: '/video/feature-loop.mp4',
		})).success).toBe(false);
	});

	it('rejects an executable, credential-bearing, or plain-HTTP Remote Media URL', () => {
		// Plain HTTP is blocked as mixed content by an HTTPS-served Screen, so it
		// would only ever show a blank output (ADR-0021).
		for (const url of [
			'javascript:alert(1)',
			'data:text/html,<script>alert(1)</script>',
			'//example.com/video.mp4',
			'https://user:secret@example.com/video.mp4',
			'http://example.com/video.mp4',
		]) {
			const result = featureMatchOverlayModeConfigSchema.safeParse(withFrameVideo({
				...frameVideo,
				source: { kind: 'url', url },
			}));

			expect(result.success, url).toBe(false);
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

	describe('the Frame video playback rate', () => {
		function withRate(playbackRate: number) {
			const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
			config.layout.frame.mediaBackground = { enabled: true, source: { kind: 'url', url: '/video/loop.mp4' }, fit: 'cover', opacity: 1, playbackRate, loop: true };
			return config;
		}

		it('is bounded to 0.25–4, as a Media Graphic Item\'s is', () => {
			expect(featureMatchOverlayModeConfigSchema.safeParse(withRate(0.25)).success).toBe(true);
			expect(featureMatchOverlayModeConfigSchema.safeParse(withRate(4)).success).toBe(true);
			expect(featureMatchOverlayModeConfigSchema.safeParse(withRate(0.05)).success).toBe(false);
			expect(featureMatchOverlayModeConfigSchema.safeParse(withRate(20)).success).toBe(false);
		});

		it('clamps a rate the earlier 0.1–16 bounds stored, so a layout carrying one still saves', () => {
			// A layout edit re-sends the whole layout, so refusing a stored legacy rate
			// would refuse every later edit to that Frame, however unrelated.
			const fast = modeConfigPatchSchemaMap['feature-match-overlay'].parse({ layout: withRate(8).layout }) as Pick<FeatureMatchOverlayModeConfig, 'layout'>;
			const slow = featureMatchLayoutConfigSchema.parse(withRate(0.1).layout);

			expect(fast.layout.frame.mediaBackground?.playbackRate).toBe(4);
			expect(slow.frame.mediaBackground?.playbackRate).toBe(0.25);
		});
	});

	it('accepts partial top-level Feature Match Overlay patches but validates nested values', () => {
		expect(modeConfigPatchSchemaMap['feature-match-overlay'].safeParse({ featureMatchId: null }).success).toBe(true);
		expect(modeConfigPatchSchemaMap['feature-match-overlay'].safeParse({ layout: { sources: [] } }).success).toBe(false);
	});
});

describe('backgroundModeConfigSchema', () => {
	const colorLayer = { id: 'wash', type: 'color', enabled: true, opacity: 0.4, color: '#0b1020' };
	const gradientLayer = { id: 'grad', type: 'gradient', enabled: true, opacity: 1, gradient: 'linear-gradient(180deg, #000, #123)' };
	const urlImageLayer = { id: 'img-url', type: 'image', enabled: true, opacity: 1, source: { kind: 'url', url: 'https://cdn.example.com/plate.png' }, fit: 'cover' };
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

	it('takes a Remote Media URL over HTTPS only, by the same rule as the Frame', () => {
		expect(backgroundModeConfigSchema.safeParse({
			layers: [{ ...urlImageLayer, source: { kind: 'url', url: 'https://cdn.example.com/plate.png' } }],
		}).success).toBe(true);
		expect(backgroundModeConfigSchema.safeParse({
			layers: [{ ...urlImageLayer, source: { kind: 'url', url: 'http://cdn.example.com/plate.png' } }],
		}).success).toBe(false);
	});

	it('bounds a video layer\'s playback rate to 0.25–4, as a Media Graphic Item\'s is', () => {
		for (const playbackRate of [0.25, 4])
			expect(backgroundModeConfigSchema.safeParse({ layers: [{ ...assetVideoLayer, playbackRate }] }).success, String(playbackRate)).toBe(true);
		for (const playbackRate of [0, 0.05, 20])
			expect(backgroundModeConfigSchema.safeParse({ layers: [{ ...assetVideoLayer, playbackRate }] }).success, String(playbackRate)).toBe(false);
	});

	it('clamps a playback rate the earlier 0.1–16 bounds stored, so an unrelated layer edit still saves', () => {
		// The editor writes the whole stack: an edit to the colour layer re-sends the
		// stored video layer beside it.
		const result = modeConfigPatchSchemaMap.background.parse({
			layers: [{ ...colorLayer, opacity: 0.9 }, { ...assetVideoLayer, playbackRate: 8 }, { ...assetVideoLayer, id: 'vid-slow', playbackRate: 0.1 }],
		}) as { layers: Array<{ playbackRate?: number }> };

		expect(result.layers.map(layer => layer.playbackRate)).toEqual([undefined, 4, 0.25]);
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

/**
 * A root-relative Remote Media URL names a file the application serves as media,
 * and the application serves media only under `/video/` (ADR-0021, #582). Every
 * other same-origin path — above all the library's own `/api/` content routes,
 * which preview with the author's session but answer nothing on air and protect
 * no revision — is refused, by every host of a Screen Media Source.
 */
describe('a root-relative Remote Media URL', () => {
	const hosts: Array<[string, (url: string) => boolean]> = [
		['a Background Screen image layer', url => backgroundModeConfigSchema.safeParse({
			layers: [{ id: 'plate', type: 'image', enabled: true, opacity: 1, source: { kind: 'url', url }, fit: 'cover' }],
		}).success],
		['a plain overlay mode\'s video layer', url => modeConfigPatchSchemaMap.standings.safeParse({
			backgroundLayers: [{ id: 'loop', type: 'video', enabled: true, opacity: 1, source: { kind: 'url', url }, fit: 'cover', playbackRate: 1, loop: true }],
		}).success],
		['the Frame image', (url) => {
			const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
			config.layout.frame.backgroundImage = { kind: 'url', url };
			return featureMatchOverlayModeConfigSchema.safeParse(config).success;
		}],
		['the Frame video', (url) => {
			const layout = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG.layout);
			layout.frame.mediaBackground = { enabled: true, source: { kind: 'url', url }, fit: 'cover', opacity: 1, playbackRate: 1, loop: true };
			return featureMatchLayoutConfigSchema.safeParse(layout).success;
		}],
	];

	it.each(hosts)('is taken under /video/ by %s', (_host, accepts) => {
		for (const url of ['/video/loop.mp4', '/video/shows/2026/intro-loop.webm', '/video/loop.mp4?v=2'])
			expect(accepts(url), url).toBe(true);
	});

	it.each(hosts)('is refused anywhere else by %s', (_host, accepts) => {
		for (const url of [
			'/api/graphics-assets/asset-1/revisions/revision-1/content',
			'/api/events/1/screens',
			'/fonts/mana.woff2',
			'/_acceptance/still-image-v1.html',
			'/favicon.ico',
			'/backgrounds/plate.png',
			'/video',
			'/video/',
			'/videos/loop.mp4',
		])
			expect(accepts(url), url).toBe(false);
	});

	it.each(hosts)('cannot be walked out of /video/ by %s', (_host, accepts) => {
		for (const url of [
			'/video/../api/graphics-assets/asset-1/revisions/revision-1/content',
			'/video/./../api/events',
			'/video/%2e%2e/api/events',
			'/video/%2E%2E/api/events',
			'/video/.%2e/api/events',
			'/video/%2e%2e%2fapi/events',
			'/video/..%2Fapi/events',
			'/video/..%5capi/events',
			'/video/%252e%252e/api/events',
			'/video\\..\\api/events',
			'/video/..\\api/events',
			'/\\example.com/video/loop.mp4',
			'//example.com/video/loop.mp4',
			'/\t/example.com/video/loop.mp4',
			'/video/\n../api/events',
			'/video/%00/loop.mp4',
		])
			expect(accepts(url), JSON.stringify(url)).toBe(false);
	});

	it.each(hosts)('is refused as an https: URL with no authority, which a Screen resolves against its own origin, by %s', (_host, accepts) => {
		// `https:/api/…` parses alone as host `api`, but a browser resolves it
		// against the page, so it would name the application's own route.
		for (const url of [
			'https:/api/graphics-assets/asset-1/revisions/revision-1/content',
			'HTTPS:/api/events',
			'https:\\api/events',
			'https:api/events',
		])
			expect(accepts(url), url).toBe(false);
	});

	it.each(hosts)('leaves HTTPS and the unset empty string as they were for %s', (_host, accepts) => {
		expect(accepts('https://cdn.example.com/api/loop.mp4')).toBe(true);
		expect(accepts('')).toBe(true);
	});
});

/**
 * Documents stored or exported before ADR-0020 recorded a `videoCompatibility` on
 * every asset-backed video. Chromium is now the only supported engine for
 * transparent video, so the key means nothing — but refusing it would refuse every
 * later edit to a stack or layout that still carries it, and every package
 * exported before the change.
 */
describe('documents recorded before ADR-0020', () => {
	it('reads a Background Layer video source that still carries videoCompatibility, and drops the key', () => {
		const source = { kind: 'asset', assetId: 'asset-2', revisionId: 'rev-2', videoCompatibility: 'chromium-transparency' };
		const result = backgroundModeConfigSchema.safeParse({
			layers: [{ id: 'vid', type: 'video', enabled: true, opacity: 1, source, fit: 'fill', playbackRate: 1, loop: true }],
		});

		expect(result.success).toBe(true);
		expect(JSON.parse(JSON.stringify(result.data)).layers[0].source).toEqual({ kind: 'asset', assetId: 'asset-2', revisionId: 'rev-2' });
	});

	it('reads a layout whose Media Graphic Item still carries videoCompatibility, and drops the key', () => {
		const layout = maximalFeatureMatchLayoutDocument({
			frameAsset: { assetId: 'frame-asset' as never, revisionId: 'frame-revision' as never },
			itemAsset: { assetId: 'item-asset' as never, revisionId: 'item-revision' as never },
		});
		const result = featureMatchLayoutConfigSchema.safeParse(layout);

		expect(result.success).toBe(true);
		expect(JSON.stringify(result.data)).not.toContain('videoCompatibility');
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

	it('accepts null to clear the Deck Source back to no Player', () => {
		const patch = modeConfigPatchSchemaMap.deck.parse({ deckSource: null }) as Record<string, unknown>;
		const stored = parseModeConfigPatchResult(
			{ deck: { deckSource: { type: 'broadcast', broadcastDeckListId: 7 } } } as ModeConfigsMap,
			'deck',
			patch,
		);

		expect(resolveScreenModeConfig(stored, 'deck').deckSource).toEqual({ type: 'player', playerId: null });
	});

	it('does not inject defaulted fields into a patch that omits them', () => {
		// zod 4 applies `.default()` even through `.optional()`; an injected
		// `archetypeLimit: null` is the delete sentinel, so every unrelated edit
		// wiped the stored value ("Top archetypes" reset to All).
		const parsed = modeConfigPatchSchemaMap.metagame.parse({ sortBy: 'count' });

		expect(parsed).toEqual({ sortBy: 'count' });
		expect(Object.hasOwn(parsed, 'archetypeLimit')).toBe(false);
		expect(Object.hasOwn(parsed, 'minPoints')).toBe(false);
	});

	it('still accepts explicit values and the null sentinel for defaulted fields', () => {
		expect(modeConfigPatchSchemaMap.metagame.parse({ archetypeLimit: 8 }))
			.toEqual({ archetypeLimit: 8 });
		expect(modeConfigPatchSchemaMap.metagame.parse({ archetypeLimit: null }))
			.toEqual({ archetypeLimit: null });
		expect(modeConfigPatchSchemaMap.metagame.parse({ minPoints: 12 }))
			.toEqual({ minPoints: 12 });
		expect(modeConfigPatchSchemaMap.metagame.safeParse({ archetypeLimit: 0 }).success)
			.toBe(false);
	});
});

// ──────────────── featureMatchModeConfigSchema ────────────────

describe('featureMatchModeConfigSchema', () => {
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
		const result = featureMatchModeConfigSchema.safeParse(validConfig);
		expect(result.success).toBe(true);
	});

	it('accepts null featureMatchId', () => {
		const result = featureMatchModeConfigSchema.safeParse({ ...validConfig, featureMatchId: null });
		expect(result.success).toBe(true);
	});

	it('validates showNames as boolean', () => {
		const result = featureMatchModeConfigSchema.safeParse({ ...validConfig, showNames: 'yes' });
		expect(result.success).toBe(false);
	});

	it('accepts optional showSeatLabels', () => {
		const result = featureMatchModeConfigSchema.safeParse({ ...validConfig, showSeatLabels: true });
		expect(result.success).toBe(true);
	});

	it('accepts optional leftSidePlayer', () => {
		const result = featureMatchModeConfigSchema.safeParse({ ...validConfig, leftSidePlayer: 'player1' });
		expect(result.success).toBe(true);
	});

	it('accepts optional showTurnControls', () => {
		const result = featureMatchModeConfigSchema.safeParse({ ...validConfig, showTurnControls: true });
		expect(result.success).toBe(true);
	});

	it('accepts optional showOvertime', () => {
		const result = featureMatchModeConfigSchema.safeParse({ ...validConfig, showOvertime: false });
		expect(result.success).toBe(true);
	});

	it('accepts optional showMulliganInfo', () => {
		const result = featureMatchModeConfigSchema.safeParse({ ...validConfig, showMulliganInfo: true });
		expect(result.success).toBe(true);
	});

	it('accepts optional showLgs', () => {
		const result = featureMatchModeConfigSchema.safeParse({ ...validConfig, showLgs: false });
		expect(result.success).toBe(true);
	});

	it('accepts optional showTableNumber', () => {
		const result = featureMatchModeConfigSchema.safeParse({ ...validConfig, showTableNumber: true });
		expect(result.success).toBe(true);
	});

	it('accepts optional allowLifeControls', () => {
		const result = featureMatchModeConfigSchema.safeParse({ ...validConfig, allowLifeControls: true });
		expect(result.success).toBe(true);
	});

	it('accepts optional allowGameWinControls', () => {
		const result = featureMatchModeConfigSchema.safeParse({ ...validConfig, allowGameWinControls: false });
		expect(result.success).toBe(true);
	});

	it('accepts optional allowCounterControls', () => {
		const result = featureMatchModeConfigSchema.safeParse({ ...validConfig, allowCounterControls: true });
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
	const conversionTarget = { conversionMetric: 'topN' as const, conversionThreshold: 8 };

	it('accepts valid metagame config with column arrays', () => {
		const result = metagameModeConfigSchema.safeParse({ ...validConfig, ...conversionTarget, minPoints: 9 });
		expect(result.success).toBe(true);
	});

	it('saves a stored config predating minPoints, archetypeLimit and Conversion Rate as it is, and reads them with their defaults', () => {
		expect(modeConfigsMapSchema.parse({ metagame: validConfig })).toEqual({ metagame: validConfig });

		const resolved = resolveScreenModeConfig({ metagame: validConfig } as ModeConfigsMap, 'metagame');

		expect(resolved.minPoints).toBe(9);
		expect(resolved.archetypeLimit).toBeNull();
		expect(resolved).toMatchObject(conversionTarget);
		expect(resolved.archetypeColumns).toEqual(validConfig.archetypeColumns);
	});

	it('accepts a Conversion Rate column and refuses a conversion threshold out of bounds', () => {
		const archetypeColumns = [...validConfig.archetypeColumns, { key: 'conversionRate', visible: true }];
		expect(modeConfigPatchSchemaMap.metagame.parse({ archetypeColumns, conversionMetric: 'minPoints', conversionThreshold: 12 }))
			.toEqual({ archetypeColumns, conversionMetric: 'minPoints', conversionThreshold: 12 });
		expect(modeConfigPatchSchemaMap.metagame.safeParse({ conversionThreshold: 1000 }).success).toBe(false);
		expect(modeConfigPatchSchemaMap.metagame.safeParse({ conversionMetric: 'cashRate' }).success).toBe(false);
	});

	it('accepts the minPoints scope with explicit minPoints', () => {
		const result = metagameModeConfigSchema.safeParse({ ...validConfig, ...conversionTarget, scope: 'minPoints', minPoints: 12 });
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
		rowsPerPage: 60,
		autoPageEnabled: false,
		autoPageIntervalMs: 10000,
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

	it('rejects a page of more grid rows than the shared page size bound', () => {
		expect(topCardsModeConfigSchema.safeParse({ ...validConfig, rowsPerPage: 101 }).success).toBe(false);
	});

	it('is strict about unknown keys', () => {
		expect(topCardsModeConfigSchema.safeParse({ ...validConfig, pageSize: 10 }).success).toBe(false);
	});
});

// ──────────────── Pairings ────────────────

describe('pairingsModeConfigSchema', () => {
	const defaults = getDefaultConfigForMode('pairings');

	it('defaults to no Round, the generic header, ten rows a page and no auto-page', () => {
		expect(defaults).toEqual({
			roundId: undefined,
			showHeader: true,
			headerText: undefined,
			rowsPerPage: 10,
			autoPageEnabled: false,
			autoPageIntervalMs: 10000,
		});
		expect(pairingsModeConfigSchema.safeParse(defaults).success).toBe(true);
	});

	it('names its Round by a positive id', () => {
		expect(pairingsModeConfigSchema.safeParse({ ...defaults, roundId: 31 }).success).toBe(true);
		expect(pairingsModeConfigSchema.safeParse({ ...defaults, roundId: 0 }).success).toBe(false);
		expect(pairingsModeConfigSchema.safeParse({ ...defaults, roundId: 1.5 }).success).toBe(false);
	});

	it('holds rows per page between 1 and 100', () => {
		expect(pairingsModeConfigSchema.safeParse({ ...defaults, rowsPerPage: 1 }).success).toBe(true);
		expect(pairingsModeConfigSchema.safeParse({ ...defaults, rowsPerPage: 100 }).success).toBe(true);
		expect(pairingsModeConfigSchema.safeParse({ ...defaults, rowsPerPage: 0 }).success).toBe(false);
		expect(pairingsModeConfigSchema.safeParse({ ...defaults, rowsPerPage: 101 }).success).toBe(false);
	});

	it('takes a cleared Round as the deletion that reads as none', () => {
		expect(modeConfigPatchSchemaMap.pairings.safeParse({ roundId: null }).success).toBe(true);
	});
});

// ──────────────── Archetype Spotlight ────────────────

describe('archetypeSpotlightModeConfigSchema', () => {
	const defaults = getDefaultConfigForMode('archetype-spotlight');

	it('defaults to no Archetype, the whole field, the Metagame page\'s Top 8 conversion target and its full-deck cards', () => {
		expect(defaults).toEqual({
			archetypeId: undefined,
			scope: 'all',
			topN: 8,
			minPoints: 9,
			playerListId: undefined,
			conversionMetric: 'topN',
			conversionThreshold: 8,
			board: 'full',
			cardLimit: 8,
			excludedCardTypes: ['Land'],
			showHeader: true,
			headerText: undefined,
			rowsPerPage: 8,
			autoPageEnabled: false,
			autoPageIntervalMs: 10000,
		});
		expect(archetypeSpotlightModeConfigSchema.safeParse(defaults).success).toBe(true);
	});

	it('names its Archetype by a positive id', () => {
		expect(archetypeSpotlightModeConfigSchema.safeParse({ ...defaults, archetypeId: 7 }).success).toBe(true);
		expect(archetypeSpotlightModeConfigSchema.safeParse({ ...defaults, archetypeId: 0 }).success).toBe(false);
		expect(archetypeSpotlightModeConfigSchema.safeParse({ ...defaults, archetypeId: 1.5 }).success).toBe(false);
	});

	it('takes the Metagame scope vocabulary', () => {
		for (const scope of ['all', 'topN', 'minPoints', 'playerList'])
			expect(archetypeSpotlightModeConfigSchema.safeParse({ ...defaults, scope }).success).toBe(true);
		expect(archetypeSpotlightModeConfigSchema.safeParse({ ...defaults, scope: 'everyone' }).success).toBe(false);
	});

	it('holds between 1 and 20 top cards', () => {
		expect(archetypeSpotlightModeConfigSchema.safeParse({ ...defaults, cardLimit: 1 }).success).toBe(true);
		expect(archetypeSpotlightModeConfigSchema.safeParse({ ...defaults, cardLimit: 20 }).success).toBe(true);
		expect(archetypeSpotlightModeConfigSchema.safeParse({ ...defaults, cardLimit: 0 }).success).toBe(false);
		expect(archetypeSpotlightModeConfigSchema.safeParse({ ...defaults, cardLimit: 21 }).success).toBe(false);
	});

	it('refuses an unknown excluded card type', () => {
		expect(archetypeSpotlightModeConfigSchema.safeParse({ ...defaults, excludedCardTypes: ['Tribal'] }).success).toBe(false);
	});

	it('takes a cleared Archetype as the deletion that reads as none', () => {
		expect(modeConfigPatchSchemaMap['archetype-spotlight'].safeParse({ archetypeId: null }).success).toBe(true);
	});
});

// ──────────────── Head-to-head ────────────────

describe('headToHeadModeConfigSchema', () => {
	const defaults = getDefaultConfigForMode('head-to-head');

	it('defaults to following a Feature Match Slot, none chosen yet, under the generic header', () => {
		expect(defaults).toEqual({
			playerSource: 'featureMatchSlot',
			featureMatchId: null,
			player1Id: null,
			player2Id: null,
			showHeader: true,
			headerText: undefined,
		});
		expect(headToHeadModeConfigSchema.safeParse(defaults).success).toBe(true);
	});

	it('takes its Players from a Feature Match Slot or from two picked Players, and nothing else', () => {
		expect(headToHeadModeConfigSchema.safeParse({ ...defaults, playerSource: 'featureMatchSlot', featureMatchId: 4 }).success).toBe(true);
		expect(headToHeadModeConfigSchema.safeParse({ ...defaults, playerSource: 'players', player1Id: 11, player2Id: 12 }).success).toBe(true);
		expect(headToHeadModeConfigSchema.safeParse({ ...defaults, playerSource: 'round' }).success).toBe(false);
	});

	it('names its Slot and Players by positive ids', () => {
		for (const field of ['featureMatchId', 'player1Id', 'player2Id']) {
			expect(headToHeadModeConfigSchema.safeParse({ ...defaults, [field]: 0 }).success).toBe(false);
			expect(headToHeadModeConfigSchema.safeParse({ ...defaults, [field]: 2.5 }).success).toBe(false);
		}
	});

	it('takes a cleared Slot or Player as the deletion that reads as none', () => {
		expect(modeConfigPatchSchemaMap['head-to-head'].safeParse({ featureMatchId: null, player1Id: null, player2Id: null }).success).toBe(true);
	});

	it('keeps which Players it shows through a display reset', () => {
		const reset = getDisplayDefaultsForMode('head-to-head');
		for (const field of ['playerSource', 'featureMatchId', 'player1Id', 'player2Id'])
			expect(reset).not.toHaveProperty(field);
	});
});

// ──────────────── Page Rotation fields ────────────────

describe('page rotation config fields', () => {
	it('every paginated mode accepts an optional rotationAnchor server timestamp', () => {
		expect(standingsModeConfigSchema.partial().safeParse({ rotationAnchor: 1_700_000_000_000 }).success).toBe(true);
		expect(playerHistoryModeConfigSchema.partial().safeParse({ rotationAnchor: 1_700_000_000_000 }).success).toBe(true);
		expect(metagameModeConfigSchema.partial().safeParse({ rotationAnchor: 1_700_000_000_000 }).success).toBe(true);
		expect(topCardsModeConfigSchema.partial().safeParse({ rotationAnchor: 1_700_000_000_000 }).success).toBe(true);
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
