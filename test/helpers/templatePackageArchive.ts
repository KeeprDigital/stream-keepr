import type { TemplatePackageManifest } from '../../shared/types/templatePackage';
import { Buffer } from 'node:buffer';
import { crc32 } from 'node:zlib';
import {
	TEMPLATE_PACKAGE_MANIFEST_ENTRY,
	TEMPLATE_PACKAGE_TEMPLATE_ENTRY,
} from '../../shared/types/templatePackage';
import { readStoredZipArchive } from './storedZipArchive';

/**
 * A deliberately permissive stored-ZIP writer for Template Package preflight
 * fixtures.
 *
 * Production export can only emit safe archives — it validates entry names and
 * refuses anything else — so preflight's rejection rules cannot be exercised
 * through it. This writer emits whatever a test asks for, including the unsafe
 * paths, links, encryption flags, compression methods, size disagreements, and
 * undeclared trailing bytes a hostile or corrupted sender would produce.
 */

const LOCAL_HEADER_SIGNATURE = 0x04034B50;
const CENTRAL_HEADER_SIGNATURE = 0x02014B50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054B50;
const DATA_DESCRIPTOR_SIGNATURE = 0x08074B50;

const LOCAL_HEADER_BYTES = 30;
const CENTRAL_HEADER_BYTES = 46;
const END_OF_CENTRAL_DIRECTORY_BYTES = 22;

/** Bit 3 puts sizes in a trailing descriptor; bit 11 declares UTF-8 names. */
const STREAMING_UTF8_FLAGS = 0x0808;

export interface TestArchiveEntry {
	name: string;
	bytes: Uint8Array;
	/** Written to the local header instead of `name`, to disagree with it. */
	localName?: string;
	compressionMethod?: number;
	generalPurposeFlags?: number;
	/** The Unix mode goes in the high half; `0xA1FF0000` marks a symlink. */
	externalAttributes?: number;
	/** Overrides the size the central directory records for this entry. */
	declaredUncompressedSize?: number;
	declaredCompressedSize?: number;
}

export interface TestArchiveOptions {
	/** Appended after the end-of-central-directory record. */
	trailingBytes?: Uint8Array;
	/** Overrides the entry count the end record claims. */
	declaredEntryCount?: number;
}

function encodeName(name: string): Uint8Array {
	return new TextEncoder().encode(name);
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
	const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

export function writeTestArchive(
	entries: readonly TestArchiveEntry[],
	options: TestArchiveOptions = {},
): Uint8Array {
	const body: Uint8Array[] = [];
	const directory: Uint8Array[] = [];
	let offset = 0;

	for (const entry of entries) {
		const flags = entry.generalPurposeFlags ?? STREAMING_UTF8_FLAGS;
		const method = entry.compressionMethod ?? 0;
		const checksum = crc32(Buffer.from(entry.bytes)) >>> 0;
		const compressedSize = entry.declaredCompressedSize ?? entry.bytes.byteLength;
		const uncompressedSize = entry.declaredUncompressedSize ?? entry.bytes.byteLength;
		const localName = encodeName(entry.localName ?? entry.name);
		const centralName = encodeName(entry.name);
		const localHeaderOffset = offset;

		const header = new Uint8Array(LOCAL_HEADER_BYTES + localName.byteLength);
		const headerView = new DataView(header.buffer);
		headerView.setUint32(0, LOCAL_HEADER_SIGNATURE, true);
		headerView.setUint16(4, 20, true);
		headerView.setUint16(6, flags, true);
		headerView.setUint16(8, method, true);
		headerView.setUint16(12, 0x0021, true);
		if ((flags & 0x08) === 0) {
			headerView.setUint32(14, checksum, true);
			headerView.setUint32(18, compressedSize, true);
			headerView.setUint32(22, uncompressedSize, true);
		}
		headerView.setUint16(26, localName.byteLength, true);
		header.set(localName, LOCAL_HEADER_BYTES);
		body.push(header, entry.bytes);
		offset += header.byteLength + entry.bytes.byteLength;

		if ((flags & 0x08) !== 0) {
			const descriptor = new Uint8Array(16);
			const descriptorView = new DataView(descriptor.buffer);
			descriptorView.setUint32(0, DATA_DESCRIPTOR_SIGNATURE, true);
			descriptorView.setUint32(4, checksum, true);
			descriptorView.setUint32(8, compressedSize, true);
			descriptorView.setUint32(12, uncompressedSize, true);
			body.push(descriptor);
			offset += descriptor.byteLength;
		}

		const central = new Uint8Array(CENTRAL_HEADER_BYTES + centralName.byteLength);
		const centralView = new DataView(central.buffer);
		centralView.setUint32(0, CENTRAL_HEADER_SIGNATURE, true);
		centralView.setUint16(4, 20, true);
		centralView.setUint16(6, 20, true);
		centralView.setUint16(8, flags, true);
		centralView.setUint16(10, method, true);
		centralView.setUint16(14, 0x0021, true);
		centralView.setUint32(16, checksum, true);
		centralView.setUint32(20, compressedSize, true);
		centralView.setUint32(24, uncompressedSize, true);
		centralView.setUint16(28, centralName.byteLength, true);
		centralView.setUint32(38, entry.externalAttributes ?? 0, true);
		centralView.setUint32(42, localHeaderOffset, true);
		central.set(centralName, CENTRAL_HEADER_BYTES);
		directory.push(central);
	}

	const centralDirectoryOffset = offset;
	const centralDirectory = concat(directory);
	const endRecord = new Uint8Array(END_OF_CENTRAL_DIRECTORY_BYTES);
	const endView = new DataView(endRecord.buffer);
	const entryCount = options.declaredEntryCount ?? entries.length;
	endView.setUint32(0, END_OF_CENTRAL_DIRECTORY_SIGNATURE, true);
	endView.setUint16(8, entryCount, true);
	endView.setUint16(10, entryCount, true);
	endView.setUint32(12, centralDirectory.byteLength, true);
	endView.setUint32(16, centralDirectoryOffset, true);

	return concat([
		...body,
		centralDirectory,
		endRecord,
		...(options.trailingBytes ? [options.trailingBytes] : []),
	]);
}

export interface TemplatePackageParts {
	manifest: TemplatePackageManifest;
	template: unknown;
	/** Every content entry, by archive entry name. */
	contents: { name: string; bytes: Uint8Array }[];
}

/** Reads a real exported package back into the parts a test can rewrite. */
export function readTemplatePackageParts(archive: Uint8Array): TemplatePackageParts {
	const read = readStoredZipArchive(archive);
	return {
		manifest: read.json<TemplatePackageManifest>(TEMPLATE_PACKAGE_MANIFEST_ENTRY),
		template: read.json(TEMPLATE_PACKAGE_TEMPLATE_ENTRY),
		contents: read.entries
			.filter(entry =>
				entry.name !== TEMPLATE_PACKAGE_MANIFEST_ENTRY
				&& entry.name !== TEMPLATE_PACKAGE_TEMPLATE_ENTRY)
			.map(entry => ({ name: entry.name, bytes: entry.bytes })),
	};
}

function encodeJson(value: unknown): Uint8Array {
	return new TextEncoder().encode(JSON.stringify(value, null, '\t'));
}

/**
 * Rebuilds a package from its parts, keeping the manifest's own account of its
 * expanded size honest so a rewrite that only meant to change one field does not
 * accidentally fail the totals check as well.
 */
export function writeTemplatePackage(
	parts: TemplatePackageParts,
	options: TestArchiveOptions & { extraEntries?: TestArchiveEntry[] } = {},
): Uint8Array {
	const templateBytes = encodeJson(parts.template);
	const contentByteLength = parts.contents
		.reduce((total, content) => total + content.bytes.byteLength, 0);
	const manifest = structuredClone(parts.manifest) as TemplatePackageManifest;
	let manifestBytes = encodeJson(manifest);
	for (let attempt = 0; attempt < 8; attempt += 1) {
		const expanded = manifestBytes.byteLength + templateBytes.byteLength + contentByteLength;
		if (manifest.totals.expandedByteLength === expanded)
			break;
		(manifest.totals as { expandedByteLength: number }).expandedByteLength = expanded;
		manifestBytes = encodeJson(manifest);
	}
	const { extraEntries = [], ...archiveOptions } = options;
	return writeTestArchive([
		{ name: TEMPLATE_PACKAGE_MANIFEST_ENTRY, bytes: manifestBytes },
		{ name: TEMPLATE_PACKAGE_TEMPLATE_ENTRY, bytes: templateBytes },
		...parts.contents.map(content => ({ name: content.name, bytes: content.bytes })),
		...extraEntries,
	], archiveOptions);
}
