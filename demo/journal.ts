// What somebody did to the demo, so that it survives the page being reloaded
// and the worker being shut down.
//
// **A service worker is not a server.** The browser stops an idle one after
// about thirty seconds and starts a fresh one for the next request, and
// everything the player held goes with it -- the ratings written, the queue,
// the playlist somebody reordered. The library itself is rebuilt from a seed
// and costs nothing, so what is worth keeping is only the difference: the
// writes, in the order they were made, replayed against a new player on the way
// up. It is the same list `state.requests` already holds, for the same reason.
//
// Kept in the Cache API rather than IndexedDB because it is one JSON blob under
// one key, and that is the whole of what a cache entry is.

export interface Entry {
	method: string;
	path: string;
	body: unknown;
}

const CACHE = "jean-demo";
const KEY = "/__demo/journal";

// Bounded, and the bound is a judgement rather than a limit anyone hit: a demo
// session that has sent four hundred writes has told us everything about what
// it was doing, and replaying a longer one costs the visitor a slower first
// paint for state they have long forgotten. The oldest go first.
const LIMIT = 400;

let entries: Entry[] = [];
let saving: ReturnType<typeof setTimeout> | null = null;

export async function load(): Promise<Entry[]> {
	const cache = await caches.open(CACHE);
	const stored = await cache.match(KEY);
	entries = stored ? ((await stored.json().catch(() => [])) as Entry[]) : [];
	return entries;
}

const save = async () => {
	saving = null;
	const cache = await caches.open(CACHE);
	await cache.put(KEY, new Response(JSON.stringify(entries)));
};

export function append(entry: Entry) {
	entries.push(entry);
	if (entries.length > LIMIT) entries.splice(0, entries.length - LIMIT);
	// Debounced: a drag sends a burst of writes and the journal is worth one
	// serialisation, not forty.
	if (!saving) saving = setTimeout(save, 500);
}

export async function clear() {
	entries = [];
	if (saving) clearTimeout(saving);
	saving = null;
	const cache = await caches.open(CACHE);
	await cache.delete(KEY);
}
