import type { PastedDeckListLine } from '~~/server/modules/op-deck-list-write/paste';
import { parseOpCardNumber } from '~~/shared/utils/card/op';

/**
 * Reading a Bandai TCG+ deck list export (ADR-0074): a UTF-8 CSV, often with a
 * BOM, under Japanese headers, one row per card per entry. Its card fields are
 * not used (card data comes from bandai-keepr), nor is its status column.
 */

/** The headers the import reads, by what each holds. Columns are found by header, not position. */
const COLUMNS = {
	memberNumber: '会員番号',
	nickname: 'ニックネーム',
	cardNumber: 'カード番号',
	quantity: '枚数',
	category: '種類',
} as const;

/** One entry in the export: a Player's member number, Nickname, and Deck List. */
export interface TcgPlusExportEntry {
	/** The Bandai member number, kept as written: leading zeros are part of it. */
	memberNumber: string;
	nickname: string;
	/** The card number of the entry's first Leader row; `null` for an entry with none. */
	leaderNumber: string | null;
	/** Every card, Leaders included, in first-row order; a number on several rows (printings) is one entry. */
	entries: PastedDeckListLine[];
}

export class TcgPlusExportError extends Error {
	readonly code = 'TCGPLUS_EXPORT_INVALID';
	constructor(message: string) {
		super(message);
		this.name = 'TcgPlusExportError';
	}
}

/** RFC 4180 records: quoted fields may hold commas, doubled quotes and line breaks. */
function csvRecords(text: string): string[][] {
	const records: string[][] = [];
	let record: string[] = [];
	let value = '';
	let quoted = false;
	for (let index = 0; index < text.length; index++) {
		const char = text[index]!;
		if (quoted) {
			if (char === '"' && text[index + 1] === '"') {
				value += '"';
				index++;
			}
			else if (char === '"') {
				quoted = false;
			}
			else {
				value += char;
			}
		}
		else if (char === '"') {
			quoted = true;
		}
		else if (char === ',') {
			record.push(value);
			value = '';
		}
		else if (char === '\n' || char === '\r') {
			if (char === '\r' && text[index + 1] === '\n')
				index++;
			record.push(value);
			records.push(record);
			record = [];
			value = '';
		}
		else {
			value += char;
		}
	}
	if (quoted)
		throw new TcgPlusExportError('The file ends inside a quoted field.');
	if (value !== '' || record.length > 0) {
		record.push(value);
		records.push(record);
	}
	return records.filter(row => row.some(cell => cell.trim() !== ''));
}

/** The export's entries, one per member number, in the order the file first names them. */
export function parseTcgPlusExport(text: string): TcgPlusExportEntry[] {
	const [header, ...rows] = csvRecords(text.replace(/^\uFEFF/, ''));
	const headers = (header ?? []).map(cell => cell.trim());
	const missing = Object.values(COLUMNS).filter(name => !headers.includes(name));
	if (missing.length > 0)
		throw new TcgPlusExportError(`This is not a TCG+ deck list export: it has no ${missing.join(', ')} column.`);
	const column = Object.fromEntries(Object.entries(COLUMNS).map(([key, name]) => [
		key,
		headers.indexOf(name),
	])) as Record<keyof typeof COLUMNS, number>;

	const byMember = new Map<string, TcgPlusExportEntry & { byNumber: Map<string, PastedDeckListLine> }>();
	rows.forEach((row, index) => {
		const line = index + 2;
		const cell = (key: keyof typeof COLUMNS) => (row[column[key]] ?? '').trim();
		const memberNumber = cell('memberNumber');
		const number = parseOpCardNumber(cell('cardNumber'));
		const quantity = Number(cell('quantity'));
		if (!memberNumber)
			throw new TcgPlusExportError(`Line ${line} has no member number.`);
		if (!number)
			throw new TcgPlusExportError(`Line ${line} has no readable card number.`);
		if (!Number.isInteger(quantity) || quantity < 1)
			throw new TcgPlusExportError(`Line ${line} has no readable quantity.`);

		let entry = byMember.get(memberNumber);
		if (!entry) {
			entry = {
				memberNumber,
				nickname: cell('nickname'),
				leaderNumber: null,
				entries: [],
				byNumber: new Map(),
			};
			byMember.set(memberNumber, entry);
		}
		if (entry.leaderNumber === null && cell('category').toLowerCase() === 'leader')
			entry.leaderNumber = number;
		const held = entry.byNumber.get(number);
		if (held) {
			held.quantity += quantity;
		}
		else {
			const added = { number, quantity };
			entry.byNumber.set(number, added);
			entry.entries.push(added);
		}
	});
	if (byMember.size === 0)
		throw new TcgPlusExportError('The export holds no players.');
	return [
		...byMember.values(),
	].map(({ byNumber: _byNumber, ...entry }) => entry);
}
