import process from 'node:process';

const isIntegration = process.env.STREAM_KEEPR_INTEGRATION === 'true';
const integrationWranglerPersistDir = process.env.STREAM_KEEPR_INTEGRATION_WRANGLER_PERSIST_DIR ?? '.wrangler/state/integration';
const compatibilityDate = '2026-07-16';

const databaseId = '26830437-975a-4378-a135-acfc01ea89ae';
const kvNamespaceId = 'a15cf281b12d43e4b5479baf8b69b587';
const workerName = 'stream';

export default defineNuxtConfig({
	ssr: false,

	runtimeConfig: {
		ablyApiKey: '',
		meleeCredentialEncryptionKey: '',
		meleeCredentialEncryptionKeyVersion: '',
		meleeCredentialEncryptionPreviousKeys: '',
	},

	modules: [
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
	},

	echarts: {
		renderer: ['canvas'],
		charts: ['BarChart', 'PieChart'],
		components: ['GridComponent', 'TooltipComponent', 'LegendComponent'],
		features: ['LabelLayout'],
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

	nitro: {
		preset: 'cloudflare_module',
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
