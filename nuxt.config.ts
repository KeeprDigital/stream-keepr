import type { MutationBodyMethod } from './shared/utils/requestBodyLimits';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { localConfigurationModule } from './build/localConfigurationModule';
import { SUPPORTED_SOCIAL_NETWORKS } from './shared/socialProfiles';
import { GRAPHIC_STYLE_SET_PACKAGE_LIMITS } from './shared/types/graphicStyleSetPackage';
import {
	GRAPHICS_MULTIPART_PART_BYTES,
	MAX_SILENT_VIDEO_INGESTION_BYTES,
	MAX_STILL_IMAGE_INGESTION_BYTES,
} from './shared/utils/graphicsAssetCompatibility';
import { MUTATION_BODY_METHODS } from './shared/utils/requestBodyLimits';

const isIntegration = process.env.STREAM_KEEPR_INTEGRATION === 'true';
const integrationWranglerPersistDir = process.env.STREAM_KEEPR_INTEGRATION_WRANGLER_PERSIST_DIR ?? '.wrangler/state/integration';
const integrationMutationDrainHandler = fileURLToPath(new URL('./test/integration/fixtures/drain-request-body.ts', import.meta.url));
const compatibilityDate = '2026-07-16';

/**
 * Semantic Social Network Icon configurations resolve entirely from bytes shipped
 * with the application. Their names are dynamic at the component site, so the
 * icon scanner cannot discover them there; declare the catalogue explicitly.
 */
const supportedSocialNetworkIcons = SUPPORTED_SOCIAL_NETWORKS.map(network =>
	network.icon.replace('i-simple-icons-', 'simple-icons:'),
);

const databaseId = '26830437-975a-4378-a135-acfc01ea89ae';
const kvNamespaceId = 'a15cf281b12d43e4b5479baf8b69b587';
const workerName = 'stream';

export default defineNuxtConfig({
	ssr: false,

	runtimeConfig: {
		ablyApiKey: '',
		adminBootstrapToken: '',
		betterAuthSecret: '',
		graphicsAdminToken: '',
		screenOutputCapabilitySigningKey: '',
		meleeCredentialEncryptionKey: '',
		meleeCredentialEncryptionKeyVersion: '',
		meleeCredentialEncryptionPreviousKeys: '',
	},

	modules: [
		// First because it says whether this checkout can configure the rest, and a
		// notice about that is worth having before anything else speaks. It no
		// longer needs to be: it populated the environment later modules read their
		// runtimeConfig from until #412 deleted the file it read.
		localConfigurationModule,
		'@nuxthub/core',
		'@nuxt/eslint',
		'@nuxt/fonts',
		'@nuxt/ui',
		'@pinia/nuxt',
		'@vueuse/nuxt',
		'@nuxt/image',
		'@nuxt/test-utils/module',
		'nuxt-echarts',
	],

	fonts: {
		processCSSVariables: true,
		defaults: {
			weights: [400, 500, 600, 700, 800, 900],
			styles: ['normal', 'italic'],
			subsets: ['latin'],
		},
		// The names below are fonts we expect to find on the *viewer's* machine,
		// written into `font-family` stacks as fallbacks behind a real webfont.
		//
		// `@nuxt/fonts` cannot tell a fallback from a request: it reads every name
		// in every stack and asks its providers for each one, and
		// `processCSSVariables` widens that to the stacks held in CSS variables.
		// Any name a provider happens to recognise is then downloaded and bundled.
		//
		// That is how the build broke (#405). Google Fonts carries a `Cascadia
		// Mono` — a Microsoft font, sitting in a monospace fallback stack purely
		// so Windows machines have something to use — so the build fetched it,
		// and when Google began answering 404 for that file every cold build
		// failed. Nothing rendered it; nothing would have missed it.
		//
		// `provider: 'none'` is the module's documented way to say a name is not
		// a request. Be honest about its shape: it is a denylist, so it fails
		// open. A stack that gains a system font tomorrow is fetched again. Add
		// the name here when that happens.
		//
		// The obvious structural fix — `provider: 'npm'` against `@fontsource`
		// packages, resolving from disk with no CDN at all — was tried and does
		// not work yet. The npm provider reads each package's `index.css`
		// (`unifont/dist/index.mjs:683`), and a *static* `@fontsource` package
		// exposes only weight 400 there, so weights 500-900 and every italic
		// silently vanish. `@fontsource-variable` packages carry the full range,
		// but `Saira Condensed` — this app's display face — has no variable
		// build. #406 holds the working notes.
		families: [
			// Monospace fallbacks — `--font-system-mono` in app/assets/css/main.css
			// and the clock stack in Screen/Modes/FeatureMatch/Display.vue.
			{ name: 'Cascadia Mono', provider: 'none' },
			{ name: 'Segoe UI Mono', provider: 'none' },
			{ name: 'Liberation Mono', provider: 'none' },
			{ name: 'SFMono-Regular', provider: 'none' },
			{ name: 'Menlo', provider: 'none' },
			{ name: 'Monaco', provider: 'none' },
			{ name: 'Consolas', provider: 'none' },
			// Sans and serif fallbacks — `--font-system-sans`, `--font-system-serif`.
			{ name: 'Segoe UI', provider: 'none' },
			{ name: 'Georgia', provider: 'none' },
			{ name: 'Times New Roman', provider: 'none' },
			// Already self-hosted, by the hand-written `@font-face` at the top of
			// main.css pointing at public/fonts/mplantin.woff. A provider lookup
			// for this name could only find a different font wearing it.
			{ name: 'MPlantin', provider: 'none' },
		],
	},

	echarts: {
		renderer: ['canvas'],
		charts: ['BarChart', 'PieChart'],
		components: ['GridComponent', 'TooltipComponent', 'LegendComponent'],
		features: ['LabelLayout'],
	},

	// `@nuxtjs/color-mode` declares `configKey: 'colorMode'`, so it reads these
	// from Nuxt config and only from here — the same block in `app.config.ts` was
	// inert, leaving the module on its own `fallback: 'light'` default (#310).
	// `fallback` is what the pre-hydration script returns when no system
	// preference can be read at all, which is the state this app wants dark.
	colorMode: {
		preference: 'system',
		fallback: 'dark',
	},

	css: [
		'~/assets/css/main.css',
	],

	hub: {
		db: {
			dialect: 'sqlite',
			driver: 'd1',
			connection: {
				databaseId,
			},
		},
		kv: {
			driver: 'cloudflare-kv-binding',
			namespaceId: kvNamespaceId,
		},
	},

	eslint: {
		config: {
			standalone: false,
		},
	},

	icon: {
		// Component tests have no Nuxt icon endpoint. Requiring the client bundle
		// there makes a missing local vector fail visibly instead of falling back to
		// a network request the test environment cannot serve.
		provider: process.env.NODE_ENV === 'test' ? 'none' : undefined,
		clientBundle: {
			icons: supportedSocialNetworkIcons,
		},
	},

	nitro: {
		preset: 'cloudflare_module',
		// Nitro's own Wasm support (unwasm). The `cloudflare_module` preset
		// configures it as `{ lazy: false, esmImport: true }`, so a `.wasm?module`
		// import becomes a real ESM import of an emitted `.wasm` asset and the
		// runtime hands back an already-compiled `WebAssembly.Module`. A deployed
		// Worker refuses to compile Wasm from a byte buffer ("Wasm code generation
		// disallowed by embedder"), so nothing here may reintroduce a build plugin
		// that inlines the codecs as base64 — that was #302. `pnpm worker:dry-run`
		// now enforces that against the built bundle (#319).
		experimental: {
			wasm: true,
		},
		handlers: isIntegration
			? [
					{
						route: '/api/_test/bounded-raw-mutation',
						method: 'post',
						handler: integrationMutationDrainHandler,
					},
					...MUTATION_BODY_METHODS.map(method => ({
						route: '/api/_test/ordinary-mutation',
						method: method.toLowerCase() as Lowercase<MutationBodyMethod>,
						handler: integrationMutationDrainHandler,
					})),
				]
			: [],
		routeRules: {
			'/api/graphics-assets/ingestion-operations/**/multipart/parts/**': {
				boundedRawMutations: {
					PUT: {
						maxBytes: GRAPHICS_MULTIPART_PART_BYTES,
						label: 'graphics multipart part',
					},
				},
			},
			'/api/graphics-assets/ingestion-operations/**': {
				boundedRawMutations: {
					PUT: {
						maxBytes: MAX_STILL_IMAGE_INGESTION_BYTES,
						label: 'Graphic Asset transfer',
					},
				},
			},
			// A received Graphic Style Set Package is the archive itself, and it is far
			// smaller than any media transfer: two JSON files bounded by the number of
			// entries a Style Set may hold. The route owns the ceiling so a `.skstyle`
			// is not held to the general JSON-body limit, which describes a different
			// kind of request entirely.
			// Both the install route itself and its preflight sibling, stated separately
			// because a `/**` pattern is about what lies *under* a path.
			'/api/graphics-style-sets/packages': {
				boundedRawMutations: {
					POST: {
						maxBytes: GRAPHIC_STYLE_SET_PACKAGE_LIMITS.maximumArchiveByteLength,
						label: 'Graphic Style Set Package',
					},
				},
			},
			'/api/graphics-style-sets/packages/**': {
				boundedRawMutations: {
					POST: {
						maxBytes: GRAPHIC_STYLE_SET_PACKAGE_LIMITS.maximumArchiveByteLength,
						label: 'Graphic Style Set Package',
					},
				},
			},
			// Exact-byte repair carries whole content of any accepted kind, so its
			// limit is the largest source the compatibility profile accepts. The
			// route streams it without buffering, exactly like ingestion.
			'/api/admin/graphics-assets/discrepancies/**': {
				boundedRawMutations: {
					PUT: {
						maxBytes: MAX_SILENT_VIDEO_INGESTION_BYTES,
						label: 'Graphic Asset Content repair',
					},
				},
			},
			...(isIntegration
				? {
						'/api/_test/bounded-raw-mutation': {
							boundedRawMutations: {
								POST: {
									maxBytes: 2097152,
									label: 'Raw transfer',
								},
							},
						},
					}
				: {}),
		},
		cloudflare: {
			deployConfig: true,
			nodeCompat: true,
			wrangler: {
				name: workerName,
			},
			dev: {
				configPath: 'wrangler.dev.jsonc',
				...(isIntegration ? { persistDir: integrationWranglerPersistDir } : {}),
			},
		},
	},

	imports: {
		dirs: [
			'composables/core',
			'composables/data',
			'composables/featureMatch',
			'composables/repositories',
			'composables/screen',
			'composables/ui',
			'composables/workflows',
		],
	},

	typescript: {
		strict: true,
		typeCheck: !isIntegration,
	},

	vite: {
		...(isIntegration ? { server: { hmr: false, watch: null } } : {}),
		optimizeDeps: {
			include: [
				'ably',
				'three',
				'@tanstack/vue-table',
				'vue-draggable-plus',
				'vue-echarts',
			],
		},
	},

	watchers: isIntegration
		? {
				chokidar: {
					usePolling: true,
					interval: 1000,
				},
			}
		: undefined,

	devtools: {
		enabled: false,
	},

	experimental: {
		typescriptPlugin: true,
	},

	compatibilityDate,
});
