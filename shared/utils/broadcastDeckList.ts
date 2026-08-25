export function cleanBroadcastDeckListName(name: string): string {
	return name.trim().replace(/\s+/g, ' ');
}

export function normalizeBroadcastDeckListName(name: string): string {
	return cleanBroadcastDeckListName(name).normalize('NFKC').toLocaleLowerCase('en-US');
}
