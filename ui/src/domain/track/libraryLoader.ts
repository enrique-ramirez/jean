import type { PollFollower } from "@/domain/player/playerPoll";
import {
	fetchLibrary,
	fetchLibraryChanges,
	type LibraryFailure,
	type LibraryFailureReason,
	TRANSIENT,
} from "@/shared/api/fooJeanLibrary";
import type { JlibDelta } from "@/shared/api/jlib";
import { fetchState } from "@/shared/api/state";
import type { Phrase } from "@/shared/i18n/en";
import { recordFieldAvailability } from "./fieldAvailability";
import { TRACK_EXPRESSIONS } from "./fields";
import { deriveIntensity, INTENSITY_FIELDS } from "./intensity";
import { someFieldMoved } from "./libraryColumns";
import { librarySnapshotOf, patchedColumns } from "./librarySnapshot";
import {
	begin,
	componentLibraryKey,
	type Entry,
	emit,
	heldEntry,
	type LibraryFeed,
	type LibraryGeneration,
	playlistSnapshot,
} from "./playlistEntries";
import { retryFailedPlaylistReads } from "./playlistLoader";

const LIBRARY_RETRY_MIN_MS = 5_000;
const LIBRARY_RETRY_MAX_MS = 60_000;

export const READ_FAILED = {
	unavailable: "library.readUnavailable",
	"too-large": "library.readTooLarge",
	refused: "library.readRefused",
	unreachable: "library.readUnreachable",
	timeout: "library.readTimedOut",
	failed: "library.readFailed",
} as const satisfies Record<LibraryFailureReason, Phrase>;

function recordLibraryFailure(entry: Entry, failure: LibraryFailure) {
	entry.isStarted = false;
	entry.libraryRetry = {
		failures: (entry.libraryRetry?.failures ?? 0) + 1,
		failedAt: Date.now(),
	};
	emit(entry, { isLoading: false, failure, error: null });
}

async function loadSnapshot(entry: Entry, origin: string) {
	try {
		const result = await fetchLibrary(
			origin,
			TRACK_EXPRESSIONS,
			(entry.controller as AbortController).signal,
			(build) => emit(entry, { loaded: build.formatted, total: build.total }),
		);

		if (!result.ok) return recordLibraryFailure(entry, result);

		const { library } = result;
		const { columns, paths, subsongs } = librarySnapshotOf(
			library,
			TRACK_EXPRESSIONS,
		);

		entry.feed = {
			kind: "library",
			structure: library.structure,
			revision: library.revision,
			isChecking: false,
		};
		entry.libraryRetry = null;

		recordFieldAvailability(columns);
		emit(entry, {
			columns,
			structure: library.structure,
			paths,
			subsongs,
			loaded: columns.trackCount,
			total: columns.trackCount,
			isLoading: false,
			error: null,
			failure: null,
			...deriveIntensity(columns),
		});

		await recheckMissed(entry, origin);
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") return;
		recordLibraryFailure(entry, {
			ok: false,
			reason: "failed",
			detail: error instanceof Error ? error.message : "",
		});
	}
}

function exportAgain(entry: Entry, origin: string) {
	entry.controller?.abort();
	entry.controller = new AbortController();
	entry.feed = null;
	entry.isStarted = true;
	emit(entry, {
		isLoading: true,
		error: null,
		failure: null,
		loaded: 0,
		total: 0,
	});
	return loadSnapshot(entry, origin);
}

function applyDelta(entry: Entry, feed: LibraryFeed, delta: JlibDelta) {
	const held = entry.snapshot.columns;
	const columns = patchedColumns(held, delta, TRACK_EXPRESSIONS);
	if (!columns) return false;

	feed.revision = delta.revision;
	recordFieldAvailability(columns);
	emit(entry, {
		columns,
		...(someFieldMoved(INTENSITY_FIELDS, held, columns)
			? deriveIntensity(columns)
			: null),
	});
	return true;
}

async function recheckMissed(entry: Entry, origin: string) {
	const missed = entry.missedLibrary;
	if (!missed) return;
	entry.missedLibrary = null;

	const feed = entry.feed;
	if (
		feed &&
		feed.kind === "library" &&
		missed.structure === feed.structure &&
		missed.revision === feed.revision
	)
		return;

	const result = await fetchState(origin, null);
	if (result.ok && result.kind === "state")
		await recheckComponentLibrary(origin, result.state.library);
	else entry.missedLibrary ??= missed;
}

export async function retryMissedLibraryRead(origin: string) {
	const entry = heldEntry(componentLibraryKey(origin));
	const feed = entry?.feed;
	if (!entry || feed?.kind !== "library") return;
	if (feed.isChecking || entry.snapshot.isLoading) return;
	await recheckMissed(entry, origin);
}

export async function recheckComponentLibrary(
	origin: string,
	library: LibraryGeneration,
) {
	const entry = heldEntry(componentLibraryKey(origin));
	if (!entry) return;

	const feed = entry.feed;
	if (feed?.kind !== "library") {
		entry.missedLibrary = library;
		return;
	}
	if (feed.isChecking || entry.snapshot.isLoading) {
		entry.missedLibrary = library;
		return;
	}

	feed.isChecking = true;
	try {
		if (library.structure !== feed.structure)
			return void (await exportAgain(entry, origin));
		if (library.revision <= feed.revision) return;

		const changes = await fetchLibraryChanges(origin, feed.revision);
		if (!changes.ok) return;
		if (changes.kind === "delta" && applyDelta(entry, feed, changes.delta))
			return;

		await exportAgain(entry, origin);
	} finally {
		feed.isChecking = false;
		await recheckMissed(entry, origin);
	}
}

export async function retryFailedLibraryRead(origin: string) {
	const entry = heldEntry(componentLibraryKey(origin));
	if (!entry) return;

	const { failure } = entry.snapshot;
	if (!failure || !TRANSIENT.has(failure.reason)) return;
	const retry = entry.libraryRetry;
	if (!retry) return;

	const wait = Math.min(
		LIBRARY_RETRY_MIN_MS * 2 ** (retry.failures - 1),
		LIBRARY_RETRY_MAX_MS,
	);
	if (Date.now() - retry.failedAt < wait) return;

	await exportAgain(entry, origin);
}

export function tryLibraryAgain(origin: string) {
	const entry = heldEntry(componentLibraryKey(origin));
	if (!entry) return;

	const { failure } = entry.snapshot;
	if (!failure || !TRANSIENT.has(failure.reason)) return;

	entry.libraryRetry = null;
	return exportAgain(entry, origin);
}

export const loadComponentLibrary = (origin: string) =>
	begin(componentLibraryKey(origin), 0, true, (entry) =>
		loadSnapshot(entry, origin),
	);

export const libraryPollFollower: PollFollower = {
	heldLibraryStructure: (origin) =>
		playlistSnapshot(componentLibraryKey(origin)).structure,
	answered: (origin) => {
		void retryFailedPlaylistReads(origin);
		void retryFailedLibraryRead(origin);
		void retryMissedLibraryRead(origin);
	},
	libraryAnnounced: (origin, library) =>
		void recheckComponentLibrary(origin, library),
};
