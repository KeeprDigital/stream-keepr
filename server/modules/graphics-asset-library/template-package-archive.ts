import type { TemplatePackagePreflightIssue } from '~~/shared/types/templatePackage';
import { TEMPLATE_PACKAGE_LIMITS } from '~~/shared/types/templatePackage';
import { templatePackagePreflightIssue } from './template-package-preflight-issues';

/**
 * A bounded reader for the stored-ZIP container Template Package export writes.
 *
 * It reads the central directory through ranged reads and never materialises the
 * archive, so a 1 GiB package costs a few kilobytes of Worker memory to inspect.
 * Nothing here trusts the sender: the container is re-derived from the published
 * format and every structural rule the envelope promises is proven again, so a
 * package that lies about its own shape is rejected before a byte is validated.
 *
 * The reader is deliberately stricter than the format. Compression, encryption,
 * Zip64, archive comments, directory entries, extra fields, and trailing bytes
 * are all refused rather than interpreted, because each is a way for content the
 * manifest never declared to travel inside a package.
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
const MAXIMUM_ENTRY_NAME_BYTES = 200;

/** Bit 0 is ordinary encryption; bits 6 and 13 are the strong-encryption forms. */
const ENCRYPTION_FLAGS = 0x2041;

/**
 * The largest central directory a package honouring its own entry and name
 * limits can produce. It bounds the one read whose length comes from the
 * archive's own claim rather than from a limit we already enforced.
 */
const MAXIMUM_CENTRAL_DIRECTORY_BYTES
	= TEMPLATE_PACKAGE_LIMITS.maximumEntryCount * (CENTRAL_HEADER_BYTES + MAXIMUM_ENTRY_NAME_BYTES);

/** A safe relative path: the same shape the exporter is allowed to write. */
const SAFE_ENTRY_NAME = /^[\w.-]+(?:\/[\w.-]+)*$/;

/** Raised when staged bytes cannot be read at all, which is retryable. */
export class TemplatePackageArchiveSourceError extends Error {}

export interface TemplatePackageArchiveSource {
	byteLength: number;
	/** Reads exactly `length` bytes at `offset`, or throws a source error. */
	read: (offset: number, length: number) => Promise<Uint8Array>;
}

export interface TemplatePackageArchiveEntry {
	name: string;
	byteLength: number;
	/** Where this entry's stored bytes begin in the archive. */
	dataOffset: number;
	crc32: number;
	/** Whether a trailing data descriptor follows this entry's bytes. */
	hasDataDescriptor: boolean;
}

export type ReadTemplatePackageArchiveOutcome
	= | { outcome: 'read'; entries: readonly TemplatePackageArchiveEntry[] }
		| { outcome: 'rejected'; issues: readonly TemplatePackagePreflightIssue[] };

function view(bytes: Uint8Array) {
	return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function malformed(message: string): TemplatePackagePreflightIssue {
	return templatePackagePreflightIssue('malformed-package-archive', { message });
}

/**
 * Reads exactly the requested window, refusing a request the archive cannot
 * satisfy. A truncated or overlapping read is a malformed container rather than
 * a reason to interpret whatever bytes happened to arrive.
 */
async function readExact(
	source: TemplatePackageArchiveSource,
	offset: number,
	length: number,
): Promise<Uint8Array | undefined> {
	if (
		!Number.isSafeInteger(offset)
		|| !Number.isSafeInteger(length)
		|| offset < 0
		|| length <= 0
		|| offset + length > source.byteLength
	) {
		return undefined;
	}
	const bytes = await source.read(offset, length);
	return bytes.byteLength === length ? bytes : undefined;
}

interface CentralDirectoryEntry {
	name: string;
	crc32: number;
	byteLength: number;
	localHeaderOffset: number;
	flags: number;
	method: number;
	externalAttributes: number;
	compressedSize: number;
}

/**
 * A symbolic or hard link travels in the Unix mode stored in the high half of
 * the external attributes. A package is data-only, so any entry that is not a
 * regular file is refused whatever it points at.
 */
function isLinkEntry(externalAttributes: number): boolean {
	const unixMode = (externalAttributes >>> 16) & 0xFFFF;
	return unixMode !== 0 && (unixMode & 0xF000) === 0xA000;
}

function inspectEntryName(name: string): TemplatePackagePreflightIssue | undefined {
	if (name.length === 0 || new TextEncoder().encode(name).byteLength > MAXIMUM_ENTRY_NAME_BYTES) {
		return templatePackagePreflightIssue('unsafe-package-entry-path', {
			subject: name,
			message: 'Package entry name is empty or longer than a Template Package allows',
		});
	}
	// Traversal is reported on its own so an author can tell a hostile archive
	// from one that merely carries an unusual character.
	if (name.split(/[/\\]/).some(segment => segment === '.' || segment === '..')) {
		return templatePackagePreflightIssue('package-entry-path-traversal', {
			subject: name,
			message: 'Package entry name traverses outside its archive',
		});
	}
	if (!SAFE_ENTRY_NAME.test(name)) {
		return templatePackagePreflightIssue('unsafe-package-entry-path', {
			subject: name,
			// Absolute paths, drive letters, backslashes, directory entries, and
			// control characters all fail the same relative-path rule.
			message: 'Package entry name is not a safe relative path',
		});
	}
	return undefined;
}

function parseCentralDirectory(
	bytes: Uint8Array,
	entryCount: number,
): { entries: CentralDirectoryEntry[] } | { issues: TemplatePackagePreflightIssue[] } {
	const data = view(bytes);
	const entries: CentralDirectoryEntry[] = [];
	let cursor = 0;
	for (let index = 0; index < entryCount; index += 1) {
		if (cursor + CENTRAL_HEADER_BYTES > bytes.byteLength)
			return { issues: [malformed(`Central directory ends before entry ${index + 1}`)] };
		if (data.getUint32(cursor, true) !== CENTRAL_HEADER_SIGNATURE)
			return { issues: [malformed(`Central directory entry ${index + 1} has no header signature`)] };
		const flags = data.getUint16(cursor + 8, true);
		const method = data.getUint16(cursor + 10, true);
		const crc32 = data.getUint32(cursor + 16, true);
		const compressedSize = data.getUint32(cursor + 20, true);
		const byteLength = data.getUint32(cursor + 24, true);
		const nameLength = data.getUint16(cursor + 28, true);
		const extraLength = data.getUint16(cursor + 30, true);
		const commentLength = data.getUint16(cursor + 32, true);
		const diskStart = data.getUint16(cursor + 34, true);
		const externalAttributes = data.getUint32(cursor + 38, true);
		const localHeaderOffset = data.getUint32(cursor + 42, true);
		const nameEnd = cursor + CENTRAL_HEADER_BYTES + nameLength;
		if (nameEnd > bytes.byteLength)
			return { issues: [malformed(`Central directory entry ${index + 1} declares a name beyond the directory`)] };
		if (diskStart !== 0)
			return { issues: [malformed(`Package entry ${index + 1} claims to live on another disk`)] };
		// An extra field or comment is space the manifest never declared, and the
		// exporter emits neither, so their presence is refused rather than skipped.
		if (extraLength !== 0 || commentLength !== 0)
			return { issues: [malformed(`Package entry ${index + 1} carries an undeclared extra field or comment`)] };
		const name = new TextDecoder('utf-8', { fatal: false })
			.decode(bytes.subarray(cursor + CENTRAL_HEADER_BYTES, nameEnd));
		entries.push({
			name,
			crc32,
			byteLength,
			localHeaderOffset,
			flags,
			method,
			externalAttributes,
			compressedSize,
		});
		cursor = nameEnd;
	}
	if (cursor !== bytes.byteLength)
		return { issues: [malformed('Central directory carries bytes beyond its declared entries')] };
	return { entries };
}

/**
 * Proves the container is a safe, fully declared, stored archive and returns
 * where each entry's bytes live. Every structural problem found is returned
 * together, so one report can carry them all.
 */
export async function readTemplatePackageArchive(
	source: TemplatePackageArchiveSource,
): Promise<ReadTemplatePackageArchiveOutcome> {
	if (source.byteLength > TEMPLATE_PACKAGE_LIMITS.maximumArchiveByteLength) {
		return {
			outcome: 'rejected',
			issues: [templatePackagePreflightIssue('package-archive-limit-exceeded', {
				message: `The received archive is ${source.byteLength} bytes, beyond the ${TEMPLATE_PACKAGE_LIMITS.maximumArchiveByteLength}-byte limit`,
			})],
		};
	}
	if (source.byteLength < END_OF_CENTRAL_DIRECTORY_BYTES)
		return { outcome: 'rejected', issues: [malformed('The received archive is too short to be a package')] };

	// The end record must be the final 22 bytes. Allowing an archive comment
	// would allow arbitrary trailing content no manifest ever declared.
	const endRecord = await readExact(
		source,
		source.byteLength - END_OF_CENTRAL_DIRECTORY_BYTES,
		END_OF_CENTRAL_DIRECTORY_BYTES,
	);
	if (!endRecord)
		return { outcome: 'rejected', issues: [malformed('The archive has no readable end-of-central-directory record')] };
	const endView = view(endRecord);
	if (endView.getUint32(0, true) !== END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
		return {
			outcome: 'rejected',
			issues: [malformed('The archive does not end with its central directory record')],
		};
	}
	if (
		endView.getUint16(4, true) !== 0
		|| endView.getUint16(6, true) !== 0
		|| endView.getUint16(20, true) !== 0
	) {
		return {
			outcome: 'rejected',
			issues: [malformed('The archive is split across disks or carries a comment')],
		};
	}
	const entryCount = endView.getUint16(8, true);
	if (entryCount !== endView.getUint16(10, true))
		return { outcome: 'rejected', issues: [malformed('The archive disagrees with itself about how many entries it holds')] };
	if (entryCount === 0)
		return { outcome: 'rejected', issues: [malformed('The archive declares no entries')] };
	if (entryCount > TEMPLATE_PACKAGE_LIMITS.maximumEntryCount) {
		return {
			outcome: 'rejected',
			issues: [templatePackagePreflightIssue('package-entry-limit-exceeded', {
				message: `The archive declares ${entryCount} entries, beyond the ${TEMPLATE_PACKAGE_LIMITS.maximumEntryCount}-entry limit`,
			})],
		};
	}
	const centralDirectoryByteLength = endView.getUint32(12, true);
	const centralDirectoryOffset = endView.getUint32(16, true);
	if (
		centralDirectoryByteLength > MAXIMUM_CENTRAL_DIRECTORY_BYTES
		|| centralDirectoryOffset + centralDirectoryByteLength
		!== source.byteLength - END_OF_CENTRAL_DIRECTORY_BYTES
	) {
		return {
			outcome: 'rejected',
			issues: [malformed('The central directory does not end where the end record begins')],
		};
	}
	const centralDirectory = await readExact(
		source,
		centralDirectoryOffset,
		centralDirectoryByteLength,
	);
	if (!centralDirectory)
		return { outcome: 'rejected', issues: [malformed('The central directory could not be read')] };

	const parsed = parseCentralDirectory(centralDirectory, entryCount);
	if ('issues' in parsed)
		return { outcome: 'rejected', issues: parsed.issues };

	const issues: TemplatePackagePreflightIssue[] = [];
	const seenNames = new Map<string, string>();
	for (const entry of parsed.entries) {
		const nameIssue = inspectEntryName(entry.name);
		if (nameIssue)
			issues.push(nameIssue);
		// Case collisions are refused because a receiver that resolved them by
		// filesystem rules would install different content on different platforms.
		const collisionKey = entry.name.toLocaleLowerCase();
		const collided = seenNames.get(collisionKey);
		if (collided !== undefined) {
			issues.push(templatePackagePreflightIssue('duplicate-package-entry-path', {
				subject: entry.name,
				message: collided === entry.name
					? 'The archive declares the same entry path twice'
					: `Package entry name collides with "${collided}" when compared case-insensitively`,
			}));
		}
		else {
			seenNames.set(collisionKey, entry.name);
		}
		if ((entry.flags & ENCRYPTION_FLAGS) !== 0) {
			issues.push(templatePackagePreflightIssue('encrypted-package-entry', {
				subject: entry.name,
				message: 'Package entry is encrypted',
			}));
		}
		if (entry.method !== STORED_METHOD) {
			issues.push(templatePackagePreflightIssue('compressed-package-entry', {
				subject: entry.name,
				message: 'Package entry is compressed rather than stored',
			}));
		}
		if (isLinkEntry(entry.externalAttributes)) {
			issues.push(templatePackagePreflightIssue('package-entry-link', {
				subject: entry.name,
				message: 'Package entry is a link rather than a regular file',
			}));
		}
		if (entry.compressedSize !== entry.byteLength) {
			issues.push(templatePackagePreflightIssue('inconsistent-package-entry-size', {
				subject: entry.name,
				message: `Package entry declares ${entry.compressedSize} stored bytes but ${entry.byteLength} expanded bytes`,
			}));
		}
	}

	const expandedByteLength = parsed.entries
		.reduce((total, entry) => total + entry.byteLength, 0);
	if (expandedByteLength > TEMPLATE_PACKAGE_LIMITS.maximumExpandedByteLength) {
		issues.push(templatePackagePreflightIssue('package-expanded-limit-exceeded', {
			message: `The archive would expand to ${expandedByteLength} bytes, beyond the ${TEMPLATE_PACKAGE_LIMITS.maximumExpandedByteLength}-byte limit`,
		}));
	}
	if (issues.length > 0)
		return { outcome: 'rejected', issues };

	// Local headers are only worth reading once the directory itself is sound.
	const entries: TemplatePackageArchiveEntry[] = [];
	for (const entry of parsed.entries) {
		const header = await readExact(source, entry.localHeaderOffset, LOCAL_HEADER_BYTES);
		if (!header) {
			issues.push(malformed(`Package entry "${entry.name}" has no readable local header`));
			continue;
		}
		const headerView = view(header);
		if (headerView.getUint32(0, true) !== LOCAL_HEADER_SIGNATURE) {
			issues.push(malformed(`Package entry "${entry.name}" has no local header signature`));
			continue;
		}
		if (
			headerView.getUint16(6, true) !== entry.flags
			|| headerView.getUint16(8, true) !== entry.method
		) {
			issues.push(malformed(`Package entry "${entry.name}" disagrees with its local header`));
			continue;
		}
		const localNameLength = headerView.getUint16(26, true);
		const localExtraLength = headerView.getUint16(28, true);
		if (localExtraLength !== 0) {
			issues.push(malformed(`Package entry "${entry.name}" carries an undeclared local extra field`));
			continue;
		}
		const localName = localNameLength === 0
			? undefined
			: await readExact(source, entry.localHeaderOffset + LOCAL_HEADER_BYTES, localNameLength);
		if (!localName || new TextDecoder().decode(localName) !== entry.name) {
			issues.push(malformed(`Package entry "${entry.name}" disagrees with its local header name`));
			continue;
		}
		const dataOffset = entry.localHeaderOffset + LOCAL_HEADER_BYTES + localNameLength;
		if (dataOffset + entry.byteLength > centralDirectoryOffset) {
			issues.push(malformed(`Package entry "${entry.name}" declares bytes beyond the archive body`));
			continue;
		}
		// Bit 3 moves the CRC and sizes into a descriptor after the entry's bytes.
		// Either form is conforming, so which one is used decides where the next
		// entry may legitimately begin.
		const hasDataDescriptor = (entry.flags & 0x08) !== 0;
		if (hasDataDescriptor) {
			const descriptor = await readExact(
				source,
				dataOffset + entry.byteLength,
				DATA_DESCRIPTOR_BYTES,
			);
			const descriptorView = descriptor && view(descriptor);
			if (
				!descriptorView
				|| descriptorView.getUint32(0, true) !== DATA_DESCRIPTOR_SIGNATURE
				|| descriptorView.getUint32(4, true) !== entry.crc32
				|| descriptorView.getUint32(8, true) !== entry.byteLength
				|| descriptorView.getUint32(12, true) !== entry.byteLength
			) {
				issues.push(malformed(`Package entry "${entry.name}" disagrees with its data descriptor`));
				continue;
			}
		}
		entries.push({
			name: entry.name,
			byteLength: entry.byteLength,
			dataOffset,
			crc32: entry.crc32,
			hasDataDescriptor,
		});
	}
	if (issues.length > 0)
		return { outcome: 'rejected', issues };

	// Overlapping or gapped entries would let bytes belong to two entries at once,
	// or hide bytes no entry declares. Both are undeclared content.
	const ordered = [...entries].sort((left, right) => left.dataOffset - right.dataOffset);
	let expectedOffset = 0;
	for (const entry of ordered) {
		const headerByteLength = LOCAL_HEADER_BYTES + new TextEncoder().encode(entry.name).byteLength;
		if (entry.dataOffset - headerByteLength !== expectedOffset) {
			return {
				outcome: 'rejected',
				issues: [templatePackagePreflightIssue('undeclared-package-entry', {
					subject: entry.name,
					message: 'The archive carries bytes between entries that no entry declares',
				})],
			};
		}
		expectedOffset = entry.dataOffset
			+ entry.byteLength
			+ (entry.hasDataDescriptor ? DATA_DESCRIPTOR_BYTES : 0);
	}
	if (expectedOffset !== centralDirectoryOffset) {
		return {
			outcome: 'rejected',
			issues: [templatePackagePreflightIssue('undeclared-package-entry', {
				subject: ordered.at(-1)?.name,
				message: 'The archive carries bytes before its central directory that no entry declares',
			})],
		};
	}

	return { outcome: 'read', entries };
}
