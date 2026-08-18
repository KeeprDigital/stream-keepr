export const SUPPORTED_SOCIAL_NETWORK_KEYS = [
	'twitch',
	'youtube',
	'x',
	'instagram',
	'tiktok',
	'bluesky',
] as const;

export type SupportedSocialNetwork = typeof SUPPORTED_SOCIAL_NETWORK_KEYS[number];

export type SocialProfiles = Partial<Record<SupportedSocialNetwork, string>>;

interface SupportedSocialNetworkDefinition {
	key: SupportedSocialNetwork;
	label: string;
	/** Iconify identity for the application-owned vector icon. */
	icon: string;
	/** Human-readable forms recognized by the local normalizer. */
	profileUrlForms: readonly string[];
	canonicalProfileUrl: (handle: string) => string;
}

function profileUrl(baseUrl: string, handle: string) {
	return `${baseUrl}${encodeURIComponent(handle)}`;
}

/**
 * The application-owned ordered Supported Social Network catalog.
 *
 * Order is presentation behaviour: every consumer iterates this array rather
 * than sorting labels or object keys. Icons are semantic vector identities,
 * never Event-owned Graphic Assets.
 */
export const SUPPORTED_SOCIAL_NETWORKS = [
	{
		key: 'twitch',
		label: 'Twitch',
		icon: 'i-simple-icons-twitch',
		profileUrlForms: ['twitch.tv/{handle}'],
		canonicalProfileUrl: (handle: string) => profileUrl('https://www.twitch.tv/', handle),
	},
	{
		key: 'youtube',
		label: 'YouTube',
		icon: 'i-simple-icons-youtube',
		profileUrlForms: ['youtube.com/@{handle}'],
		canonicalProfileUrl: (handle: string) => profileUrl('https://www.youtube.com/@', handle),
	},
	{
		key: 'x',
		label: 'X',
		icon: 'i-simple-icons-x',
		profileUrlForms: ['x.com/{handle}', 'twitter.com/{handle}'],
		canonicalProfileUrl: (handle: string) => profileUrl('https://x.com/', handle),
	},
	{
		key: 'instagram',
		label: 'Instagram',
		icon: 'i-simple-icons-instagram',
		profileUrlForms: ['instagram.com/{handle}'],
		canonicalProfileUrl: (handle: string) => profileUrl('https://www.instagram.com/', handle),
	},
	{
		key: 'tiktok',
		label: 'TikTok',
		icon: 'i-simple-icons-tiktok',
		profileUrlForms: ['tiktok.com/@{handle}'],
		canonicalProfileUrl: (handle: string) => profileUrl('https://www.tiktok.com/@', handle),
	},
	{
		key: 'bluesky',
		label: 'Bluesky',
		icon: 'i-simple-icons-bluesky',
		profileUrlForms: ['bsky.app/profile/{handle}'],
		canonicalProfileUrl: (handle: string) => profileUrl('https://bsky.app/profile/', handle),
	},
] as const satisfies readonly SupportedSocialNetworkDefinition[];

export const SUPPORTED_SOCIAL_NETWORK_BY_KEY = Object.fromEntries(
	SUPPORTED_SOCIAL_NETWORKS.map(network => [network.key, network]),
) as { [K in SupportedSocialNetwork]: Extract<typeof SUPPORTED_SOCIAL_NETWORKS[number], { key: K }> };

const HOST_NETWORKS: Readonly<Record<string, SupportedSocialNetwork>> = {
	'twitch.tv': 'twitch',
	'www.twitch.tv': 'twitch',
	'm.twitch.tv': 'twitch',
	'youtube.com': 'youtube',
	'www.youtube.com': 'youtube',
	'm.youtube.com': 'youtube',
	'x.com': 'x',
	'www.x.com': 'x',
	'twitter.com': 'x',
	'www.twitter.com': 'x',
	'mobile.twitter.com': 'x',
	'instagram.com': 'instagram',
	'www.instagram.com': 'instagram',
	'tiktok.com': 'tiktok',
	'www.tiktok.com': 'tiktok',
	'm.tiktok.com': 'tiktok',
	'bsky.app': 'bluesky',
	'www.bsky.app': 'bluesky',
};

export class SocialProfileInputError extends Error {
	readonly network: SupportedSocialNetwork;

	constructor(
		network: SupportedSocialNetwork,
		message: string,
	) {
		super(message);
		this.name = 'SocialProfileInputError';
		this.network = network;
	}
}

function inputError(network: SupportedSocialNetwork) {
	return new SocialProfileInputError(
		network,
		`Enter a valid ${SUPPORTED_SOCIAL_NETWORK_BY_KEY[network].label} handle or profile URL`,
	);
}

function looksLikeUrl(value: string) {
	if (/^[a-z][a-z\d+.-]*:\/\//i.test(value) || /^www\./i.test(value))
		return true;

	const possibleHost = value.split('/')[0]?.toLowerCase();
	return possibleHost !== undefined && Object.hasOwn(HOST_NETWORKS, possibleHost);
}

function decodedPathSegments(url: URL, network: SupportedSocialNetwork) {
	if (url.search || url.hash || url.username || url.password || url.port)
		throw inputError(network);

	try {
		return url.pathname
			.split('/')
			.filter(Boolean)
			.map(segment => decodeURIComponent(segment));
	}
	catch {
		throw inputError(network);
	}
}

function normalizeHandle(network: SupportedSocialNetwork, handle: string | undefined) {
	const normalized = handle?.startsWith('@') ? handle.slice(1) : handle;
	if (!normalized || /\s/.test(normalized))
		throw inputError(network);

	return normalized;
}

function handleFromProfileUrl(network: SupportedSocialNetwork, value: string) {
	let url: URL;
	try {
		url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`);
	}
	catch {
		throw inputError(network);
	}

	if (url.protocol !== 'http:' && url.protocol !== 'https:')
		throw inputError(network);

	const urlNetwork = HOST_NETWORKS[url.hostname.toLowerCase()];
	if (urlNetwork !== network)
		throw inputError(network);

	const segments = decodedPathSegments(url, network);
	let handle: string | undefined;

	switch (network) {
		case 'youtube':
		case 'tiktok':
			handle = segments.length === 1 && segments[0]?.startsWith('@')
				? segments[0].slice(1)
				: undefined;
			break;
		case 'bluesky':
			handle = segments.length === 2 && segments[0] === 'profile'
				? segments[1]
				: undefined;
			break;
		default:
			handle = segments.length === 1 ? segments[0] : undefined;
	}

	return normalizeHandle(network, handle);
}

/**
 * Normalizes one optional Social Profile input without imposing a remote
 * network's mutable username rules or performing an account lookup.
 */
export function normalizeSocialProfileInput(
	network: SupportedSocialNetwork,
	input: string,
): string | undefined {
	const trimmed = input.trim();
	if (!trimmed)
		return undefined;

	if (looksLikeUrl(trimmed))
		return handleFromProfileUrl(network, trimmed);

	return normalizeHandle(network, trimmed);
}

export function canonicalSocialProfileUrl(network: SupportedSocialNetwork, handle: string) {
	return SUPPORTED_SOCIAL_NETWORK_BY_KEY[network].canonicalProfileUrl(handle);
}
