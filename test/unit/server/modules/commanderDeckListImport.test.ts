import { describe, expect, it } from 'vitest';
import { importCommanderDeckList } from '~~/server/modules/broadcast-deck-list-import';
import { ARENA_COPY, MOXFIELD_COPY, MTGO_COPY, printingId, resolvingAllCards } from '~~/test/helpers/magicDeckText';

// A Commander Seat's paste (ADR-0087): each of Moxfield's copies offers Ashling as the
// Commander, keeps every other card and drops the Sideboard, counting what went.

async function imported(source: string, unknown: readonly string[] = []) {
	const resolver = resolvingAllCards(unknown);
	return { result: await importCommanderDeckList(source, resolver), resolver };
}

async function document(source: string) {
	const { result } = await imported(source);
	if (!result.ok)
		throw new Error(`Refused: ${JSON.stringify(result.errors)}`);
	return result.document;
}

async function errors(source: string, unknown: readonly string[] = []) {
	const { result } = await imported(source, unknown);
	return result.ok
		? []
		: result.errors;
}

describe('commander Deck List import', () => {
	it('reads Moxfield\'s own copy: the first card offered as the Commander, each card asked for as the printing its line names', async () => {
		const { result, resolver } = await imported(MOXFIELD_COPY);

		expect(resolver.resolve).toHaveBeenCalledWith([
			{ name: 'Ashling, the Limitless', setCode: 'ecc', collectorNumber: '1' },
			{ name: 'Animar, Soul of Elements', setCode: '2x2', collectorNumber: '171' },
			{ name: 'Eirdu, Carrier of Dawn / Isilu, Carrier of Twilight', setCode: 'ecl', collectorNumber: '13' },
			{ name: 'Garruk\'s Uprising', setCode: 'plst', collectorNumber: 'M21-186' },
			{ name: 'Graveshifter', setCode: 'ecl', collectorNumber: '104' },
			{ name: 'Hedge Maze', setCode: 'pmkm', collectorNumber: '262p' },
			{ name: 'Forest', setCode: 'kld', collectorNumber: '264' },
		]);
		expect(result).toEqual({
			ok: true,
			document: expect.objectContaining({
				offeredCommanders: [
					printingId('Ashling, the Limitless', 'ecc', '1'),
				],
				sideboardDropped: 1,
			}),
		});
		expect(result.ok && result.document.entries.map(entry => [entry.quantity, entry.canonicalName])).toEqual([
			[1, 'Ashling, the Limitless'],
			[1, 'Animar, Soul of Elements'],
			[1, 'Eirdu, Carrier of Dawn / Isilu, Carrier of Twilight'],
			[1, 'Garruk\'s Uprising'],
			[1, 'Graveshifter'],
			[1, 'Hedge Maze'],
			[3, 'Forest'],
		]);
	});

	it('reads the Arena copy: About and Name lines ignored, the Commander heading naming the Commander', async () => {
		const deckList = await document(ARENA_COPY);

		expect(deckList.entries.map(entry => entry.canonicalName)).toEqual(['Ashling, the Limitless', 'Ashnod\'s Altar']);
		expect(deckList.offeredCommanders).toEqual([
			printingId('Ashling, the Limitless'),
		]);
		expect(deckList.sideboardDropped).toBe(1);
	});

	it('reads the MTGO and plain-text copy: the card trailing the Sideboard after a blank line offered as the Commander', async () => {
		const deckList = await document(MTGO_COPY);

		expect(deckList.entries.map(entry => entry.canonicalName)).toEqual([
			'Animar, Soul of Elements',
			'Forest',
			'Ashling, the Limitless',
		]);
		expect(deckList.offeredCommanders).toEqual([
			printingId('Ashling, the Limitless'),
		]);
		expect(deckList.sideboardDropped).toBe(1);
	});

	it('never asks the resolver for a Sideboard card, and counts every copy dropped', async () => {
		const { result, resolver } = await imported('1 Animar, Soul of Elements\nSideboard\n2 Arbor Elf\n1 Endurance');

		expect(resolver.resolve).toHaveBeenCalledWith([
			{ name: 'Animar, Soul of Elements', setCode: null, collectorNumber: null },
		]);
		expect(result.ok && result.document.sideboardDropped).toBe(3);
	});

	it.each([
		{
			rule: 'offers both cards under a Commander heading',
			source: 'Commander\n1 Tymna the Weaver\n1 Kraum, Ludevic\'s Opus\nDeck\n1 Sol Ring',
			offered: ['Tymna the Weaver', 'Kraum, Ludevic\'s Opus'],
		},
		{
			rule: 'offers both cards trailing the Sideboard',
			source: '1 Sol Ring\nSIDEBOARD:\n1 Arbor Elf\n\n1 Tymna the Weaver\n1 Kraum, Ludevic\'s Opus',
			offered: ['Tymna the Weaver', 'Kraum, Ludevic\'s Opus'],
		},
		{
			rule: 'keeps the Sideboard open across a blank line that follows its heading',
			source: '1 Sol Ring\nSIDEBOARD:\n\n1 Arbor Elf',
			offered: ['Sol Ring'],
		},
		{
			rule: 'offers the first card where a blank line parts the list with no Sideboard',
			source: '1 Sol Ring\n\n1 Tymna the Weaver',
			offered: ['Sol Ring'],
		},
		{
			rule: 'holds a Commander heading\'s card over one trailing the Sideboard',
			source: 'Commander\n1 Tymna the Weaver\nDeck\n1 Sol Ring\nSideboard\n1 Arbor Elf\n\n1 Command Tower',
			offered: ['Tymna the Weaver'],
		},
	])('$rule', async ({ source, offered }) => {
		expect((await document(source)).offeredCommanders).toEqual(offered.map(name => printingId(name)));
	});

	it.each([
		{
			refusal: 'a Commander heading with no card under it',
			source: 'Commander\nDeck\n1 Sol Ring',
			error: { lineNumber: 1, code: 'NO_COMMANDER', sourceText: 'Commander' },
		},
		{
			refusal: 'a third card under a Commander heading',
			source: 'Commander\n1 Tymna the Weaver\n1 Kraum, Ludevic\'s Opus\n1 Thrasios, Triton Hero\nDeck\n1 Sol Ring',
			error: { lineNumber: 4, code: 'TOO_MANY_COMMANDERS', sourceText: '1 Thrasios, Triton Hero' },
		},
		{
			refusal: 'a third card trailing the Sideboard',
			source: '1 Sol Ring\nSIDEBOARD:\n1 Arbor Elf\n\n1 Tymna the Weaver\n1 Kraum, Ludevic\'s Opus\n1 Thrasios, Triton Hero',
			error: { lineNumber: 7, code: 'TOO_MANY_COMMANDERS', sourceText: '1 Thrasios, Triton Hero' },
		},
		{
			refusal: 'a section it does not read',
			source: '1 Sol Ring\nMaybeboard\n1 Arbor Elf',
			error: { lineNumber: 2, code: 'UNSUPPORTED_SECTION', sourceText: 'Maybeboard' },
		},
		{
			refusal: 'a Companion section, which a Commander deck holds no place for',
			source: '1 Sol Ring\nCompanion\n1 Jegantha, the Wellspring',
			error: { lineNumber: 2, code: 'UNSUPPORTED_SECTION', sourceText: 'Companion' },
		},
		{
			refusal: 'a Sideboard line that breaks the line rules',
			source: '1 Sol Ring\nSIDEBOARD:\n1 Arbor Elf *S*',
			error: { lineNumber: 3, code: 'UNSUPPORTED_SYNTAX', sourceText: '1 Arbor Elf *S*' },
		},
	])('refuses $refusal, naming the line', async ({ source, error }) => {
		expect(await errors(source)).toEqual([
			expect.objectContaining(error),
		]);
	});

	it('refuses an unresolved card and a printing that cannot be found, each naming its line', async () => {
		const refused = await errors(
			'1 Ashling, the Limitless (ECC) 1\n1 Not A Card\n1 Graveshifter (ECL) 9999',
			['Not A Card', 'Graveshifter'],
		);

		expect(refused).toEqual([
			expect.objectContaining({ lineNumber: 2, code: 'UNRESOLVED_CARD', sourceText: '1 Not A Card' }),
			expect.objectContaining({ lineNumber: 3, code: 'INVALID_PRINTING_HINT', sourceText: '1 Graveshifter (ECL) 9999' }),
		]);
	});

	it('refuses a paste whose every card is in the Sideboard', async () => {
		expect(await errors('SIDEBOARD:\n1 Arbor Elf')).toEqual([
			expect.objectContaining({ code: 'EMPTY_DECK_LIST' }),
		]);
	});

	it('adds a card pasted twice into one entry, and offers it once', async () => {
		const deckList = await document('Commander\n1 Tymna the Weaver\nDeck\n1 Tymna the Weaver\n2 Forest (KLD) 264\n1 Forest (KLD) 264');

		expect(deckList.entries.map(entry => [entry.quantity, entry.canonicalName])).toEqual([
			[2, 'Tymna the Weaver'],
			[3, 'Forest'],
		]);
		expect(deckList.offeredCommanders).toEqual([
			printingId('Tymna the Weaver'),
		]);
	});

	it('keeps the blank lines of the pasted text, which say where the Sideboard ends', async () => {
		expect((await document(`\uFEFF\r\n${MTGO_COPY.replaceAll('\n', '\r\n')}\r\n\r\n`)).sourceText).toBe(MTGO_COPY);
	});
});
