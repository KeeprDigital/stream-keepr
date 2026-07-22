export function normalizeImportedCardName(name: string): string {
	return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function normalizeImportedSetCode(setCode: string | null | undefined): string {
	return setCode?.trim().toLowerCase() ?? '';
}
