interface WithTimestamps {
	createdAt: Date | string;
	updatedAt: Date | string;
}

export function mapTimestamps<T extends WithTimestamps>(entity: T): T {
	const result = { ...entity } as Record<string, unknown>;

	for (const [key, value] of Object.entries(entity as Record<string, unknown>)) {
		if (key.endsWith('At') && (value instanceof Date || typeof value === 'string')) {
			result[key] = new Date(value);
		}
	}

	return result as T;
}
