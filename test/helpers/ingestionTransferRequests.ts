import type { MockInstance } from 'vitest';

/**
 * Helpers for the two suites that drive a Graphics Ingestion Operation's
 * transfer through a mocked `$fetch`.
 *
 * A transfer is judged by the requests it made and by how it sliced the source,
 * so both suites need a source of an exact length and a readable account of what
 * was sent. Neither wants the bytes: a source at the multipart threshold is
 * tens of megabytes, and allocating them would be paying for a length.
 */

/** A source of an exact length that holds none of the bytes it claims. */
export function sourceOfByteLength(byteLength: number): Blob {
	const source = new Blob([new Uint8Array(1)]);
	return Object.create(source, {
		size: { value: byteLength },
		slice: {
			value: (start: number, end: number) =>
				Object.create(source, { size: { value: end - start } }) as Blob,
		},
	}) as Blob;
}

/** The same, named, for the suites that hand over a chosen package file. */
export function fileOfByteLength(name: string, byteLength: number): File {
	const file = new File([new Uint8Array(1)], name);
	return Object.create(file, {
		size: { value: byteLength },
		slice: {
			value: (start: number, end: number) =>
				Object.create(file, { size: { value: end - start } }) as Blob,
		},
	}) as File;
}

/** Every request a mocked `$fetch` received, in order, as `METHOD path`. */
export function requestsMadeTo(mockFetch: MockInstance): string[] {
	return mockFetch.mock.calls.map(
		call => `${(call[1] as { method?: string } | undefined)?.method ?? 'GET'} ${call[0] as string}`,
	);
}
