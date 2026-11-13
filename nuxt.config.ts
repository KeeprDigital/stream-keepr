import type { MutationBodyMethod } from './shared/utils/requestBodyLimits';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { APPLICATION_FONTS_OPTIONS, dropFontAssetsFromManifest } from './build/applicationFonts';
import { CHECKOUT_TSCONFIG } from './build/checkoutTsconfig';
import { localConfigurationModule } from './build/localConfigurationModule';
import { SUPPORTED_SOCIAL_NETWORKS } from './shared/socialProfiles';
import {
	GRAPHICS_MULTIPART_PART_BYTES,
	MAX_SILENT_VIDEO_INGESTION_BYTES,
	MAX_STILL_IMAGE_INGESTION_BYTES,
} from './shared/utils/graphicsAssetCompatibility';
import { MUTATION_BODY_METHODS, TCGPLUS_IMPORT_MAX_BODY_BYTES } from './shared/utils/requestBodyLimits';

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

const workerName = 'stream';

export default defineNuxtConfig({
	ssr: false,

	// Nothing but `nuxt prepare` may rewrite `.nuxt` while other gates run:
	// the root tsconfig extends it, so every Vite and TypeScript consumer reads it.
	// An integration server keeps its build directory inside its own Wrangler
	// state, so the suite can run several servers from one checkout
	// (`test/integration/state.ts`); `pnpm verify` builds into a directory of its
	// own (`scripts/verify.mjs`).
	...(isIntegration
		? { buildDir: `${integrationWranglerPersistDir}/nuxt` }
		: process.env.STREAM_KEEPR_BUILD_DIR
			? { buildDir: process.env.STREAM_KEEPR_BUILD_DIR }
			: {}),

	runtimeConfig: {
		ablyApiKey: '',
		adminBootstrapToken: '',
		// One Piece card data (ADR-0057). Either blank leaves it unavailable.
		bandaiKeeprApiKey: '',
		bandaiKeeprApiUrl: '',
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
		'@nuxt/eslint',
		'@nuxt/fonts',
		'@nuxt/ui',
		'@pinia/nuxt',
		'@vueuse/nuxt',
		'@nuxt/image',
		'@nuxt/test-utils/module',
		'nuxt-echarts',
	],

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

	eslint: {
		config: {
			standalone: false,
		},
	},

	// Application fonts come from their pinned Fontsource packages on disk, and
	// only from there (`build/applicationFonts.ts`, ADR-0086).
	fonts: APPLICATION_FONTS_OPTIONS,

	hooks: {
		// Font files leave the client manifest, or every chunk's precomputed
		// dependencies repeat all of them in the Worker bundle.
		'build:manifest': dropFontAssetsFromManifest,
	},

	icon: {
		// Component tests have no Nuxt icon endpoint. Requiring the client bundle
		// there makes a missing local vector fail visibly instead of falling back to
		// a network request the test environment cannot serve.
		provider: process.env.NODE_ENV === 'test'
			? 'none'
			: undefined,
		clientBundle: {
			icons: supportedSocialNetworkIcons,
			// So the bundle holds every icon the app names: a component test that
			// renders an unbundled icon fails (`test/nuxt/failOnUnbundledIcon.ts`).
			// The default globs skip `.ts`, so the app's and shared modules' icon
			// names (a Shape Geometry preset's, a Screen Mode Definition's) are
			// added; replacing the defaults means restating them.
			scan: process.env.NODE_ENV === 'test' && {
				globInclude: ['**/*.{vue,jsx,tsx,md,mdc,mdx,yml,yaml}', 'app/**/*.ts', 'shared/**/*.ts'],
			},
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
			// `useEvent()` names the request a publish is made in, so its Screen
			// notices finish after the answer (`server/utils/ably.ts`).
			asyncContext: true,
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
			// The output page's address carries its Screen Output Link. It is never
			// sent as a `Referer` to the image hosts an output loads from, nor indexed.
			'/o/**': {
				headers: {
					'Referrer-Policy': 'no-referrer',
					'X-Robots-Tag': 'noindex',
				},
			},
			// A TCG+ Import sends the whole export, preview and import alike (ADR-0074).
			'/api/events/*/tcgplus/**': {
				boundedRawMutations: {
					POST: {
						maxBytes: TCGPLUS_IMPORT_MAX_BODY_BYTES,
						label: 'TCG+ export',
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
		// The KV binding, as `useStorage('kv')`. Every binding itself is declared in
		// `wrangler.jsonc` (deploy) and `wrangler.dev.jsonc` (dev).
		storage: {
			kv: {
				driver: 'cloudflare-kv-binding',
				binding: 'KV',
			},
		},
		cloudflare: {
			deployConfig: true,
			nodeCompat: true,
			wrangler: {
				name: workerName,
			},
			dev: {
				configPath: 'wrangler.dev.jsonc',
				...(isIntegration
					? { persistDir: integrationWranglerPersistDir }
					: {}),
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
		// Named, or Vite goes looking and climbs out of this checkout (build/checkoutTsconfig.ts).
		tsconfig: CHECKOUT_TSCONFIG,
		// Each integration server optimises dependencies into its own cache: they
		// start together, and one shared cache is rewritten under the others' pages.
		...(isIntegration
			? {
					server: { hmr: false, watch: null },
					cacheDir: `${integrationWranglerPersistDir}/vite`,
				}
			: {}),
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
