import type { BoundedRawMutationPolicy, MutationBodyMethod } from '../utils/requestBodyLimits';
import 'nitropack/types';

declare module 'nitropack/types' {
	interface NitroRouteConfig {
		boundedRawMutations?: Partial<Record<MutationBodyMethod, BoundedRawMutationPolicy>>;
	}

	interface NitroRouteRules {
		boundedRawMutations?: Partial<Record<MutationBodyMethod, BoundedRawMutationPolicy>>;
	}
}
