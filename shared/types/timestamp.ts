export type OmitTimestamps<T> = Omit<T, 'createdAt' | 'updatedAt'>;
