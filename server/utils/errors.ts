import { isError } from 'h3';

export class StateConflictError extends Error {
	statusCode = 409;
	constructor(resourceType: string, resourceId: number) {
		super(`${resourceType} ${resourceId} state was modified concurrently`);
		this.name = 'StateConflictError';
	}
}

interface ErrorWithPublicMetadata {
	code?: unknown;
	statusCode?: unknown;
	message?: unknown;
}

/**
 * Convert operational failures into text safe to persist and broadcast.
 * Detailed upstream and database errors belong in structured logs, not Event
 * rows that are sent to every connected dashboard.
 */
export function toPublicOperationalError(error: unknown): string {
	const candidate = error && typeof error === 'object' ? error as ErrorWithPublicMetadata : null;
	if (candidate?.code === 'IMPORTED_CARD_LOOKUP_UNAVAILABLE') {
		return 'Card data provider is temporarily unavailable. Existing deck data was preserved; retry the sync.';
	}
	if (candidate?.code === 'UNSUPPORTED_MELEE_TEAM_PAYLOAD') {
		return 'This Melee team tournament cannot be synced because the application currently supports individual-player tournaments only.';
	}

	const statusCode = isError(candidate) ? candidate.statusCode : null;
	if (statusCode !== null && statusCode >= 400 && statusCode < 500 && typeof candidate?.message === 'string') {
		return candidate.message.slice(0, 500);
	}

	return 'Melee sync failed. Retry the operation.';
}
