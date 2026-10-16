import type { LibraryFailure } from "@/shared/api/fooJeanLibrary";
import type { JlibSnapshot } from "@/shared/api/jlib";
import { fetchStatus } from "@/shared/api/status";
import { inSlices, type Steps } from "@/shared/lib/idle";
import { recordFieldAvailability } from "./fieldAvailability";
import {
	artistGroups,
	FIELD,
	LATE_FIELDS,
	TRACK_EXPRESSIONS,
	tagGroups,
} from "./fields";
import { canonicalTrackRefs, groupByAlbum } from "./grouping";
import { type Intensity, intensitySteps } from "./intensity";
import { readKeepLibrary } from "./keepLibrary";
import { landingWorkSteps } from "./landingWork";
import { isLoaded, type LibraryColumns } from "./libraryColumns";
import { librarySearcher } from "./librarySearcher";
import {
	type LibrarySnapshot,
	librarySnapshotOf,
	withLatePart,
	withSettledLatePart,
} from "./librarySnapshot";
import {
	type KeepNote,
	LIBRARY_FORMAT,
	type LibraryPair,
} from "./libraryStore";
import {
	type Entry,
	emit,
	generationKey,
	type LibraryFeed,
} from "./playlistEntries";
import { wholeRows } from "./project";

const apiVersions = new Map<string, Promise<number | null>>();

export function apiVersionOf(origin: string) {
	let asked = apiVersions.get(origin);
	if (!asked) {
		asked = fetchStatus(origin).then(
			(status) => (status.ok ? status.value.apiVersion : null),
			() => null,
		);
		apiVersions.set(origin, asked);
		void asked.then((version) => {
			if (version === null) apiVersions.delete(origin);
		});
	}
	return asked;
}

export function noteFor(
	apiVersion: number | null,
	pair: LibraryPair,
	isWhole: boolean,
) {
	if (apiVersion === null || !readKeepLibrary()) return undefined;
	return {
		declaration: TRACK_EXPRESSIONS,
		format: LIBRARY_FORMAT,
		apiVersion,
		...pair,
		isWhole,
	} satisfies KeepNote;
}

export function keepNote(feed: LibraryFeed, columns: LibraryColumns) {
	return noteFor(
		feed.apiVersion,
		{
			snapshotId: feed.snapshotId,
			trackCount: columns.trackCount,
			structure: feed.structure,
			revision: feed.revision,
		},
		isLoaded(columns, LATE_FIELDS),
	);
}

export function showColumns(columns: LibraryColumns) {
	recordFieldAvailability(columns);
	librarySearcher()?.mirror(columns);
}

function* firstFrameSteps(
	columns: LibraryColumns,
	key: string,
): Steps<Intensity> {
	yield* tagGroups.steps(columns.fields[FIELD.album]);
	yield* artistGroups.steps(columns);
	yield* canonicalTrackRefs.steps(columns);
	yield* groupByAlbum.steps(wholeRows(columns));
	const intensity = yield* intensitySteps(columns);
	yield* landingWorkSteps(columns, key);
	return intensity;
}

export async function landLibrary(
	entry: Entry,
	feed: LibraryFeed,
	{ columns, paths, subsongs }: LibrarySnapshot,
	toWorker: () => void,
	signal: AbortSignal,
) {
	const intensity = await inSlices(
		firstFrameSteps(columns, generationKey(entry.key, feed.structure)),
		signal,
	);
	entry.feed = feed;
	entry.libraryRetry = null;
	toWorker();
	showColumns(columns);
	emit(entry, {
		columns,
		structure: feed.structure,
		paths,
		subsongs,
		loaded: columns.trackCount,
		total: columns.trackCount,
		isLoading: false,
		error: null,
		failure: null,
		...intensity,
	});
}

export async function landExport(
	entry: Entry,
	{ library, bytes }: { library: JlibSnapshot; bytes: ArrayBuffer },
	apiVersion: number | null,
	signal: AbortSignal,
) {
	const snapshot = librarySnapshotOf(library, TRACK_EXPRESSIONS);
	const feed: LibraryFeed = {
		kind: "library",
		structure: library.structure,
		revision: library.revision,
		snapshotId: library.snapshotId,
		apiVersion,
		spine: snapshot.spine,
		isChecking: false,
	};

	await landLibrary(
		entry,
		feed,
		snapshot,
		() =>
			librarySearcher()?.load(bytes.slice(0), keepNote(feed, snapshot.columns)),
		signal,
	);
	return snapshot;
}

export type Joined = "joined" | "restarted" | "failed";

export async function landLatePart(
	entry: Entry,
	feed: LibraryFeed,
	part: LibraryColumns,
	bytes: ArrayBuffer,
	patches: ArrayBuffer[],
	signal: AbortSignal,
): Promise<Joined> {
	const columns = withLatePart(entry.snapshot.columns, part);
	if (!columns) return "failed";

	await inSlices(
		landingWorkSteps(columns, generationKey(entry.key, feed.structure)),
		signal,
	);
	librarySearcher()?.part(bytes.slice(0), patches, keepNote(feed, columns));
	showColumns(columns);
	emit(entry, { columns });
	return "joined";
}

export async function landSettledLatePart(
	entry: Entry,
	failure: LibraryFailure,
	signal: AbortSignal,
) {
	const columns = withSettledLatePart(entry.snapshot.columns);
	await inSlices(
		landingWorkSteps(
			columns,
			generationKey(entry.key, entry.snapshot.structure),
		),
		signal,
	);
	librarySearcher()?.settle();
	showColumns(columns);
	emit(entry, { columns, failure });
}
