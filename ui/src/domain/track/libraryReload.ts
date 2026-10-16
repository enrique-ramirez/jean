import {
	declareLibrary,
	fetchLibraryChanges,
	sameColumns,
} from "@/shared/api/fooJeanLibrary";
import { fetchState } from "@/shared/api/state";
import { TRACK_EXPRESSIONS } from "./fields";
import { keepNote, landLibrary, noteFor } from "./libraryLanding";
import {
	type ReplayedLibrary,
	replayedLibrary,
	withDelta,
	withSplice,
} from "./libraryReplay";
import { librarySearcher } from "./librarySearcher";
import { withSpine } from "./librarySnapshot";
import {
	type KeepNote,
	LIBRARY_FORMAT,
	type LibraryPair,
	reloadPlan,
	type StoreKey,
	sameKey,
} from "./libraryStore";
import { type Entry, emit, type LibraryFeed } from "./playlistEntries";

// A player that has started since declares nothing built until a client does.
async function playerPair(
	entry: Entry,
	origin: string,
	signal: AbortSignal,
): Promise<LibraryPair | null> {
	const read = async () => {
		const state = await fetchState(origin, null, signal);
		return state.ok && state.kind === "state" ? state.state.library : null;
	};

	let library = await read();
	if (!library) return null;

	if (!library.ready || !sameColumns(library.columns, TRACK_EXPRESSIONS)) {
		const failed = await declareLibrary(
			origin,
			TRACK_EXPRESSIONS,
			signal,
			(build) => emit(entry, { loaded: build.formatted, total: build.total }),
		);
		if (failed) return null;
		library = await read();
		if (!library) return null;
	}
	return library;
}

export async function drawStoredLibrary(
	entry: Entry,
	origin: string,
	apiVersion: number | null,
	signal: AbortSignal,
): Promise<LibraryPair | null> {
	const searcher = librarySearcher();
	if (!searcher || apiVersion === null) return null;

	const copy = await searcher.stored();
	signal.throwIfAborted();
	if (!copy?.stored) return null;
	const { stored } = copy;

	const key: StoreKey = {
		declaration: TRACK_EXPRESSIONS,
		format: LIBRARY_FORMAT,
		apiVersion,
		build: copy.build,
	};
	if (!sameKey(stored.key, key)) return null;

	const now = await playerPair(entry, origin, signal);
	signal.throwIfAborted();
	if (!now) return null;

	const plan = reloadPlan(stored, key, now);
	if (plan.kind === "export") return null;
	if (
		plan.kind === "delta" &&
		plan.structure === now.structure &&
		plan.since >= now.revision
	)
		return null;

	const [restored, changes] = await Promise.all([
		searcher.restore(),
		plan.kind === "delta"
			? fetchLibraryChanges(origin, plan.since, plan.structure, signal)
			: null,
	]);
	signal.throwIfAborted();
	let events = restored;

	let handToWorker: ((note: KeepNote | undefined) => void) | null = null;
	let advance: (replayed: ReplayedLibrary) => ReplayedLibrary | null = (
		replayed,
	) => replayed;
	if (changes) {
		if (!changes.ok || changes.kind === "gone") return null;
		if (changes.kind === "another-run") {
			if (
				stored.snapshotId !== now.snapshotId ||
				stored.trackCount !== now.trackCount
			)
				return null;
			events = await searcher.restore(noteFor(apiVersion, now, true));
			signal.throwIfAborted();
		} else if (changes.kind === "delta") {
			const { delta } = changes;
			advance = (replayed) => withDelta(replayed, delta);
			handToWorker = (note) => searcher.patch(changes.bytes, note);
		} else {
			const { splice } = changes;
			advance = (replayed) =>
				splice.sinceStructure === replayed.structure &&
				splice.since === replayed.revision
					? withSplice(replayed, splice)
					: null;
			handToWorker = (note) => searcher.splice(changes.bytes, note);
		}
	}
	const replayed = events && replayedLibrary(events);
	if (!replayed) return null;
	const held = advance(replayed);
	if (!held) return null;

	const feed: LibraryFeed = {
		kind: "library",
		structure: held.structure,
		revision: held.revision,
		snapshotId: held.snapshotId,
		apiVersion,
		spine: held.spine,
		isChecking: false,
	};
	await landLibrary(
		entry,
		feed,
		withSpine(held.columns, held.spine),
		() => handToWorker?.(keepNote(feed, held.columns)),
		signal,
	);
	return now;
}
