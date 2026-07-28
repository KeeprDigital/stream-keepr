import 'h3';

declare module 'h3' {
	interface H3EventContext {
		cloudflare?: {
			env?: Cloudflare.Env;
			context?: ExecutionContext;
		};
	}
}
