import type { PollFollower } from "@/domain/player/playerPoll";
import {
	fetchLibrary,
	fetchLibraryChanges,
	type LibraryFailure,
	type LibraryFailureReason,
	TRANSIENT,
} from "@/shared/api/fooJeanLibrary";
import type { JlibDelta, JlibSnapshot, JlibSplice } from "@/shared/api/jlib";
import { fetchState } from "@/shared/api/state";
import type { Phrase } from "@/shared/i18n/en";
import { workWhenIdle } from "@/shared/lib/idle";
import { sleep } from "@/shared/lib/sleep";
import {
	EARLY_EXPRESSIONS,
	LATE_EXPRESSIONS,
	LATE_FIELDS,
	TRACK_EXPRESSIONS,
} from "./fields";
import {
	deriveIntensity,
	INTENSITY_FIELDS,
	patchedIntensity,
} from "./intensity";
import { readKeepLibrary } from "./keepLibrary";
import { isLoaded, someFieldMoved } from "./libraryColumns";
import {
	apiVersionOf,
	type Joined,
	keepNote,
	landExport,
	landLatePart,
	landSettledLatePart,
	showColumns,
} from "./libraryLanding";
import { drawStoredLibrary } from "./libraryReload";
import { librarySearcher } from "./librarySearcher";
import {
	columnsOfSnapshot,
	patchedColumns,
	splicedColumns,
	splicedSpine,
	withSpine,
} from "./librarySnapshot";
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

const retryWait = (failures: number) =>
	Math.min(LIBRARY_RETRY_MIN_MS * 2 ** (failures - 1), LIBRARY_RETRY_MAX_MS);

const CHECK_POLL_MS = 50;

const MAX_CATCH_UPS = 4;

export const READ_FAILED = {
	unavailable: "library.readUnavailable",
	"too-large": "library.readTooLarge",
	refused: "library.readRefused",
	unreachable: "library.readUnreachable",
	timeout: "library.readTimedOut",
	halted: "library.halted.summary",
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

let isRenewing = false;

const RENEWAL_BACKOFF_MIN_MS = 60_000;
const RENEWAL_BACKOFF_MAX_MS = 60 * 60_000;

const renewalBackoff = { failures: 0, notBefore: 0 };

const failRenewal = () => {
	renewalBackoff.failures += 1;
	renewalBackoff.notBefore =
		Date.now() +
		Math.min(
			RENEWAL_BACKOFF_MIN_MS * 2 ** (renewalBackoff.failures - 1),
			RENEWAL_BACKOFF_MAX_MS,
		);
};

async function renewStoredCopy(origin: string) {
	const entry = heldEntry(componentLibraryKey(origin));
	const feed = entry?.feed;
	if (isRenewing || !entry?.controller || feed?.kind !== "library") return;
	if (feed.isChecking || entry.snapshot.isLoading || !readKeepLibrary()) return;
	if (Date.now() < renewalBackoff.notBefore) return;

	isRenewing = true;
	feed.isChecking = true;
	const { signal } = entry.controller;
	try {
		await new Promise<void>((resolve) =>
			workWhenIdle(() => {
				resolve();
				return true;
			}),
		);
		const result = await fetchLibrary(origin, TRACK_EXPRESSIONS, signal);
		if (signal.aborted || entry.feed !== feed) return;
		if (!result.ok) return failRenewal();
		await landExport(entry, result, feed.apiVersion, signal);
		renewalBackoff.failures = 0;
	} catch (error) {
		if (!signal.aborted) failRenewal();
		throw error;
	} finally {
		feed.isChecking = false;
		isRenewing = false;
		await recheckMissed(entry, origin);
	}
}

async function loadSnapshot(entry: Entry, origin: string, mayDraw = true) {
	try {
		const controller = entry.controller as AbortController;
		librarySearcher()?.onOutgrown(
			() => void renewStoredCopy(origin).catch(() => undefined),
		);
		const apiVersion = readKeepLibrary() ? await apiVersionOf(origin) : null;
		controller.signal.throwIfAborted();

		const drawn = mayDraw
			? await drawStoredLibrary(
					entry,
					origin,
					apiVersion,
					controller.signal,
				).catch((error) => {
					if (controller.signal.aborted) throw error;
					return null;
				})
			: null;

		if (drawn) {
			if (!isLoaded(entry.snapshot.columns, LATE_FIELDS))
				void loadLatePart(entry, origin);
			await recheckComponentLibrary(origin, drawn);
			await recheckMissed(entry, origin);
			return;
		}

		const result = await fetchLibrary(
			origin,
			TRACK_EXPRESSIONS,
			controller.signal,
			(build) => emit(entry, { loaded: build.formatted, total: build.total }),
			{ only: EARLY_EXPRESSIONS, hasSpine: true },
		);

		if (!result.ok) return recordLibraryFailure(entry, result);

		const snapshot = await landExport(
			entry,
			result,
			apiVersion,
			controller.signal,
		);

		if (!isLoaded(snapshot.columns, LATE_FIELDS))
			void loadLatePart(entry, origin);

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

interface LateRead {
	isAsking: boolean;
	failures: number;
	failedAt: number;
	isRefused: boolean;
}

const REFUSED_FOR_GOOD: ReadonlySet<LibraryFailureReason> = new Set([
	"too-large",
	"refused",
]);

const lateReads = new WeakMap<AbortController, LateRead>();

const lateReadOf = (controller: AbortController) => {
	let read = lateReads.get(controller);
	if (!read) {
		read = { isAsking: false, failures: 0, failedAt: 0, isRefused: false };
		lateReads.set(controller, read);
	}
	return read;
};

// The rows are in the document after the frame that follows the one they were committed in. A
// background tab never runs animation frames, so a timer ends the wait there.
const FIRST_PAINT_GIVE_UP_MS = 1_000;

async function afterFirstPaint(signal: AbortSignal) {
	const timer = new AbortController();
	const stop = () => timer.abort();
	signal.addEventListener("abort", stop, { once: true });
	try {
		await Promise.race([
			new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
			),
			sleep(FIRST_PAINT_GIVE_UP_MS, timer.signal),
		]);
	} finally {
		signal.removeEventListener("abort", stop);
		timer.abort();
	}
}

async function untilNotChecking(feed: LibraryFeed, signal: AbortSignal) {
	while (feed.isChecking) await sleep(CHECK_POLL_MS, signal);
}

async function bringToOneRevision(
	entry: Entry,
	feed: LibraryFeed,
	origin: string,
	library: JlibSnapshot,
	bytes: ArrayBuffer,
	signal: AbortSignal,
): Promise<Joined> {
	let part = columnsOfSnapshot(library, TRACK_EXPRESSIONS);
	let revision = library.revision;
	const patches: ArrayBuffer[] = [];

	const exportInstead = async (): Promise<Joined> => {
		await exportAgain(entry, origin);
		return "restarted";
	};

	for (let round = 0; round < MAX_CATCH_UPS; round += 1) {
		if (revision === feed.revision)
			return landLatePart(entry, feed, part, bytes, patches, signal);

		const isPartBehind = revision < feed.revision;
		const changes = await fetchLibraryChanges(
			origin,
			isPartBehind ? revision : feed.revision,
			feed.structure,
			signal,
		);
		if (signal.aborted || !changes.ok) return "failed";
		if (changes.kind !== "delta") return exportInstead();

		if (isPartBehind) {
			const patched = patchedColumns(part, changes.delta, TRACK_EXPRESSIONS);
			if (!patched) return exportInstead();
			part = patched;
			revision = changes.delta.revision;
			patches.push(changes.bytes);
		} else if (!applyDelta(entry, feed, changes.delta, changes.bytes))
			return exportInstead();
	}
	return "failed";
}

async function joinLatePart(
	entry: Entry,
	origin: string,
	library: JlibSnapshot,
	bytes: ArrayBuffer,
	signal: AbortSignal,
): Promise<Joined> {
	const feed = entry.feed;
	if (feed?.kind !== "library") return "failed";
	await untilNotChecking(feed, signal);
	if (entry.feed !== feed || library.structure !== feed.structure)
		return "failed";

	feed.isChecking = true;
	try {
		return await bringToOneRevision(
			entry,
			feed,
			origin,
			library,
			bytes,
			signal,
		);
	} finally {
		feed.isChecking = false;
		await recheckMissed(entry, origin);
	}
}

async function readLatePart(
	entry: Entry,
	origin: string,
	signal: AbortSignal,
): Promise<Joined | LibraryFailure> {
	await afterFirstPaint(signal);
	if (signal.aborted) return "failed";

	const result = await fetchLibrary(
		origin,
		TRACK_EXPRESSIONS,
		signal,
		undefined,
		{ only: LATE_EXPRESSIONS, hasSpine: false },
	);
	return result.ok
		? joinLatePart(entry, origin, result.library, result.bytes, signal)
		: result;
}

async function loadLatePart(entry: Entry, origin: string) {
	const controller = entry.controller as AbortController;
	const read = lateReadOf(controller);
	if (read.isAsking) return;

	read.isAsking = true;
	const joined = await readLatePart(entry, origin, controller.signal).catch(
		(): Joined => "failed",
	);
	read.isAsking = false;

	if (joined === "joined" || joined === "restarted") return;
	if (controller.signal.aborted) return;

	if (joined !== "failed" && REFUSED_FOR_GOOD.has(joined.reason)) {
		read.isRefused = true;
		await landSettledLatePart(entry, joined, controller.signal);
		return;
	}
	read.failures += 1;
	read.failedAt = Date.now();
}

function retryLatePart(origin: string) {
	const entry = heldEntry(componentLibraryKey(origin));
	if (!entry?.controller || entry.feed?.kind !== "library") return;
	if (entry.snapshot.isLoading || isLoaded(entry.snapshot.columns, LATE_FIELDS))
		return;

	const read = lateReadOf(entry.controller);
	if (read.isAsking || read.isRefused || read.failures === 0) return;
	if (Date.now() - read.failedAt >= retryWait(read.failures))
		void loadLatePart(entry, origin);
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
	return loadSnapshot(entry, origin, false);
}

function applyDelta(
	entry: Entry,
	feed: LibraryFeed,
	delta: JlibDelta,
	bytes: ArrayBuffer,
) {
	const held = entry.snapshot.columns;
	const columns = patchedColumns(held, delta, TRACK_EXPRESSIONS);
	if (!columns) return false;

	feed.revision = delta.revision;
	feed.snapshotId = delta.snapshotId;
	librarySearcher()?.patch(bytes, keepNote(feed, columns));
	showColumns(columns);
	emit(entry, {
		columns,
		...(someFieldMoved(INTENSITY_FIELDS, held, columns)
			? patchedIntensity(entry.snapshot, held, columns)
			: null),
	});
	return true;
}

function applySplice(
	entry: Entry,
	feed: LibraryFeed,
	splice: JlibSplice,
	bytes: ArrayBuffer,
) {
	if (splice.sinceStructure !== feed.structure) return false;
	if (splice.since !== feed.revision) return false;

	const columns = splicedColumns(
		entry.snapshot.columns,
		splice,
		TRACK_EXPRESSIONS,
	);
	const spine = splicedSpine(feed.spine, splice);
	if (!columns || !spine) return false;

	feed.structure = splice.structure;
	feed.revision = splice.revision;
	feed.snapshotId = splice.snapshotId;
	feed.spine = spine;
	librarySearcher()?.splice(bytes, keepNote(feed, columns));
	showColumns(columns);
	const { paths, subsongs } = withSpine(columns, spine);
	emit(entry, {
		columns,
		structure: splice.structure,
		paths,
		subsongs,
		loaded: columns.trackCount,
		total: columns.trackCount,
		...deriveIntensity(columns),
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

async function retryMissedLibraryRead(origin: string) {
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
		const isRestructured = library.structure !== feed.structure;
		if (!isRestructured && library.revision <= feed.revision) return;

		const changes = await fetchLibraryChanges(
			origin,
			feed.revision,
			feed.structure,
		);
		if (!changes.ok && !isRestructured) return;
		if (changes.ok) {
			if (
				changes.kind === "delta" &&
				applyDelta(entry, feed, changes.delta, changes.bytes)
			)
				return;
			if (
				changes.kind === "splice" &&
				applySplice(entry, feed, changes.splice, changes.bytes)
			)
				return;
		}

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

	if (Date.now() - retry.failedAt < retryWait(retry.failures)) return;

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
		retryLatePart(origin);
	},
	libraryAnnounced: (origin, library) =>
		void recheckComponentLibrary(origin, library),
};
