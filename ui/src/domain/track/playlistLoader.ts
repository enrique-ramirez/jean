import {
	fetchPlaylistItemChanges,
	type PlaylistChanges,
	type PlaylistRuns,
	readPlaylistRuns,
} from "@/shared/api/playlists";
import { subscribers } from "@/shared/lib/store";
import { TRACK_EXPRESSIONS } from "./fields";
import { LIBRARY_ROLES } from "./libraryAsker";
import {
	type Hold,
	holdAfter,
	isDue,
	isFailureSaid,
	isSaid,
	isWaitingOnDeclaration,
	watchLibrary,
} from "./libraryHolds";
import { type LibrarySource, windowedPlaylistSourceOf } from "./librarySource";
import { windowedPlaylistRows } from "./playlistRows";
import { NO_VIEWPORT, type RowsViewport } from "./project";
import {
	isAnswered,
	type PlaylistList,
	type RowWindows,
	WINDOW_ROWS,
} from "./rowWindows";
import { hasDiscsInSight } from "./runsIndex";

interface HeldPlaylistRuns {
	structure: string;
	runs: PlaylistRuns;
	etag: string | null;
}

export interface PlaylistState {
	version: number;
	runs: HeldPlaylistRuns | null;
	hasDiscs: boolean;
	total: { structure: string; rows: number } | null;
	isOpened: boolean;
	failure: string | null;
}

export interface WindowedPlaylist {
	windows: RowWindows;
	source: Extract<LibrarySource, { kind: "playlist" }>;
	state: () => PlaylistState;
	subscribe: (listener: () => void) => () => void;
	// Where foo_jean reads a media library, its rows and runs wait for the library to hold Jean's
	// declaration: the album covers they name are resolved against its snapshot.
	show: (list: PlaylistList | null, readsLibrary: boolean) => void;
	announce: (structure: string, revision: string) => void;
	pageFailed: (message: string | null, isDefinite?: boolean) => void;
	carried: (from: string, to: string, order: ArrayLike<number> | null) => void;
	retryNow: () => void;
	answered: () => void;
	viewportOf: (list: PlaylistList) => RowsViewport;
}

interface Feed {
	structure: string;
	// Null until the first revision the player reports at a structure Jean carried rows to: foo_jean
	// keeps its changes per structure and has none for a structure it has just made.
	revision: string | null;
	isChecking: boolean;
	isBehind: boolean;
	isUnread: boolean;
}

const feedAt = (structure: string, revision: string | null): Feed => ({
	structure,
	revision,
	isChecking: false,
	isBehind: false,
	isUnread: false,
});

const rowOfChange = (
	changes: PlaylistChanges,
	at: number,
): Parameters<RowWindows["patch"]>[2] => {
	const item = changes.items[at];
	return {
		columns: changes.columns.map((column) => column.text[column.ids[at]] ?? ""),
		libraryPath: item.libraryPath,
		cover: item.cover,
		subsong: item.subsong,
	};
};

export function createWindowedPlaylist({
	origin,
	id,
	windows,
	isLibraryHeld,
}: {
	origin: string;
	id: string;
	windows: RowWindows;
	isLibraryHeld: () => boolean;
}): WindowedPlaylist {
	const listeners = subscribers();
	let state: PlaylistState = {
		version: 0,
		runs: null,
		hasDiscs: false,
		total: null,
		isOpened: false,
		failure: null,
	};
	let shown: PlaylistList | null = null;
	let readsLibrary = true;
	let sight: { list: PlaylistList; first: number; end: number } | null = null;
	let runs: HeldPlaylistRuns | null = null;
	let runsAsked: string | null = null;
	let runsMovedAt: string | null = null;
	let runsAreStale = false;
	let runsHold: Hold = { kind: "none" };
	let runsFailure: string | null = null;
	let pageFailure: string | null = null;
	let pageMisses = 0;
	let announced: { structure: string; revision: string } | null = null;
	let feed: Feed | null = null;
	let stopWatching: (() => void) | null = null;

	const isOpen = () => !readsLibrary || isLibraryHeld();

	const openViews = () => {
		if (!isOpen()) return;
		if (sight) windows.view(sight.list, sight.first, sight.end, 0);
		else if (shown) windows.view(shown, 0, 1, 0);
	};

	const hasDiscs = () => {
		if (!runs || !shown) return false;
		const rows = windowedPlaylistRows(windows, shown, NO_VIEWPORT, 0);
		for (let first = 0; first < shown.length; first += WINDOW_ROWS)
			if (
				!rows.isPending(first) &&
				hasDiscsInSight(runs.runs, rows, first, first + WINDOW_ROWS)
			)
				return true;
		return false;
	};

	const refresh = () => {
		const rows = shown ? windows.totalOf(id, shown.structure) : null;
		const total =
			shown && rows !== null ? { structure: shown.structure, rows } : null;
		if (
			windows.version() === state.version &&
			runs === state.runs &&
			(runsFailure ?? pageFailure) === state.failure &&
			total?.structure === state.total?.structure &&
			total?.rows === state.total?.rows
		)
			return;
		const runsMoved = runs !== state.runs;
		state = {
			version: windows.version(),
			runs,
			hasDiscs: !runsMoved && state.hasDiscs,
			total,
			isOpened: state.isOpened || total !== null,
			failure: runsFailure ?? pageFailure,
		};
		if (!state.hasDiscs && hasDiscs()) state = { ...state, hasDiscs: true };
		listeners.notify();
	};

	async function askRuns(structure: string) {
		if (runsAsked === structure || runsMovedAt === structure) return;
		const held = runs?.structure === structure ? runs : null;
		if (held && !runsAreStale) return;
		if (!isDue({ hold: runsHold })) return;
		runsAsked = structure;
		runsAreStale = false;
		const result = await readPlaylistRuns(
			origin,
			id,
			structure,
			LIBRARY_ROLES,
			held?.etag ?? undefined,
		).catch(() => null);
		if (runsAsked !== structure) return;
		runsAsked = null;

		if (result?.ok) {
			runsHold = { kind: "none" };
			runsFailure = null;
			if (!result.unchanged && result.runs.structure === structure) {
				runs = { structure, runs: result.runs, etag: result.etag };
				refresh();
			}
		} else if (result?.structureMoved) {
			runsMovedAt = structure;
		} else {
			if (held) runsAreStale = true;
			runsHold = holdAfter(
				runsHold,
				result?.reason ?? "unreachable",
				result?.retryAfterMs ?? null,
			);
			if (isFailureSaid(runsHold)) {
				runsFailure = result?.detail || result?.reason || "unreachable";
				refresh();
			}
		}
		if (runsAreStale || shown?.structure !== structure) consider();
	}

	function consider() {
		if (shown && isOpen() && isAnswered(shown.structure))
			void askRuns(shown.structure);
	}

	const listAt = (structure: string): PlaylistList => ({
		kind: "playlist",
		id,
		structure,
		length: shown?.length ?? 0,
	});

	function forget(current: Feed, canReask: boolean) {
		windows.drop({ kind: "playlist", id });
		current.revision =
			announced?.structure === current.structure ? announced.revision : null;
		runsAreStale = true;
		if (canReask && sight) windows.view(sight.list, sight.first, sight.end, 0);
		consider();
	}

	async function readChanges(current: Feed, since: string) {
		const result = await fetchPlaylistItemChanges(
			origin,
			id,
			current.structure,
			since,
			TRACK_EXPRESSIONS,
			{ roles: LIBRARY_ROLES },
		);
		if (feed !== current) return;

		if (!result.ok) {
			if (result.reason === "moved") {
				if (shown?.structure === current.structure) forget(current, false);
			} else if (result.reason === "gone") forget(current, true);
			else current.isUnread = true;
			return;
		}

		current.isUnread = false;
		const list = listAt(current.structure);
		const changes = result.value;
		changes.items.forEach((item, at) => {
			windows.patch(list, item.position, rowOfChange(changes, at));
		});
		current.revision = changes.revision;
	}

	async function follow(current: Feed) {
		if (current.isChecking) {
			current.isBehind = true;
			return;
		}
		current.isChecking = true;
		try {
			do {
				current.isBehind = false;
				const target =
					announced?.structure === current.structure
						? announced.revision
						: null;
				if (current.revision === null || target === null) break;
				if (current.revision === target) break;
				await readChanges(current, current.revision);
			} while (current.isBehind && feed === current);
		} finally {
			current.isChecking = false;
		}
	}

	const onLibrary = () => {
		if (isWaitingOnDeclaration(runsHold)) runsHold = { kind: "none" };
		openViews();
		consider();
	};

	const viewports = new WeakMap<PlaylistList, RowsViewport>();

	return {
		windows,
		source: windowedPlaylistSourceOf({
			windows,
			origin,
			id,
			listNow: () => shown,
		}),
		state: () => state,

		subscribe: (listener) => {
			const stop = listeners.subscribe(listener);
			if (listeners.size === 1) {
				const stopWindows = windows.subscribe(refresh);
				const stopLibrary = watchLibrary(origin, {
					exported: onLibrary,
					announced: onLibrary,
					answered: () => {},
				});
				stopWatching = () => {
					stopWindows();
					stopLibrary();
				};
				refresh();
			}
			consider();
			return () => {
				stop();
				if (listeners.size > 0) return;
				stopWatching?.();
				stopWatching = null;
			};
		},

		show: (list, reads) => {
			if (shown && !list) windows.leave(shown);
			shown = list;
			readsLibrary = reads;
			openViews();
			consider();
			refresh();
		},

		pageFailed: (message, isDefinite = false) => {
			pageMisses = message === null ? 0 : pageMisses + 1;
			const shown = message !== null && isSaid(pageMisses, isDefinite);
			const next = shown ? message : null;
			if (next === pageFailure) return;
			pageFailure = next;
			refresh();
		},

		announce: (structure, revision) => {
			announced = { structure, revision };
			if (feed?.structure !== structure) {
				feed = feedAt(structure, revision);
				return;
			}
			if (feed.revision === null) {
				feed.revision = revision;
				return;
			}
			if (feed.revision === revision) return;
			runsAreStale = true;
			consider();
			void follow(feed);
		},

		retryNow: () => {
			runsHold = { kind: "none" };
			runsFailure = null;
			pageFailure = null;
			pageMisses = 0;
			runsAsked = null;
			runsMovedAt = null;
			runsAreStale = true;
			refresh();
			openViews();
			consider();
		},

		answered: () => {
			if (listeners.size === 0) return;
			if (feed?.isUnread) void follow(feed);
			openViews();
			consider();
		},

		carried: (from, to, order) => {
			if (order) windows.carry(id, from, to, order);
			else windows.rename(id, from, to);
			if (isAnswered(to))
				feed = feedAt(
					to,
					announced?.structure === to ? announced.revision : null,
				);
		},

		viewportOf: (list) => {
			let viewport = viewports.get(list);
			if (!viewport) {
				viewport = {
					watch: (first, end, direction) => {
						sight = { list, first, end };
						if (isOpen()) windows.view(list, first, end, direction);
					},
					leave: () => {
						windows.leave(list);
						if (sight?.list === list) sight = null;
					},
				};
				viewports.set(list, viewport);
			}
			return viewport;
		},
	};
}
