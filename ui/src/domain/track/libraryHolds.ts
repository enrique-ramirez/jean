import type { ReadFailure, ReadFailureReason } from "@/shared/api/readFailure";
import type { StateDocument } from "@/shared/api/state";
import type { LibraryGeneration } from "./playlistEntries";

const LIBRARY_RETRY_MIN_MS = 5_000;
const LIBRARY_RETRY_MAX_MS = 60_000;

export const retryWait = (failures: number) =>
	Math.min(LIBRARY_RETRY_MIN_MS * 2 ** (failures - 1), LIBRARY_RETRY_MAX_MS);

export type Hold =
	| { kind: "none" }
	| { kind: "libraryReady" }
	| { kind: "declaration" }
	| { kind: "refused" }
	| { kind: "tooFast"; until: number }
	| { kind: "failing"; failures: number; failedAt: number };

type AnnouncedLibrary = StateDocument["library"];

export interface Waiting {
	pair: LibraryGeneration | null;
	hold: Hold;
	announced: AnnouncedLibrary | null;
}

export const isDue = ({ hold }: Waiting) => {
	switch (hold.kind) {
		case "none":
			return true;
		case "tooFast":
			return Date.now() >= hold.until;
		case "failing":
			return Date.now() - hold.failedAt >= retryWait(hold.failures);
		default:
			return false;
	}
};

export const isWaitingOnTime = ({ hold }: Waiting) =>
	hold.kind === "tooFast" || hold.kind === "failing";

export function holdAfter(
	hold: Hold,
	reason: ReadFailureReason,
	retryAfterMs: number | null,
): Hold {
	switch (reason) {
		case "notReady":
			return { kind: "libraryReady" };
		case "undeclared":
			return { kind: "declaration" };
		case "refused":
			return { kind: "refused" };
		case "tooFast":
			return {
				kind: "tooFast",
				until: Date.now() + (retryAfterMs ?? LIBRARY_RETRY_MIN_MS),
			};
		default:
			return {
				kind: "failing",
				failures: (hold.kind === "failing" ? hold.failures : 0) + 1,
				failedAt: Date.now(),
			};
	}
}

// foo_jean reports a halted library ready with no build, and it never builds, so it is not settled.
export const isSettled = (library: AnnouncedLibrary | null) =>
	!!library && library.ready && !library.halted && !library.build;

export function holdAfterResult(
	waiting: Waiting,
	result: { ok: true } | ReadFailure,
) {
	if (result.ok) {
		waiting.hold = { kind: "none" };
		return false;
	}
	if (result.reason === "notReady" && isSettled(waiting.announced)) {
		waiting.hold = { kind: "none" };
		return true;
	}
	waiting.hold = holdAfter(waiting.hold, result.reason, result.retryAfterMs);
	return false;
}

// foo_jean answers 409 for an expression no export has declared, and an export that lands at the pair
// already asked declares them again.
export function declaredAgain(waiting: Waiting) {
	if (waiting.hold.kind !== "declaration") return false;
	waiting.hold = { kind: "none" };
	return true;
}

// foo_jean keeps reporting `ready` while a rebuild for a changed declaration runs, so a 202 with
// `ready` true and a build under way is the pair already asked, not a new one.
export function reportedReady(waiting: Waiting, library: AnnouncedLibrary) {
	waiting.announced = library;
	if (waiting.hold.kind !== "libraryReady" || !library.ready) return false;
	const isAskedPair =
		waiting.pair?.structure === library.structure &&
		waiting.pair.revision === library.revision;
	if ((library.build || library.halted) && isAskedPair) return false;
	waiting.hold = { kind: "none" };
	return true;
}

export interface LibraryWatcher {
	exported: () => void;
	announced: (library: AnnouncedLibrary) => void;
	answered: () => void;
}

const watchers = new Map<string, Set<LibraryWatcher>>();

export function watchLibrary(origin: string, watcher: LibraryWatcher) {
	let watching = watchers.get(origin);
	if (!watching) {
		watching = new Set();
		watchers.set(origin, watching);
	}
	watching.add(watcher);
	return () => {
		watching.delete(watcher);
	};
}

export const libraryEvents = {
	exported: (origin: string) =>
		[...(watchers.get(origin) ?? [])].forEach((one) => {
			one.exported();
		}),
	announced: (origin: string, library: AnnouncedLibrary) =>
		[...(watchers.get(origin) ?? [])].forEach((one) => {
			one.announced(library);
		}),
	answered: (origin: string) =>
		[...(watchers.get(origin) ?? [])].forEach((one) => {
			one.answered();
		}),
};
