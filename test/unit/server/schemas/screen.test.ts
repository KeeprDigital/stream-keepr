import { describe, expect, it } from 'vitest';
import {
	createScreenSchema,
	deckModeConfigSchema,
	featureMatchOverlayModeConfigSchema,
	idleModeConfigSchema,
	matchModeConfigSchema,
	metagameModeConfigSchema,
	modeConfigParamsSchema,
	modeConfigPatchSchemaMap,
	screenConfigSchema,
	screenParamsSchema,
	standingsModeConfigSchema,
	updateScreenSchema,
} from '~~/server/schemas/api/screen';
import { SCREEN_MODE_VALUES } from '~~/shared/types/enums';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';

// ──────────────── createScreenSchema ────────────────

describe('createScreenSchema', () => {
	const validInput = {
		name: 'Feature Match',
		slug: 'feature-match',
		currentMode: 'idle' as const,
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
		playerId: 1,
		viewMode: 'grid' as const,
		columns: 4,
		listColumns: 2,
		showMainboard: true,
		showSideboard: true,
		sideboardLayout: 'stack' as const,
	};

	it('accepts valid deck mode config', () => {
		const result = deckModeConfigSchema.safeParse(validConfig);
		expect(result.success).toBe(true);
	});

	it('accepts null playerId', () => {
		const result = deckModeConfigSchema.safeParse({ ...validConfig, playerId: null });
		expect(result.success).toBe(true);
	});

	it('accepts list mode with list-specific controls', () => {
		const result = deckModeConfigSchema.safeParse({
			...validConfig,
			viewMode: 'list',
			listColumns: 3,
			showSideboard: false,
		});
		expect(result.success).toBe(true);
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

	it('accepts exact Graphic Asset References for frame and image fields and rejects raw image URLs', () => {
		const referenced = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
		referenced.layout.frame.backgroundImage = {
			assetId: 'asset-frame',
			revisionId: 'revision-frame-3',
		};
		referenced.layout.items.push({
			id: 'sponsor-logo',
			type: 'widget',
			label: 'Sponsor logo',
			visible: true,
			x: 10,
			y: 10,
			width: 200,
			height: 100,
			widget: {
				type: 'image',
				asset: {
					assetId: 'asset-logo',
					revisionId: 'revision-logo-7',
				},
				fit: 'contain',
				opacity: 1,
				borderRadius: 0,
			},
		});
		referenced.layout.items.push({
			id: 'motion-ident',
			type: 'media',
			label: 'Motion ident',
			visible: true,
			x: 10,
			y: 120,
			width: 200,
			height: 100,
			asset: {
				assetId: 'asset-video',
				revisionId: 'revision-video-2',
			},
			mediaKind: 'silent-video',
			fit: 'contain',
			opacity: 1,
			borderRadius: 0,
			loop: true,
			playbackRate: 1,
			videoCompatibility: 'chromium-transparency',
			videoTarget: 'chromium',
		});

		expect(featureMatchOverlayModeConfigSchema.safeParse(referenced).success).toBe(true);
		expect(featureMatchOverlayModeConfigSchema.safeParse({
			...referenced,
			layout: {
				...referenced.layout,
				frame: {
					...referenced.layout.frame,
					backgroundImageUrl: 'https://example.com/frame.png',
				},
			},
		}).success).toBe(false);
		expect(featureMatchOverlayModeConfigSchema.safeParse({
			...referenced,
			layout: {
				...referenced.layout,
				items: [{
					...referenced.layout.items.at(-1),
					widget: {
						type: 'image',
						url: 'https://example.com/logo.png',
						fit: 'contain',
						opacity: 1,
						borderRadius: 0,
					},
				}],
			},
		}).success).toBe(false);
	});

	it('accepts application font capabilities and exact font revisions but rejects arbitrary font selectors', () => {
		const exactFont = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
		exactFont.layout.items[0]!.surfaceStyle = {
			font: {
				kind: 'asset',
				reference: {
					assetId: 'font-asset',
					revisionId: 'font-revision-4',
				},
			},
		};
		expect(featureMatchOverlayModeConfigSchema.safeParse(exactFont).success).toBe(true);

		exactFont.layout.items[0]!.surfaceStyle!.font = {
			kind: 'application',
			fontId: 'inter',
		};
		expect(featureMatchOverlayModeConfigSchema.safeParse(exactFont).success).toBe(true);
		expect(featureMatchOverlayModeConfigSchema.safeParse({
			...exactFont,
			layout: {
				...exactFont.layout,
				items: [{
					...exactFont.layout.items[0],
					surfaceStyle: {
						font: { kind: 'css', family: 'Comic Sans MS' },
					},
				}],
			},
		}).success).toBe(false);
		expect(featureMatchOverlayModeConfigSchema.safeParse({
			...exactFont,
			layout: {
				...exactFont.layout,
				items: [{
					...exactFont.layout.items[0],
					surfaceStyle: {
						fontFamily: 'Comic Sans MS',
					},
				}],
			},
		}).success).toBe(false);
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

	it('accepts Feature Match Overlay gradient and glow style settings', () => {
		const result = featureMatchOverlayModeConfigSchema.safeParse({
			...DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG,
			presetId: 'neon-feature-match',
			layout: {
				...DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG.layout,
				frame: {
					...DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG.layout.frame,
					gradient: 'linear-gradient(90deg, rgba(192,0,96,.4), rgba(111,0,255,.4))',
					glowColor: '#ffffff',
					glowSize: 12,
					glowOpacity: 0.75,
				},
				items: DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG.layout.items.map((item) => {
					if (item.id !== 'top-bar')
						return item;
					return {
						...item,
						surfaceStyle: {
							...(item.surfaceStyle ?? {}),
							backgroundGradient: 'linear-gradient(90deg, #c00060, #6f00ff)',
							glowColor: '#ffffff',
							glowSize: 8,
							glowOpacity: 0.8,
						},
						defaultChildSurfaceStyle: item.type === 'widget-group'
							? {
									...(item.defaultChildSurfaceStyle ?? {}),
									textColor: '#ffffff',
									fontSize: 30,
								}
							: undefined,
					};
				}),
			},
		});

		expect(result.success).toBe(true);
	});

	it('accepts Feature Match Overlay game wins display settings', () => {
		const result = featureMatchOverlayModeConfigSchema.safeParse({
			...DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG,
			layout: {
				...DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG.layout,
				items: DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG.layout.items.map((item) => {
					if (item.id !== 'player1-game-wins' || item.type !== 'widget' || item.widget.type !== 'game-wins')
						return item;
					return {
						...item,
						widget: {
							...item.widget,
							displayMode: 'number',
							boxOrientation: 'vertical',
							boxGap: 9,
							boxBorderWidth: 4,
						},
					};
				}),
			},
		});

		expect(result.success).toBe(true);
		if (result.success) {
			const winsWidget = result.data.layout.items.find(item => item.id === 'player1-game-wins');
			expect(winsWidget?.type === 'widget' && winsWidget.widget.type === 'game-wins' ? winsWidget.widget : null).toMatchObject({
				displayMode: 'number',
				boxOrientation: 'vertical',
				boxGap: 9,
				boxBorderWidth: 4,
			});
		}
	});

	it('accepts Feature Match Overlay text spacer settings', () => {
		const result = featureMatchOverlayModeConfigSchema.safeParse({
			...DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG,
			layout: {
				...DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG.layout,
				items: DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG.layout.items.map((item) => {
					if (item.id !== 'top-bar' || item.type !== 'widget-group')
						return item;
					return {
						...item,
						children: item.children.map(child => child.id === 'top-deck' && child.widget.type === 'text'
							? {
									...child,
									widget: {
										...child.widget,
										template: '{deckColors}{spacer}{deck}',
										spacerWidth: 48,
									},
								}
							: child),
					};
				}),
			},
		});

		expect(result.success).toBe(true);
	});

	it('accepts persisted Feature Match Overlay anchor selections', () => {
		const result = featureMatchOverlayModeConfigSchema.safeParse({
			...DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG,
			layout: {
				...DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG.layout,
				items: DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG.layout.items.map((item) => {
					if (item.id === 'main-source') {
						return {
							...item,
							anchor: 'center',
						};
					}

					if (item.id === 'top-bar' && item.type === 'widget-group') {
						return {
							...item,
							children: item.children.map(child => child.id === 'top-name-record' && child.layout.mode === 'canvas'
								? { ...child, layout: { ...child.layout, anchor: 'bottom-right' } }
								: child),
						};
					}

					return item;
				}),
			},
		});

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.layout.items.find(item => item.id === 'main-source')?.anchor).toBe('center');
			const topBar = result.data.layout.items.find(item => item.id === 'top-bar');
			const child = topBar?.type === 'widget-group' ? topBar.children.find(item => item.id === 'top-name-record') : undefined;
			expect(child?.layout).toMatchObject({ mode: 'canvas', anchor: 'bottom-right' });
		}
	});

	it('accepts partial top-level Feature Match Overlay patches but validates nested values', () => {
		expect(modeConfigPatchSchemaMap['feature-match-overlay'].safeParse({ featureMatchId: null }).success).toBe(true);
		expect(modeConfigPatchSchemaMap['feature-match-overlay'].safeParse({ layout: { items: [] } }).success).toBe(false);
	});
});

describe('idleModeConfigSchema', () => {
	it('accepts standalone video background playback settings', () => {
		const result = idleModeConfigSchema.safeParse({
			mediaBackground: {
				enabled: true,
				type: 'video',
				url: '/backgrounds/standalone-loop.mp4',
				fit: 'contain',
				opacity: 1,
				playbackRate: 1.25,
				loop: true,
			},
		});

		expect(result.success).toBe(true);
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
		autoPaging: false,
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
		const result = modeConfigParamsSchema.safeParse({ id: '42', screenId: '99', mode: 'idle' });
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.id).toBe(42);
			expect(result.data.screenId).toBe(99);
		}
	});
});
