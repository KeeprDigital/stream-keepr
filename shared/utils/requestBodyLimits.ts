export const MUTATION_BODY_METHODS = ['DELETE', 'PATCH', 'POST', 'PUT'] as const;

export type MutationBodyMethod = typeof MUTATION_BODY_METHODS[number];

export interface BoundedRawMutationPolicy {
	maxBytes: number;
	label: string;
}
