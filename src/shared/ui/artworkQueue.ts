// `loading="lazy"` fires for every row a virtualised list moves through the viewport, so one jump
// across a long playlist requests hundreds of covers for a screen that settles showing forty.
// Time is the gate as well as capacity: a queue alone drains as fast as the rows churn against a
// player that answers at once, and lets every one of them through.
const SETTLE_MS = 100;

// The origin allows six connections and the update stream holds one forever.
const MAX_IN_FLIGHT = 3;

export type ArtworkOutcome = "ok" | "failed";

interface QueueEntry {
	key: string;
	grant: () => void;
	released: boolean;
	pending: number;
}

const waiting: QueueEntry[] = [];
let inFlight = 0;

const SEEN_LIMIT = 4096;
let seen = new Map<string, ArtworkOutcome>();

// Keyed on what the picture *is*, so an album with no cover is learned once rather than 404ing for
// every row that draws it -- on a mostly-uncovered library those are most of the traffic.
export const outcomeFor = (key: string) => seen.get(key);

const remember = (key: string, outcome: ArtworkOutcome) => {
	if (seen.size >= SEEN_LIMIT) seen = new Map();
	seen.set(key, outcome);
};

const pump = () => {
	const starting = waiting.splice(0, MAX_IN_FLIGHT - inFlight);
	inFlight += starting.length;
	starting.forEach((entry) => {
		entry.grant();
	});
};

// Returns the release: call it with an outcome once the image settles, or with nothing if the row
// goes away first. Releasing without an outcome must also stop the request, or the freed slot lets
// this run wider than its cap.
export function requestArtwork(key: string, grant: () => void) {
	const entry: QueueEntry = { key, grant, released: false, pending: 0 };

	entry.pending = setTimeout(() => {
		entry.pending = 0;
		waiting.push(entry);
		pump();
	}, SETTLE_MS);

	return (outcome?: ArtworkOutcome) => {
		if (entry.released) return;
		entry.released = true;
		if (outcome) remember(key, outcome);

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
