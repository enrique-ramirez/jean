// beefweb sends `Cache-Control: max-age=3, must-revalidate` on every response, one filter for the
// whole API, so a sleeve is cached as briefly as a status poll and nothing on the client can change
// that. Cache Storage is the way out: it ignores caching headers entirely.

const CACHE = "jean-artwork-v1";

const BUDGET_BYTES = 500 * 1024 * 1024;

// `caches` is secure-context only, so an install served over plain HTTP has none of this and must go
// on working. Nothing here throws.
export const canCacheArtwork = () =>
	typeof caches !== "undefined" && typeof Response !== "undefined";

const sizeOf = (response: Response) =>
	Number(response.headers.get("content-length")) || 0;

let heldBytes: number | null = null;

// Reading the total, adding to it and evicting against it is a read-modify-write, so stores are
// serialised: two covers arriving together would each evict against the same stale total.
let queue: Promise<unknown> = Promise.resolve();

const inTurn = <T>(run: () => Promise<T>): Promise<T> => {
	const next = queue.then(run, run);
	// Swallowed on the chain, not on the caller's copy: one failed store must not stop the next.
	queue = next.then(
		() => undefined,
		() => undefined,
	);
	return next;
};

const countHeld = async (cache: Cache) => {
	const keys = await cache.keys();
	let total = 0;
	for (const key of keys) {
		const held = await cache.match(key);
		if (held) total += sizeOf(held);
	}
	return { count: keys.length, bytes: total };
};

// Oldest first, deliberately not least-recently-used: nothing here expires, so rotation is the only
// thing that makes a re-tagged sleeve reappear. `keys()` answers in insertion order, which is the
// whole of the policy.
const evictTo = async (cache: Cache, budget: number) => {
	if (heldBytes === null || heldBytes <= budget) return;

	for (const key of await cache.keys()) {
		if (heldBytes <= budget) return;
		const held = await cache.match(key);
		if (await cache.delete(key)) heldBytes -= held ? sizeOf(held) : 0;
	}
};

export async function cachedArtwork(url: string): Promise<Blob | null> {
	if (!canCacheArtwork()) return null;

	try {
		const cache = await caches.open(CACHE);
		// `ignoreVary`: beefweb answers `Vary: Origin` and an image request carries no `Origin` header,
		// so a match that honoured it would turn on a header neither side ever sends.
		const held = await cache.match(url, { ignoreVary: true });
		return held ? await held.blob() : null;
	} catch {
		return null;
	}
}

export async function keepArtwork(url: string, response: Response) {
	if (!canCacheArtwork() || !response.ok) return;

	await inTurn(async () => {
		try {
			const cache = await caches.open(CACHE);
			if (heldBytes === null) heldBytes = (await countHeld(cache)).bytes;

			await cache.put(url, response);
			heldBytes += sizeOf(response);
			await evictTo(cache, BUDGET_BYTES);
		} catch {
			// A full disk, a quota refusal, the browser evicting the origin. The cover is already on
			// screen and the only thing lost is having it next time.
			heldBytes = null;
		}
	});
}

export async function artworkHeld(): Promise<{
	count: number;
	bytes: number;
	budget: number;
}> {
	if (!canCacheArtwork()) return { count: 0, bytes: 0, budget: BUDGET_BYTES };

	try {
		const held = await countHeld(await caches.open(CACHE));
		heldBytes = held.bytes;
		return { ...held, budget: BUDGET_BYTES };
	} catch {
		return { count: 0, bytes: 0, budget: BUDGET_BYTES };
	}
}

export async function forgetArtwork() {
	if (!canCacheArtwork()) return;
	try {
		await caches.delete(CACHE);
	} finally {
		heldBytes = 0;
	}
}

// One blob URL per address, shared and counted. `URL.createObjectURL` mints a new handle on every
// call, and a track list draws one album across a dozen rows.
const handles = new Map<string, { url: string; refs: number }>();

const share = (src: string, blob: Blob) => {
	const held = handles.get(src);
	if (held) {
		held.refs += 1;
		return held.url;
	}

	const url = URL.createObjectURL(blob);
	handles.set(src, { url, refs: 1 });
	return url;
};

export async function heldArtwork(src: string): Promise<string | null> {
	if (!canCacheArtwork()) return null;

	const held = handles.get(src);
	if (held) {
		held.refs += 1;
		return held.url;
	}

	const stored = await cachedArtwork(src);
	return stored ? share(src, stored) : null;
}

// The address to point an `<img>` at, and a claim on it. Every caller that holds one MUST drop it.
export async function holdArtwork(
	src: string,
	signal: AbortSignal,
): Promise<string> {
	if (!canCacheArtwork()) return src;

	const held = await heldArtwork(src);
	if (held) return held;

	const response = await fetch(src, { signal });
	// A 404 is `no artwork found` for a track that has none, and deliberately not kept: a sleeve added
	// to the file later has to turn up on the next look.
	if (!response.ok) throw new Error(`no artwork: ${response.status}`);

	await keepArtwork(src, response.clone());
	return share(src, await response.blob());
}

export function dropArtwork(src: string) {
	const held = handles.get(src);
	if (!held) return;

	held.refs -= 1;
	if (held.refs > 0) return;

	handles.delete(src);
	URL.revokeObjectURL(held.url);
}
