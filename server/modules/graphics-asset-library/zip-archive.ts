/**
 * A minimal, data-only stored-ZIP writer for Template Package export.
 *
 * Every entry is stored uncompressed with a streaming data descriptor, so a
 * Worker can forward asset bytes straight from the canonical byte store without
 * ever holding a complete asset in memory. The archive carries no directory
 * entries, links, attributes, encryption, or comments, and the total archive
 * length is known before the first byte is written because stored entry sizes
 * come from the catalogue.
 *
 * Zip64 is deliberately unsupported: Template Package limits keep every archive
 * far below the 4 GiB and 65,535-entry points where it would be required, and
 * failing closed is safer than emitting a container a receiver cannot read.
 */

const LOCAL_HEADER_SIGNATURE = 0x04034B50;
const CENTRAL_HEADER_SIGNATURE = 0x02014B50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054B50;
const DATA_DESCRIPTOR_SIGNATURE = 0x08074B50;

const LOCAL_HEADER_BYTES = 30;
const CENTRAL_HEADER_BYTES = 46;
const DATA_DESCRIPTOR_BYTES = 16;
const END_OF_CENTRAL_DIRECTORY_BYTES = 22;

const STORED_METHOD = 0;
/** Bit 3 moves the CRC and sizes into a trailing data descriptor; bit 11 declares UTF-8 names. */
const STREAMING_UTF8_FLAGS = 0x0808;
const VERSION_NEEDED_TO_EXTRACT = 20;
const MAXIMUM_ENTRY_COUNT = 0xFFFF;
const MAXIMUM_ENTRY_BYTE_LENGTH = 0xFFFFFFFE;
const MAXIMUM_ENTRY_NAME_BYTES = 200;

/**
 * A fixed 1980-01-01 MS-DOS timestamp. The manifest already records when a
 * package was produced, so the container itself carries no clock reading.
 */
const FIXED_DOS_TIME = 0;
const FIXED_DOS_DATE = 0x0021;

export class StoredZipArchiveError extends Error {}

export interface StoredZipEntry {
	name: string;
	byteLength: number;
	open: () => Promise<ReadableStream<Uint8Array>>;
}

let crcTable: Uint32Array | undefined;

function crc32Table(): Uint32Array {
	if (crcTable)
		return crcTable;
	const table = new Uint32Array(256);
	for (let index = 0; index < 256; index += 1) {
		let value = index;
		for (let bit = 0; bit < 8; bit += 1)
			value = value & 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1;
		table[index] = value >>> 0;
	}
	crcTable = table;
	return table;
}

/** Incremental CRC-32 so an entry never has to be buffered to be checksummed. */
export function crc32Update(current: number, bytes: Uint8Array): number {
	const table = crc32Table();
	let value = (current ^ 0xFFFFFFFF) >>> 0;
	for (let index = 0; index < bytes.length; index += 1)
		value = (table[(value ^ bytes[index]!) & 0xFF]! ^ (value >>> 8)) >>> 0;
	return (value ^ 0xFFFFFFFF) >>> 0;
}

export function crc32(bytes: Uint8Array): number {
	return crc32Update(0, bytes);
}

function encodeName(name: string): Uint8Array {
	return new TextEncoder().encode(name);
}

/**
 * Entry names are validated at construction so the archive cannot carry a
 * traversal, absolute, backslash-separated, case-colliding, or control-character
 * path. A receiver enforces the same rules; producing one would be a defect.
 */
function assertSafeEntryNames(entries: readonly { name: string }[]): void {
	const seen = new Set<string>();
	for (const entry of entries) {
		const { name } = entry;
		if (!name || name.length > MAXIMUM_ENTRY_NAME_BYTES)
			throw new StoredZipArchiveError(`Archive entry name "${name}" is empty or too long`);
		if (!/^[\w.-]+(?:\/[\w.-]+)*$/.test(name))
			throw new StoredZipArchiveError(`Archive entry name "${name}" is not a safe relative path`);
		if (name.split('/').some(segment => segment === '.' || segment === '..'))
			throw new StoredZipArchiveError(`Archive entry name "${name}" traverses its archive`);
		const collisionKey = name.toLowerCase();
		if (seen.has(collisionKey))
			throw new StoredZipArchiveError(`Archive entry name "${name}" collides with another entry`);
		seen.add(collisionKey);
	}
}

/**
 * The exact archive length, known before streaming because stored entries add no
 * compression overhead. Export compares this against the archive byte limit and
 * a route may publish it as `Content-Length`.
 *
 * Measuring deliberately never fails. A caller measures precisely so it can
 * refuse an oversized package through its own reporting contract, so throwing
 * here would pre-empt that report with an exception for the very case the
 * caller is trying to describe. The format's own ceilings are enforced by
 * `createStoredZipArchive`, which is the point where bytes would be written.
 */
export function storedZipArchiveByteLength(
	entries: readonly { name: string; byteLength: number }[],
): number {
	let total = END_OF_CENTRAL_DIRECTORY_BYTES;
	for (const entry of entries) {
		const nameBytes = encodeName(entry.name).byteLength;
		total += LOCAL_HEADER_BYTES + nameBytes + entry.byteLength + DATA_DESCRIPTOR_BYTES;
		total += CENTRAL_HEADER_BYTES + nameBytes;
	}
	return total;
}

/**
 * The non-Zip64 ceilings, checked only where an archive is actually produced.
 * Template Package limits are far stricter, so a caller honouring them can never
 * reach these; they exist so a future caller cannot silently emit a container no
 * reader could open.
 */
function assertWritableArchive(
	entries: readonly { name: string; byteLength: number }[],
): void {
	if (entries.length > MAXIMUM_ENTRY_COUNT)
		throw new StoredZipArchiveError('Archive has more entries than a non-Zip64 archive can record');
	for (const entry of entries) {
		if (!Number.isSafeInteger(entry.byteLength) || entry.byteLength < 0)
			throw new StoredZipArchiveError(`Archive entry "${entry.name}" has an invalid byte length`);
		if (entry.byteLength > MAXIMUM_ENTRY_BYTE_LENGTH)
			throw new StoredZipArchiveError(`Archive entry "${entry.name}" is too large for a non-Zip64 archive`);
	}
	if (storedZipArchiveByteLength(entries) > MAXIMUM_ENTRY_BYTE_LENGTH)
		throw new StoredZipArchiveError('Archive is too large for a non-Zip64 archive');
}

function localHeader(name: Uint8Array): Uint8Array {
	const header = new Uint8Array(LOCAL_HEADER_BYTES + name.byteLength);
	const view = new DataView(header.buffer);
	view.setUint32(0, LOCAL_HEADER_SIGNATURE, true);
	view.setUint16(4, VERSION_NEEDED_TO_EXTRACT, true);
	view.setUint16(6, STREAMING_UTF8_FLAGS, true);
	view.setUint16(8, STORED_METHOD, true);
	view.setUint16(10, FIXED_DOS_TIME, true);
	view.setUint16(12, FIXED_DOS_DATE, true);
	// Bit 3 requires a zero CRC and zero sizes here; the data descriptor carries them.
	view.setUint16(26, name.byteLength, true);
	header.set(name, LOCAL_HEADER_BYTES);
	return header;
}

function dataDescriptor(crc: number, byteLength: number): Uint8Array {
	const descriptor = new Uint8Array(DATA_DESCRIPTOR_BYTES);
	const view = new DataView(descriptor.buffer);
	view.setUint32(0, DATA_DESCRIPTOR_SIGNATURE, true);
	view.setUint32(4, crc, true);
	view.setUint32(8, byteLength, true);
	view.setUint32(12, byteLength, true);
	return descriptor;
}

function centralHeader(input: {
	name: Uint8Array;
	crc: number;
	byteLength: number;
	localHeaderOffset: number;
}): Uint8Array {
	const header = new Uint8Array(CENTRAL_HEADER_BYTES + input.name.byteLength);
	const view = new DataView(header.buffer);
	view.setUint32(0, CENTRAL_HEADER_SIGNATURE, true);
	view.setUint16(4, VERSION_NEEDED_TO_EXTRACT, true);
	view.setUint16(6, VERSION_NEEDED_TO_EXTRACT, true);
	view.setUint16(8, STREAMING_UTF8_FLAGS, true);
	view.setUint16(10, STORED_METHOD, true);
	view.setUint16(12, FIXED_DOS_TIME, true);
	view.setUint16(14, FIXED_DOS_DATE, true);
	view.setUint32(16, input.crc, true);
	view.setUint32(20, input.byteLength, true);
	view.setUint32(24, input.byteLength, true);
	view.setUint16(28, input.name.byteLength, true);
	view.setUint32(42, input.localHeaderOffset, true);
	header.set(input.name, CENTRAL_HEADER_BYTES);
	return header;
}

function endOfCentralDirectory(input: {
	entryCount: number;
	centralDirectoryByteLength: number;
	centralDirectoryOffset: number;
}): Uint8Array {
	const record = new Uint8Array(END_OF_CENTRAL_DIRECTORY_BYTES);
	const view = new DataView(record.buffer);
	view.setUint32(0, END_OF_CENTRAL_DIRECTORY_SIGNATURE, true);
	view.setUint16(8, input.entryCount, true);
	view.setUint16(10, input.entryCount, true);
	view.setUint32(12, input.centralDirectoryByteLength, true);
	view.setUint32(16, input.centralDirectoryOffset, true);
	return record;
}

async function* archiveChunks(entries: readonly StoredZipEntry[]): AsyncGenerator<Uint8Array> {
	const directory: Uint8Array[] = [];
	let offset = 0;
	for (const entry of entries) {
		const name = encodeName(entry.name);
		const localHeaderOffset = offset;
		const header = localHeader(name);
		offset += header.byteLength;
		yield header;

		let crc = 0;
		let observedByteLength = 0;
		const reader = (await entry.open()).getReader();
		let drained = false;
		try {
			for (;;) {
				const { done, value } = await reader.read();
				if (done)
					break;
				observedByteLength += value.byteLength;
				if (observedByteLength > entry.byteLength) {
					throw new StoredZipArchiveError(
						`Archive entry "${entry.name}" produced more bytes than its declared length`,
					);
				}
				crc = crc32Update(crc, value);
				offset += value.byteLength;
				yield value;
			}
			drained = true;
		}
		finally {
			// An abandoned generator — a client aborting the download, or an entry
			// failing mid-stream — must release the source it opened. Without this
			// the in-flight canonical body stays open for the rest of the request.
			if (!drained)
				await reader.cancel().catch(() => {});
			reader.releaseLock();
		}
		if (observedByteLength !== entry.byteLength) {
			throw new StoredZipArchiveError(
				`Archive entry "${entry.name}" produced ${observedByteLength} of ${entry.byteLength} declared bytes`,
			);
		}

		const descriptor = dataDescriptor(crc, observedByteLength);
		offset += descriptor.byteLength;
		yield descriptor;
		directory.push(centralHeader({
			name,
			crc,
			byteLength: observedByteLength,
			localHeaderOffset,
		}));
	}

	const centralDirectoryOffset = offset;
	let centralDirectoryByteLength = 0;
	for (const header of directory) {
		centralDirectoryByteLength += header.byteLength;
		yield header;
	}
	yield endOfCentralDirectory({
		entryCount: directory.length,
		centralDirectoryByteLength,
		centralDirectoryOffset,
	});
}

/**
 * Streams the archive one chunk at a time, honouring reader backpressure. An
 * entry whose bytes disappear or change length mid-stream errors the stream
 * rather than emitting a silently truncated archive, and cancelling the archive
 * cancels whatever entry source is currently open without opening any more.
 */
export function createStoredZipArchive(
	entries: readonly StoredZipEntry[],
): ReadableStream<Uint8Array> {
	assertSafeEntryNames(entries);
	assertWritableArchive(entries);
	const chunks = archiveChunks(entries);
	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			const next = await chunks.next();
			if (next.done) {
				controller.close();
				return;
			}
			controller.enqueue(next.value);
		},
		async cancel(reason) {
			await chunks.return(reason);
		},
	});
}
