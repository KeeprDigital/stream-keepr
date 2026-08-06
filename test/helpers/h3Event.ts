import type { H3Event } from 'h3';

/**
 * A stand-in for the H3 event a route handler is called with.
 *
 * A unit test that calls a handler directly supplies only the parts of the
 * event the handler under test reads — the request headers it inspects, or
 * nothing at all where every read is mocked. The cast lives here, once, so a
 * test says which parts it is supplying rather than restating that the rest is
 * deliberately absent at every call site.
 */
export function stubH3Event(event: Record<string, unknown> = {}): H3Event {
	return event as unknown as H3Event;
}
