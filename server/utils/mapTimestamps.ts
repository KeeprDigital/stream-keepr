interface WithTimestamps {
	createdAt: Date | string;
	updatedAt: Date | string;
}

/**
 * What the rewrite does to one value.
 *
 * The body only rewrites a key that holds a `Date` or a `string`, so a `*At` key
 * holding anything else comes back exactly as it went in. Saying that here, rather
 * than flattening every `*At` key to `Date`, is what keeps `lastSeenAt: Date | null`
 * nullable and stops a `reversalCompletesAt: number` being described as a date it
 * never becomes.
 */
type ConvertedTimestamp<V> = [Extract<V, Date | string>] extends [never]
	? V
	: Date | Exclude<V, Date | string>;

/**
 * The return type of `mapTimestamps`: every `*At` key that could hold a timestamp
 * holds a `Date`.
 *
 * The key test is the template literal rather than the two names in
 * `WithTimestamps`, because the body's test is `key.endsWith('At')` — it converts
 * `lastSeenAt` and `meleeSyncLeaseExpiresAt` too, and a type naming only
 * `createdAt`/`updatedAt` would be a smaller lie rather than none. The mapping is
 * over `keyof T` so it stays homomorphic: an optional `resolvedAt?: string` comes
 * back optional, not `Date | undefined` and required.
 *
 * Every production caller hands this rows read through Drizzle, where every `*At`
 * column is `mode: 'timestamp_ms'` and therefore already `Date` — so for them the
 * mapped type resolves to the input type and nothing downstream moves. The type
 * only starts saying something new when a caller hands over a `string`, which is
 * exactly the case the old `T -> T` got wrong. See #256.
 */
export type MappedTimestamps<T> = {
	[K in keyof T]: K extends `${string}At` ? ConvertedTimestamp<T[K]> : T[K];
};

export function mapTimestamps<T extends WithTimestamps>(entity: T): MappedTimestamps<T> {
	const result = { ...entity } as Record<string, unknown>;

	for (const [key, value] of Object.entries(entity as Record<string, unknown>)) {
		if (key.endsWith('At') && (value instanceof Date || typeof value === 'string')) {
			result[key] = new Date(value);
		}
	}

	return result as MappedTimestamps<T>;
}
