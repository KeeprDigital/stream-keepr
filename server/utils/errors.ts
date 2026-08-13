import { isError } from 'h3';

export class StateConflictError extends Error {
	statusCode = 409;
	constructor(resourceType: string, resourceId: number) {
		super(`${resourceType} ${resourceId} state was modified concurrently`);
		this.name = 'StateConflictError';
	}
}

/**
 * Whether a failure is a lost concurrency race rather than a fault.
 *
 * The distinction is what lets a caller absorb one: a race means somebody else
 * got there first and the work can be retried or abandoned, while a fault means
 * something is broken and swallowing it hides the breakage. Both arrive as
 * exceptions from the same call, so a caller that wants to absorb only the
 * first has to be able to tell them apart.
 */
export function isStateConflictFailure(error: unknown): boolean {
	if (error instanceof StateConflictError)
		return true;
	return typeof error === 'object'
		&& error !== null
		&& (error as { statusCode?: unknown }).statusCode === 409;
}

/**
 * The server is running, but something it needs was never configured.
 *
 * The name of the setting is the whole point of the message, so it is carried
 * as public text: the only reader who can act on this failure is the one who
 * has to go and set the value, and a sanitized 'Internal Server Error' sends
 * them to the logs of a server that is behaving exactly as configured. It
 * names a setting, never a value.
 */
export class ServiceConfigurationError extends Error {
	statusCode = 503;
	constructor(readonly setting: string, detail: string) {
		super(`${setting} ${detail}`);
		this.name = 'ServiceConfigurationError';
	}
}

/**
 * The server was assembled wrong: a component is missing a collaborator it was
 * supposed to be constructed with.
 *
 * The sibling of `ServiceConfigurationError` with the opposite cause — nothing
 * is missing from the environment, so no setting will fix it — and public for
 * the same reason. A sanitized 'Internal Server Error' tells the operator only
 * that something broke; naming the component and the collaborator it did not
 * get is what lets them report a build fault as a build fault instead of
 * hunting for an environment variable that was never the problem.
 *
 * It names a component and a collaborator, never runtime data, so it carries no
 * more about the server's insides than the module layout a reader could infer
 * from the API surface anyway. See #243.
 */
export class ServiceWiringError extends Error {
	statusCode = 503;
	constructor(readonly component: string, readonly dependency: string) {
		super(
			`${component} was constructed without ${dependency}. `
			+ 'This is a defect in how the server was assembled, not a setting that can be changed.',
		);
		this.name = 'ServiceWiringError';
	}
}

/**
 * The store a Graphics Author Session lives in could not be reached.
 *
 * Public for the same reason as the two above, and it exists at all for a reason
 * they do not have: the refusal it becomes is raised around whatever the store
 * threw, and a raw KV exception carries nothing `mapPublicNitroError` can
 * discriminate on — so before this class the sentence below was written, sent,
 * and then overwritten with 'Internal Server Error' on the way out (#294). What
 * the name buys is that the mapper can tell "the session store is down" from
 * "something threw", which is the whole difference between an operator who knows
 * to go and look at a binding and one who has been told nothing.
 *
 * It names the subsystem and never the store's own words: the exception that
 * caused it is kept as `cause`, where debugging can reach it and no response
 * carries it. The failure log does not — `errorLogFields` reads a single level
 * of cause and takes only its `name` and `code`, so the line names this class
 * rather than the store's refusal.
 */
export class GraphicsAuthorSessionUnavailableError extends Error {
	statusCode = 503;
	constructor(cause: unknown) {
		super('Graphics author sessions are temporarily unavailable', { cause });
		this.name = 'GraphicsAuthorSessionUnavailableError';
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
