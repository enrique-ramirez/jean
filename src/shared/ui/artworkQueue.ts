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
