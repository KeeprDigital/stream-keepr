import type { BroadcastGraphicsRejectionCode } from '~~/shared/modules/broadcast-graphics-live-session';
import { BROADCAST_GRAPHICS_REJECTION_CODES } from '~~/shared/modules/broadcast-graphics-live-session';

/**
 * One refused Broadcast Graphics command as the operator's surfaces need it: what
 * the authority refused it for, and the sentence it wrote about the refusal.
 *
 * Both halves, because neither is enough on its own. The code is the part a surface
 * acts on — a Missing Graphic Asset Reference and Unavailable Graphic Asset Content
 * prescribe opposite next moves — and the message is the part that names *which*
 * thing, down to the owner slot the author has to repair.
 */
export interface BroadcastGraphicsCommandRefusal {
	code: BroadcastGraphicsRejectionCode;
	message: string;
}

/**
 * Read a failed command's transport failure as the domain refusal it carries, if it
 * carries one.
 *
 * Both halves live in the response body rather than on the error, and that is the
 * whole reason this function exists. A refusal is minted by
 * `broadcastGraphicsRejectionError` as `createError({ message, data: { code } })`,
 * and the server writes it out as `{ statusCode, statusMessage, message, data }` —
 * so on the client, where `$fetch` hangs the parsed body off `error.data`, the code
 * is at `data.data.code` and the domain sentence at `data.message`.
 *
 * What is *not* there is the thing a caller reaches for first: `Error.message` on a
 * `$fetch` failure is the transport's own line, `[POST] "…": 409 Conflict`, which
 * says nothing an operator can act on. Reporting that instead of the sentence the
 * authority wrote is exactly the defect #230 is about, and reading `data.code` —
 * one level too shallow — is what made every refusal look like a bare conflict.
 *
 * A failure carrying no recognised code is not a domain refusal: it is a transport
 * failure, an ended epoch, or a fault, and the caller decides what those mean.
 */
export function broadcastGraphicsCommandRefusal(
	failure: unknown,
): BroadcastGraphicsCommandRefusal | undefined {
	if (typeof failure !== 'object' || failure === null || !('data' in failure))
		return undefined;

	const body = (failure as { data?: { message?: unknown; data?: { code?: unknown } } }).data;
	const code = body?.data?.code;
	if (!BROADCAST_GRAPHICS_REJECTION_CODES.includes(code as BroadcastGraphicsRejectionCode))
		return undefined;

	// A refusal with no readable sentence is still a refusal: the code alone tells a
	// surface which of the two next moves to prescribe, and losing that because the
	// prose went missing would be the worse failure.
	return {
		code: code as BroadcastGraphicsRejectionCode,
		message: typeof body?.message === 'string' && body.message.length > 0
			? body.message
			: 'The authoritative side refused this playout action',
	};
}
