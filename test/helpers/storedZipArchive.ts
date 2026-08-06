import { Buffer } from 'node:buffer';
import { crc32 } from 'node:zlib';

/**
 * A deliberately independent reader for the archives the Template Package
 * exporter writes. It parses the ZIP central directory straight from the
 * published format rather than reusing any production helper, and verifies each
 * entry against `node:zlib`'s CRC-32, so a symmetric bug in the writer cannot
 * pass unnoticed.
 */

const LOCAL_HEADER_SIGNATURE = 0x04034B50;
const CENTRAL_HEADER_SIGNATURE = 0x02014B50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054B50;
const DATA_DESCRIPTOR_SIGNATURE = 0x08074B50;

export interface StoredZipArchiveEntry {
	name: string;
	bytes: Uint8Array;
	crc32: number;
	compressionMethod: number;
	generalPurposeFlags: number;
	/** Populated only when the entry carries a streaming data descriptor. */
	dataDescriptor?: { crc32: number; compressedSize: number; uncompressedSize: number };
}

export interface StoredZipArchive {
	entries: StoredZipArchiveEntry[];
	entryNames: string[];
	byteLength: number;
	entry: (name: string) => StoredZipArchiveEntry;
	text: (name: string) => string;
	json: <T = unknown>(name: string) => T;
}

function view(bytes: Uint8Array) {
	return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function endOfCentralDirectoryOffset(bytes: Uint8Array): number {
	const data = view(bytes);
	for (let offset = bytes.byteLength - 22; offset >= 0; offset -= 1) {
		if (data.getUint32(offset, true) === END_OF_CENTRAL_DIRECTORY_SIGNATURE)
			return offset;
	}
	throw new Error('Archive has no end-of-central-directory record');
}

export function readStoredZipArchive(bytes: Uint8Array): StoredZipArchive {
	const data = view(bytes);
	const endOffset = endOfCentralDirectoryOffset(bytes);
	const entryCount = data.getUint16(endOffset + 10, true);
	const centralDirectorySize = data.getUint32(endOffset + 12, true);
	const centralDirectoryOffset = data.getUint32(endOffset + 16, true);
	if (centralDirectoryOffset + centralDirectorySize !== endOffset)
		throw new Error('Central directory does not end where the end record begins');

	const entries: StoredZipArchiveEntry[] = [];
	let cursor = centralDirectoryOffset;
	for (let index = 0; index < entryCount; index += 1) {
		if (data.getUint32(cursor, true) !== CENTRAL_HEADER_SIGNATURE)
			throw new Error(`Central directory entry ${index} has no header signature`);
		const generalPurposeFlags = data.getUint16(cursor + 8, true);
		const compressionMethod = data.getUint16(cursor + 10, true);
		const expectedCrc = data.getUint32(cursor + 16, true);
		const compressedSize = data.getUint32(cursor + 20, true);
		const uncompressedSize = data.getUint32(cursor + 24, true);
		const nameLength = data.getUint16(cursor + 28, true);
		const extraLength = data.getUint16(cursor + 30, true);
		const commentLength = data.getUint16(cursor + 32, true);
		const localHeaderOffset = data.getUint32(cursor + 42, true);
		const name = Buffer.from(bytes.subarray(cursor + 46, cursor + 46 + nameLength)).toString('utf8');
		cursor += 46 + nameLength + extraLength + commentLength;

		if (compressionMethod !== 0)
			throw new Error(`Entry ${name} is not stored uncompressed`);
		if (compressedSize !== uncompressedSize)
			throw new Error(`Entry ${name} has mismatched stored sizes`);
		if (data.getUint32(localHeaderOffset, true) !== LOCAL_HEADER_SIGNATURE)
			throw new Error(`Entry ${name} has no local header signature`);
		const localNameLength = data.getUint16(localHeaderOffset + 26, true);
		const localExtraLength = data.getUint16(localHeaderOffset + 28, true);
		const localName = Buffer.from(bytes.subarray(
			localHeaderOffset + 30,
			localHeaderOffset + 30 + localNameLength,
		)).toString('utf8');
		if (localName !== name)
			throw new Error(`Entry ${name} disagrees with its local header name ${localName}`);

		const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;
		const entryBytes = bytes.slice(dataOffset, dataOffset + compressedSize);
		const observedCrc = crc32(Buffer.from(entryBytes));
		if (observedCrc !== expectedCrc)
			throw new Error(`Entry ${name} fails its recorded CRC-32`);

		let dataDescriptor: StoredZipArchiveEntry['dataDescriptor'];
		if ((generalPurposeFlags & 0x08) !== 0) {
			const descriptorOffset = dataOffset + compressedSize;
			if (data.getUint32(descriptorOffset, true) !== DATA_DESCRIPTOR_SIGNATURE)
				throw new Error(`Entry ${name} has no data descriptor signature`);
			dataDescriptor = {
				crc32: data.getUint32(descriptorOffset + 4, true),
				compressedSize: data.getUint32(descriptorOffset + 8, true),
				uncompressedSize: data.getUint32(descriptorOffset + 12, true),
			};
			if (dataDescriptor.crc32 !== expectedCrc || dataDescriptor.uncompressedSize !== uncompressedSize)
				throw new Error(`Entry ${name} disagrees with its data descriptor`);
		}

		entries.push({
			name,
			bytes: entryBytes,
			crc32: expectedCrc,
			compressionMethod,
			generalPurposeFlags,
			dataDescriptor,
		});
	}

	function entry(name: string) {
		const found = entries.find(item => item.name === name);
		if (!found)
			throw new Error(`Archive has no entry named ${name}`);
		return found;
	}

	return {
		entries,
		entryNames: entries.map(item => item.name),
		byteLength: bytes.byteLength,
		entry,
		text: (name: string) => Buffer.from(entry(name).bytes).toString('utf8'),
		json: <T = unknown>(name: string) => JSON.parse(Buffer.from(entry(name).bytes).toString('utf8')) as T,
	};
}

export async function collectStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array<ArrayBuffer>> {
	const chunks: Uint8Array[] = [];
	let byteLength = 0;
	const reader = stream.getReader();
	for (;;) {
		const { done, value } = await reader.read();
		if (done)
			break;
		chunks.push(value);
		byteLength += value.byteLength;
	}
	const bytes = new Uint8Array(byteLength);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}
