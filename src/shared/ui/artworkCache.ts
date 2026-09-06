// Artwork kept on disk, because beefweb will not let the browser keep it.
//
// Every beefweb response carries `Cache-Control: max-age=3, must-revalidate` -- one filter for the
// whole API, so a 600 KB sleeve is cached as briefly as a status poll. Measured against a real
// library, revisiting a screen re-fetched every cover as a fresh 200: about 15 MB and sixty round
// trips, each one a new connection, since beefweb also closes the socket per response. Nothing on
// the client can change another server's headers.
//
// Cache Storage is the way out, and the reason is that **it ignores caching headers entirely**:
// what is put in stays until it is taken out. The HTTP cache cannot be talked into this; this store
// needs no talking into it.
//
// **Not a service worker.** A worker's scope is the directory it is served from, and Jean is
// documented to install at `/jean` with the stock UI left at `/` -- so a worker there could never
// see `/api/artwork/...`, and widening its scope needs a `Service-Worker-Allowed` header beefweb has
// no way to send. `caches` is available to the page directly and has no scope at all.

const CACHE = "jean-artwork-v1";

// Measured against a real library rather than guessed: covers there run 14 KB to 1.19 MB and average
// about 740 KB, because the artwork that ships with an album is whatever the tagger embedded. At
// 50 MB this held sixty-five of them -- roughly one screenful of the genres index -- so it filled and
// then evicted the covers still on screen, which looks exactly like not caching at all.
//
// A cache still has to fill eventually: nothing here expires, and rotation is the only thing that
// makes a re-tagged sleeve reappear without somebody pressing Clear. This is the compromise -- large
// enough that ordinary use never thrashes, small enough that a 2,360-album library turns over.
const BUDGET_BYTES = 500 * 1024 * 1024;

/**
 * `caches` is secure-context only, so an install served over plain HTTP on a LAN -- which is the
 * normal one -- has no cache and must go on working exactly as before. Nothing here throws; every
 * entry point answers "no" rather than failing.
 */
export const canCacheArtwork = () =>
	typeof caches !== "undefined" && typeof Response !== "undefined";

const sizeOf = (response: Response) =>
	Number(response.headers.get("content-length")) || 0;

// The running total, or null before it has been counted. A page load starts not knowing, counts
// once, and then keeps up by addition -- walking every entry per store would be a disk read each.
let heldBytes: number | null = null;

// Stores are serialised, because reading the total, adding to it and evicting against it is a
// read-modify-write, and two covers arriving together would each evict against the same stale total.
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

// Oldest first, and deliberately not least-recently-used. LRU would pin whatever you look at most
// and never let it go, so the covers you see every day would be the last to refresh -- the opposite
// of what a cache with no expiry needs. Insertion order guarantees everything rotates eventually.
const evictTo = async (cache: Cache, budget: number) => {
	if (heldBytes === null || heldBytes <= budget) return;

	// `keys()` answers in insertion order, which is the whole of the policy.
	for (const key of await cache.keys()) {
		if (heldBytes <= budget) return;
		const held = await cache.match(key);
		if (await cache.delete(key)) heldBytes -= held ? sizeOf(held) : 0;
	}
};

/** The cover, if it is already held. Null on a miss, and on every browser that cannot do this. */
export async function cachedArtwork(url: string): Promise<Blob | null> {
	if (!canCacheArtwork()) return null;

	try {
		const cache = await caches.open(CACHE);
		// `ignoreVary`, because beefweb answers `Vary: Origin` and an image request carries no `Origin`
		// header -- a match that honoured it would turn on a header neither side ever sends.
		const held = await cache.match(url, { ignoreVary: true });
		return held ? await held.blob() : null;
	} catch {
		return null;
	}
}

/**
 * Keep a cover. Only a `200` is kept: beefweb answers `404` with `no artwork found` for a track that
 * has none, and caching that is what would make somebody's newly added sleeve fail to turn up.
 */
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
			// A full disk, a browser evicting the origin, a quota refusal. The cover is already on
			// screen; the only thing lost is having it next time.
			heldBytes = null;
		}
	});
}

/** What is held, for the one screen that says so. */
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

/** The remedy for a cover that was re-tagged on disk, and the only one there is. */
export async function forgetArtwork() {
	if (!canCacheArtwork()) return;
	try {
		await caches.delete(CACHE);
	} finally {
		heldBytes = 0;
	}
}

// ---- handing a cover to an `<img>` ------------------------------------------

// One blob URL per address, shared and counted. `URL.createObjectURL` mints a *new* handle on every
// call, and a track list draws one album across a dozen rows -- minting per component would hold a
// dozen copies of the same picture in memory for as long as the tab is open.
const handles = new Map<string, { url: string; refs: number }>();

const share = (src: string, blob: Blob) => {
	// A second caller may have finished while this one was awaiting; the loser's blob is dropped
	// rather than becoming a second handle to the same bytes.
	const held = handles.get(src);
	if (held) {
		held.refs += 1;
		return held.url;
	}

	const url = URL.createObjectURL(blob);
	handles.set(src, { url, refs: 1 });
	return url;
};

/**
 * A claim on a cover **already held**, or null where the network would be needed.
 *
 * Separate from `holdArtwork` so a caller can answer from disk without taking a slot in the artwork
 * queue: that queue exists to bound how many *requests* are in flight, and a local read is not one.
 * Queued, cache hits resolved three at a time and a cached screen filled in as slowly as a cold one.
 */
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

/**
 * The address to point an `<img>` at, and a claim on it. Every caller that holds one MUST drop it.
 * Without a cache this is the address itself, which is what Jean has always done.
 *
 * Throws where the cover could not be had at all, which the caller renders as a settled failure.
 */
export async function holdArtwork(
	src: string,
	signal: AbortSignal,
): Promise<string> {
	if (!canCacheArtwork()) return src;

	// Checked again: the wait for a queue slot is long enough for another tile to have fetched and
	// stored the same cover.
	const held = await heldArtwork(src);
	if (held) return held;

	const response = await fetch(src, { signal });
	// A 404 is `no artwork found`, a normal answer rather than an error -- and deliberately not kept,
	// so a sleeve added to the file later turns up on the next look.
	if (!response.ok) throw new Error(`no artwork: ${response.status}`);

	await keepArtwork(src, response.clone());
	return share(src, await response.blob());
}

/** Give up a claim. The bytes go when the last one does. */
export function dropArtwork(src: string) {
	const held = handles.get(src);
	if (!held) return;

	held.refs -= 1;
	if (held.refs > 0) return;

	handles.delete(src);
	URL.revokeObjectURL(held.url);
}
