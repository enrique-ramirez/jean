// Native loading="lazy" fires for every row a virtualised list moves through the viewport, so one jump across a long playlist requests hundreds of covers for a screen that comes to rest showing forty, starving the rest of the app of the origin's six connections.
// Time is the gate here, not capacity: a queue alone drains as fast as the rows churn against a player that answers instantly, and lets every one of them through.

// How long a row must stay mounted before it is even queued. A row scrolled past lives one or two frames.
const SETTLE_MS = 100;

// Six connections, one held forever by the update stream: this leaves two for everything else, because a cover is never worth a transport command's socket.
const MAX_IN_FLIGHT = 3;

export type ArtworkOutcome = "ok" | "failed";

interface QueueEntry {
	url: string;
	grant: () => void;
	released: boolean;
	pending: number;
}

const waiting: QueueEntry[] = [];
let inFlight = 0;

// Both outcomes are worth remembering: a cached cover re-queued is a visible flash for no request, and a track with no embedded art would otherwise ask again every time it scrolls back into view.
const SEEN_LIMIT = 4096;
let seen = new Map<string, ArtworkOutcome>();

export const outcomeFor = (url: string) => seen.get(url);

const remember = (url: string, outcome: ArtworkOutcome) => {
	// Forgetting the lot costs one trip through the queue and never a refetch, since the browser still has the image, so this is cheaper than an LRU.
	if (seen.size >= SEEN_LIMIT) seen = new Map();
	seen.set(url, outcome);
};

const pump = () => {
	const starting = waiting.splice(0, MAX_IN_FLIGHT - inFlight);
	inFlight += starting.length;
	starting.forEach((entry) => {
		entry.grant();
	});
};

// Returns the release: call it with an outcome once the image settles, or with nothing if the row goes away first.
// A caller that releases without an outcome must also stop the request, or the freed slot lets this run wider than its cap.
export function requestArtwork(url: string, grant: () => void) {
	const entry: QueueEntry = { url, grant, released: false, pending: 0 };

	entry.pending = setTimeout(() => {
		entry.pending = 0;
		waiting.push(entry);
		pump();
	}, SETTLE_MS);

	return (outcome?: ArtworkOutcome) => {
		if (entry.released) return;
		entry.released = true;
		if (outcome) remember(url, outcome);

		if (entry.pending) {
			clearTimeout(entry.pending);
			entry.pending = 0;
			return;
		}

		const queued = waiting.indexOf(entry);
		if (queued >= 0) {
			waiting.splice(queued, 1);
			return;
		}

		inFlight -= 1;
		pump();
	};
}
