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
 * The store a Graphics Author Session lives in could not be reached.
 *
 * Public for the same reason as `ServiceConfigurationError` above, and it exists
 * at all for a reason that class does not have: the refusal it becomes is raised
 * around whatever the store
 * threw, and a raw KV exception carries nothing `mapPublicNitroError` can
 * discriminate on — so before this class the sentence below was written, sent,
 * and then overwritten with 'Internal Server Error' on the way out (#294). What
 * the name buys is that the mapper can tell "the session store is down" from
 * "something threw", which is the whole difference between an operator who knows
 * to go and look at a binding and one who has been told nothing.
 *
 * It names the subsystem and never the store's own words: the exception that
 * caused it is kept as `cause`, where debugging can reach it and no response
 * carries it. The failure log names this class — `errorLogFields` takes its
 * `name` from the nearest cause — and, because this class declares no `code`,
 * walks on to carry the store exception's own code beside it (#323), so one
 * line says both what failed and why the store refused.
 */
export class GraphicsAuthorSessionUnavailableError extends Error {
	statusCode = 503;
	constructor(cause: unknown) {
		super('Graphics author sessions are temporarily unavailable', { cause });
		this.name = 'GraphicsAuthorSessionUnavailableError';
	}
}

/**
 * Something this request needed was out of reach, and may not be a moment from now.
 *
 * Public for the reason the three above are: the sentence names what stopped working
 * and implies what to do about it — wait and ask again — where 'Internal Server Error'
 * says only that the request failed. The response carries `retry-after` beside it,
 * because a reader told a thing is temporary is owed a number.
 *
 * **One class for every subsystem, deliberately.** Its siblings each name a specific
 * fault an operator acts on differently, so each earned a type. This one is the
 * opposite case: seven sites across Graphic Asset content, thumbnails, staged bytes,
 * Screen Output delivery, capability sessions and Template Package export all meant the
 * same thing, and #321 found every one of them sanitized to a placeholder because none
 * of them said so in a way the mapper could read. Minting a class per subsystem would
 * have answered that seven times and left the eighth site to make the same mistake
 * again. What varies between them is the sentence, which is the raiser's own — this
 * class carries no wording of its own precisely so it cannot flatten theirs.
 *
 * It says a subsystem is unreachable and never why, so nothing a store threw travels
 * with it. Pass the underlying failure as `cause` where there is one: the exception is
 * kept there for a debugger to reach, and no response carries it. The failure log names
 * this class — `errorLogFields` takes its `name` from the nearest cause — and, since
 * this class declares no `code`, walks on to carry the underlying refusal's code beside
 * it (#323), with or without an inner cause. The same judgement as
 * `GraphicsAuthorSessionUnavailableError` above.
 */
export class TemporarilyUnavailableError extends Error {
	statusCode = 503;
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'TemporarilyUnavailableError';
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
