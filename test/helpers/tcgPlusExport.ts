/**
 * Synthetic Bandai TCG+ deck list exports, in the export's exact layout: the
 * Japanese header, one row per card per entry, the ignored status column, and
 * the counter value in the 特徴 column. Real exports hold personal data, so
 * fixtures are built here, never copied.
 */

export const TCGPLUS_EXPORT_HEADER = 'チームID,会員番号,ニックネーム,チームステータス,カード番号,カード名,枚数,色,種類,特徴,属性';

/** A card row's number, quantity and, optionally, the name the export gives it. */
export type TcgPlusExportCard = readonly [number: string, quantity: number, name?: string];

export interface TcgPlusExportPlayer {
	memberNumber: string;
	nickname: string;
	/** The Leader row's card number; `null` exports no Leader row. */
	leader: string | null;
	cards: readonly TcgPlusExportCard[];
	/** Where the Leader row sits among the entry's rows; the export puts it anywhere. */
	leaderAt?: 'first' | 'last' | number;
	/** Card numbers exported over two rows, as two printings the export cannot tell apart. */
	splitPrintings?: readonly string[];
	status?: '10' | '11';
}

export interface TcgPlusExportOptions {
	bom?: boolean;
	lineEnding?: '\n' | '\r\n';
}

function field(value: string): string {
	return /[",\r\n]/.test(value)
		? `"${value.replaceAll('"', '""')}"`
		: value;
}

/** `count` distinct cards of a set at `copies` each, numbered from 030 so none is a Leader's number. */
export function tcgPlusDeck(set: string, count = 12, copies = 4): TcgPlusExportCard[] {
	return Array.from({ length: count }, (_, index) => [`${set}-${String(index + 30).padStart(3, '0')}`, copies] as const);
}

/** The export text for `players`, a UTF-8 BOM first unless `bom: false`. */
export function tcgPlusExport(players: readonly TcgPlusExportPlayer[], { bom = true, lineEnding = '\n' }: TcgPlusExportOptions = {}): string {
	const lines = [TCGPLUS_EXPORT_HEADER];
	players.forEach((player, index) => {
		const teamId = String(100 + index);
		const row = (number: string, quantity: number, name: string, category: string) => [
			teamId,
			player.memberNumber,
			player.nickname,
			player.status ?? '10',
			number,
			name,
			String(quantity),
			'Red',
			category,
			category === 'Leader'
				? ''
				: '1000',
			number === 'OP13-079'
				? '?'
				: 'Slash',
		].map(field).join(',');

		const rows = player.cards.flatMap(([number, quantity, name = `Card ${number}`]) =>
			player.splitPrintings?.includes(number) && quantity > 1
				? [
						row(number, 1, name, 'Character'),
						row(number, quantity - 1, `${name} (Parallel)`, 'Character'),
					]
				: [
						row(number, quantity, name, 'Character'),
					]);
		if (player.leader !== null) {
			const leaderRow = row(player.leader, 1, `Leader ${player.leader}`, 'Leader');
			const at = player.leaderAt === 'last'
				? rows.length
				: player.leaderAt === undefined || player.leaderAt === 'first'
					? 0
					: player.leaderAt;
			rows.splice(at, 0, leaderRow);
		}
		lines.push(...rows);
	});
	return `${bom
		? '﻿'
		: ''}${lines.join(lineEnding)}${lineEnding}`;
}
