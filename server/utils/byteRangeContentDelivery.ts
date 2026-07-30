/**
 * Shared HTTP semantics for ranged and conditional content delivery. Both the
 * Screen Output capability routes and the authenticated editor content route
 * serve immutable Graphic Asset Revision bytes through these helpers.
 */

export interface ByteRange {
	start: number;
	end: number;
}

function weakEtag(value: string): string {
	return value.trim().replace(/^W\//i, '');
}

export function ifNoneMatchMatches(value: string | null | undefined, etag: string): boolean {
	if (!value)
		return false;
	return value.split(',').some(candidate =>
		candidate.trim() === '*' || weakEtag(candidate) === weakEtag(etag),
	);
}

export function requestedByteRange(
	value: string | null | undefined,
	byteLength: number,
): ByteRange | 'unsatisfiable' | undefined {
	if (!value)
		return;
	const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
	if (!match || (!match[1] && !match[2]))
		return 'unsatisfiable';

	if (!match[1]) {
		const suffixLength = Number(match[2]);
		if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0)
			return 'unsatisfiable';
		return {
			start: Math.max(0, byteLength - suffixLength),
			end: byteLength - 1,
		};
	}

	const start = Number(match[1]);
	const requestedEnd = match[2] ? Number(match[2]) : byteLength - 1;
	if (
		!Number.isSafeInteger(start)
		|| !Number.isSafeInteger(requestedEnd)
		|| start < 0
		|| requestedEnd < start
		|| start >= byteLength
	) {
		return 'unsatisfiable';
	}
	return {
		start,
		end: Math.min(requestedEnd, byteLength - 1),
	};
}

export function rangePermitted(ifRange: string | null | undefined, etag: string): boolean {
	if (!ifRange)
		return true;
	return ifRange.trim() === etag;
}
