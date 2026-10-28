import { libraryArtworkUrl } from "@/shared/api/artwork";
import type { Failure, Schema } from "@/shared/api/client";
import {
	type RowSet,
	type RowsFailure,
	type RowsResult,
	type RowsWindow,
	readRows,
	readRuns,
} from "@/shared/api/libraryRows";
import { fetchPlaylistRows } from "@/shared/api/playlists";
import { type ReadFailure, readFailed } from "@/shared/api/readFailure";
import type { StateDocument } from "@/shared/api/state";
import type { TrackColumns } from "@/shared/api/types";
import { subscribers } from "@/shared/lib/store";
import { recordWindowAvailability } from "./fieldAvailability";
import { EMPTY_COLUMNS, TRACK_EXPRESSIONS } from "./fields";
import { LIBRARY_ROLES, onlyRatingMoved } from "./libraryAsker";
import {
	announcedLibraryOf,
	type Hold,
	holdAfter,
	holdsDeclaration,
	isDue,
	isWaitingOnDeclaration,
	libraryEvents,
	watchLibrary,
} from "./libraryHolds";
import { type LibrarySource, windowedSourceOf } from "./librarySource";
import {
	componentLibraryKey,
	emit,
	entryFor,
	subscribePlaylist,
} from "./playlistEntries";
import {
	createWindowedPlaylist,
	type WindowedPlaylist,
} from "./playlistLoader";
import {
	NO_VIEWPORT,
	type RowsViewport,
	rowInWindow,
	windowedRows,
} from "./project";
import {
	createRowWindows,
	type LibraryList,
	type RowsTransport,
	type RowWindows,
	trackPathAt,
	WINDOW_ROWS,
} from "./rowWindows";
import { hasDiscsInSight, runIndexAt, runStartsOf } from "./runsIndex";

type Announced = StateDocument["library"];
type LibraryRuns = Schema["LibraryRuns"];

export interface HeldRuns {
	structure: number;
	runs: LibraryRuns;
	etag: string | null;
}

export interface WindowedState {
	list: LibraryList | null;
	version: number;
	runs: HeldRuns | null;
	hasDiscs: boolean;
}

export interface TileRow {
	columns: TrackColumns;
	artworkUrl: string | null;
}

const GIVE_UP_MS = 4_000;

export interface WindowedLibrary {
	windows: RowWindows;
	playlistOf: (id: string) => WindowedPlaylist;
	source: Extract<LibrarySource, { kind: "library" }>;
	state: () => WindowedState;
	start: () => void;
	watchPlaying: (ordinal: number) => () => void;
	coverUrlOf: (ordinal: number) => string | null;
	subscribe: (listener: () => void) => () => void;
	hold: () => Hold;
	watchHold: (listener: () => void) => () => void;
	retryNow: () => void;
	readTileRows: (
		structure: number,
		ordinals: number[],
		afterViewport: boolean,
		signal: AbortSignal,
	) => Promise<TileRow[] | null>;
	viewportOf: (list: LibraryList) => RowsViewport;
}

const startsOf = (held: HeldRuns) => runStartsOf(held.runs.lengths);

const runAt = (held: HeldRuns, ordinal: number) =>
	runIndexAt(startsOf(held), ordinal);

function coverIn(held: HeldRuns | null, ordinal: number): number | null {
	if (!held) return null;
	const run = runAt(held, ordinal);
	return run < 0 ? null : held.runs.covers[run];
}

function coversInSight(
	held: HeldRuns,
	list: LibraryList,
	first: number,
	end: number,
): number[] {
	const starts = startsOf(held);
	const { lengths, covers } = held.runs;
	const seen = new Set<number>();
	let run = -1;

	const last = Math.min(end, list.length);
	const windowsFrom =
		Math.floor(Math.max(0, first) / WINDOW_ROWS) * WINDOW_ROWS;
	const windowsTo = Math.min(
		list.length,
		(Math.floor((Math.max(first, last) - 1) / WINDOW_ROWS) + 1) * WINDOW_ROWS,
	);
	const shown = new Set<number>();
	if (list.ordinals)
		for (let position = windowsFrom; position < windowsTo; position += 1)
			shown.add(list.ordinals[position]);

	for (let position = Math.max(0, first); position < last; position += 1) {
		const ordinal = list.ordinals ? list.ordinals[position] : position;
		if (
			run < 0 ||
			ordinal < starts[run] ||
			ordinal >= starts[run] + lengths[run]
		)
			run = runAt(held, ordinal);
		if (run < 0) continue;
		seen.add(covers[run]);
		if (!list.ordinals)
			position = Math.min(starts[run] + lengths[run], last) - 1;
	}
	return [...seen].filter((cover) =>
		list.ordinals
			? !shown.has(cover)
			: cover < windowsFrom || cover >= windowsTo,
	);
}

const pageFailure = (
	failure: ReadFailure,
	structureMoved = false,
): RowsFailure => ({ ...failure, structureMoved, building: null });

const pageFailureOf = (failure: Failure): RowsFailure => {
	if (failure.reason === "unreachable")
		return pageFailure(readFailed("unreachable"));
	return pageFailure(
		failure.status === 429
			? readFailed("tooFast", failure.message, failure.retryInMs)
			: readFailed("failed", failure.message),
	);
};

const UNBUILT_TICKS = 3;

const LENT = {};

const NO_HOLD: Hold = { kind: "none" };

const isKept = (hold: Hold) =>
	hold.kind === "refused" || hold.kind === "failing";

function create(origin: string): WindowedLibrary {
	const listeners = subscribers();
	let announced: Announced | null = announcedLibraryOf(origin);
	let state: WindowedState = {
		list: null,
		version: 0,
		runs: null,
		hasDiscs: false,
	};
	let runs: HeldRuns | null = null;
	let runsAsked: number | null = null;
	let runsAreStale = false;
	let runsHold: Hold = { kind: "none" };
	let declareHold: Hold = { kind: "none" };
	const holdListeners = subscribers();
	let heldHold: Hold = NO_HOLD;
	let declaring = false;
	let declaredFor: string | null = null;
	let isStarted = false;
	let unbuiltTicks = 0;
	let answeredAt: number | null = null;
	let rowsInFlight = 0;
	let viewportMadeAt: number | null = null;
	let sight: { list: LibraryList; first: number; end: number } | null = null;
	let viewportAsked = false;
	let viewportWaiters: (() => void)[] = [];

	const rowsLanded = (window: RowsWindow) => {
		answeredAt = window.structure;
		recordWindowAvailability(window.columns);
		libraryEvents.exported(origin);
	};

	const counted = async <Result>(read: Promise<Result>) => {
		rowsInFlight += 1;
		try {
			return await read;
		} finally {
			rowsInFlight -= 1;
		}
	};

	const namesViewportsFirstRow = (set: RowSet) => {
		if (!sight) return false;
		const { list, first } = sight;
		const ordinal = list.ordinals ? list.ordinals[first] : first;
		return "runs" in set
			? set.runs.some(
					([start, length]) => ordinal >= start && ordinal < start + length,
				)
			: set.ordinals.includes(ordinal);
	};

	const transport: RowsTransport = {
		readRows: async (ask, signal) => {
			if (namesViewportsFirstRow(ask.set)) {
				viewportAsked = true;
				releaseViewportWaiters();
			}
			const result = await counted(
				readRows(origin, { columns: TRACK_EXPRESSIONS, ...ask }, signal),
			);
			if (result.ok) rowsLanded(result.window);
			return result;
		},
		readPage: async (ask, signal) => {
			const result = await fetchPlaylistRows(
				origin,
				ask.id,
				ask.rows,
				TRACK_EXPRESSIONS,
				{ signal, roles: LIBRARY_ROLES },
			);
			if (!result.ok) {
				const failure = pageFailureOf(result);
				if (failure.reason !== "tooFast")
					playlists
						.get(ask.id)
						?.pageFailed(
							failure.detail || failure.reason,
							result.reason === "refused" &&
								result.status < 500 &&
								result.status !== 429,
						);
				return failure;
			}
			playlists.get(ask.id)?.pageFailed(null);
			// The route names no structure, so a page can answer one other than the structure asked.
			if (result.value.structure !== ask.structure)
				return pageFailure(readFailed("refused"), true);
			return { ok: true, page: result.value };
		},
	};

	const windows = createRowWindows(transport);

	const listOf = (library: Announced | null): LibraryList | null => {
		if (!library || !holdsDeclaration(library)) return null;
		const held = state.list;
		if (
			held?.structure === library.structure &&
			held.length === library.trackCount
		)
			return held;
		return {
			kind: "library",
			id: "library",
			structure: library.structure,
			length: library.trackCount,
			ordinals: null,
		};
	};

	const key = componentLibraryKey(origin);

	const lend = () => {
		const entry = entryFor(key);
		const isLent = entry.snapshot.columns.load === LENT;
		const { list } = state;
		if (entry.isStarted || !list) {
			if (isLent)
				emit(entry, {
					columns: EMPTY_COLUMNS,
					structure: 0,
					loaded: 0,
					total: 0,
				});
			return;
		}
		if (
			isLent &&
			entry.snapshot.structure === list.structure &&
			entry.snapshot.columns.trackCount === list.length
		)
			return;
		emit(entry, {
			columns: {
				load: LENT,
				trackCount: list.length,
				fields: EMPTY_COLUMNS.fields,
			},
			structure: list.structure,
			loaded: list.length,
			total: list.length,
			isLoading: false,
		});
	};

	let coverList: LibraryList | null = null;

	const watchCovers = () => {
		const { list, runs: held } = state;
		const wanted =
			sight && list && held
				? coversInSight(held, sight.list, sight.first, sight.end)
				: [];
		if (list && wanted.length > 0) {
			coverList = {
				kind: "library",
				id: "covers",
				structure: list.structure,
				length: wanted.length,
				ordinals: wanted,
			};
			windows.view(coverList, 0, wanted.length, 0);
			return;
		}
		if (coverList) windows.leave(coverList);
		coverList = null;
	};

	const playingOrdinals = new Map<number, number>();
	let playingList: LibraryList | null = null;
	let playingKey = "";

	const watchPlayingCovers = () => {
		const { list, runs: held } = state;
		const covers = new Set<number>();
		if (list && held)
			for (const ordinal of playingOrdinals.keys()) {
				const cover = coverIn(held, ordinal);
				if (cover !== null) covers.add(cover);
			}
		const wanted = [...covers];
		const wantedKey = list ? `${list.structure}:${wanted.join(",")}` : "";
		if (wantedKey === playingKey) return;

		playingKey = wantedKey;
		if (playingList) windows.leave(playingList);
		playingList = null;
		if (!list || wanted.length === 0) return;
		playingList = {
			kind: "library",
			id: "playing",
			structure: list.structure,
			length: wanted.length,
			ordinals: wanted,
		};
		windows.view(playingList, 0, wanted.length, 0);
	};

	const discsInSight = (): boolean => {
		const { runs: held } = state;
		if (!held || !sight || sight.list.ordinals) return false;

		return hasDiscsInSight(
			held.runs,
			windowedRows(windows, sight.list, NO_VIEWPORT),
			sight.first,
			sight.end,
		);
	};

	const refresh = () => {
		const list = listOf(announced);
		const current = runs?.structure === list?.structure ? runs : null;
		if (
			list === state.list &&
			windows.version() === state.version &&
			current === state.runs
		)
			return;
		const runsMoved = current !== state.runs;
		const listMoved = list !== state.list;
		state = {
			list,
			version: windows.version(),
			runs: current,
			hasDiscs: !runsMoved && state.hasDiscs,
		};
		if (!state.hasDiscs && discsInSight()) state = { ...state, hasDiscs: true };
		if (runsMoved && sight) watchCovers();
		if (runsMoved || listMoved) watchPlayingCovers();
		lend();
		listeners.notify();
	};

	const declareForFacts = (library: Announced) => {
		if (!state.list) return void declare(library);

		// Whether a list is coming is known once React has drawn the route, after the microtasks it queued.
		queueMicrotask(() => {
			const now = announced;
			if (!now || !state.list || answeredAt === now.structure) return;
			if (rowsInFlight > 0) return;
			if (viewportMadeAt !== now.structure) return void declare(now);

			setTimeout(() => {
				if (announced && answeredAt !== announced.structure && !rowsInFlight)
					void declare(announced);
			}, GIVE_UP_MS);
		});
	};

	const isDeclarationComing = () =>
		declaring ||
		(!!announced?.ready &&
			!announced.halted &&
			(!!announced.build || isDue({ hold: declareHold })));

	async function declare(library: Announced) {
		if (declaring || library.build || library.halted) return;
		if (!isDue({ hold: declareHold })) return;
		const marker = JSON.stringify([
			library.ready,
			library.structure,
			library.columns,
		]);
		if (marker === declaredFor) return;

		declaring = true;
		declaredFor = marker;
		// foo_jean declares through a rows request, and a set of no rows is the cheapest one.
		const result = await windows
			.run(
				{ kind: "library" },
				() =>
					counted(
						readRows(origin, {
							columns: TRACK_EXPRESSIONS,
							structure: library.structure,
							set: { runs: [] },
						}),
					),
				// The declaration keeps its own hold, and a `202` while the library builds is not a miss.
				{ holds: false },
			)
			.catch(() => null);
		declaring = false;
		if (result?.ok) {
			declareHold = NO_HOLD;
			holdMoved();
			return rowsLanded(result.window);
		}
		if (result?.reason === "notReady") return;
		declaredFor = null;
		if (result?.structureMoved) return;
		declareHold = holdAfter(
			declareHold,
			result?.reason ?? "unreachable",
			result?.retryAfterMs ?? null,
			result?.detail,
		);
		holdMoved();
	}

	async function askRuns(structure: number) {
		if (runsAsked === structure) return;
		const held = runs?.structure === structure ? runs : null;
		if (held && !runsAreStale) return;
		if (!isDue({ hold: runsHold })) return;
		runsAsked = structure;
		runsAreStale = false;
		const result = await readRuns(
			origin,
			LIBRARY_ROLES,
			held?.etag ?? undefined,
		).catch(() => null);
		if (runsAsked !== structure) return;
		runsAsked = null;

		if (result?.ok) {
			runsHold = { kind: "none" };
			holdMoved();
			if (!result.unchanged && result.runs.structure === structure) {
				runs = { structure, runs: result.runs, etag: result.etag };
				refresh();
			}
		} else {
			if (held) runsAreStale = true;
			runsHold = holdAfter(
				runsHold,
				result?.reason ?? "unreachable",
				result?.retryAfterMs ?? null,
				result?.detail,
			);
			holdMoved();
		}
		if (runsAreStale || state.list?.structure !== structure) consider();
	}

	const holdMoved = () => {
		const now = [declareHold, runsHold].find(isKept) ?? NO_HOLD;
		if (now === heldHold) return;
		heldHold = now;
		holdListeners.notify();
	};

	const consider = () => {
		if (listeners.size === 0) return;
		const { list } = state;
		if (list) return void askRuns(list.structure);
		if (announced) void declare(announced);
	};

	watchLibrary(origin, {
		exported: () => {
			if (isWaitingOnDeclaration(runsHold)) runsHold = { kind: "none" };
			holdMoved();
			consider();
		},
		announced: (library) => {
			const before = announced;
			announced = library;
			if (
				before &&
				before.structure === library.structure &&
				before.revision !== library.revision
			) {
				if (!onlyRatingMoved(before, library)) runsAreStale = true;
				windows.markStale({ kind: "library" });
			}
			if (isWaitingOnDeclaration(runsHold)) runsHold = { kind: "none" };
			holdMoved();
			refresh();
			consider();
			if (!isStarted) return;
			declareForFacts(library);
		},
		answered: () => {
			if (listOf(announced) !== null) unbuiltTicks = 0;
			else if (!isDeclarationComing()) unbuiltTicks += 1;
			windows.answered();
			consider();
			for (const playlist of playlists.values()) playlist.answered();
		},
	});

	const heldTileRows = (structure: number, ordinals: number[]) => {
		const tiles: LibraryList = {
			kind: "library",
			id: "tiles",
			structure,
			length: ordinals.length,
			ordinals,
		};
		const rows: TileRow[] = [];
		for (let position = 0; position < ordinals.length; position += 1) {
			const row = windows.at(tiles, position);
			if (row?.kind !== "library") return null;
			rows.push({
				columns: rowInWindow(row.window, row.row),
				artworkUrl: libraryArtworkUrl(origin, trackPathAt(row.window, row.row)),
			});
		}
		return rows;
	};

	const isFirstWindowHeld = () =>
		sight !== null && windows.at(sight.list, sight.first) !== null;

	function releaseViewportWaiters() {
		if (!viewportAsked && !isFirstWindowHeld()) return;
		const released = viewportWaiters;
		viewportWaiters = [];
		for (const release of released) release();
	}

	const waitForViewport = (signal: AbortSignal) =>
		new Promise<void>((resolve) => {
			if (viewportAsked || isFirstWindowHeld() || signal.aborted)
				return resolve();

			const timer = setTimeout(done, GIVE_UP_MS);
			function done() {
				clearTimeout(timer);
				viewportWaiters = viewportWaiters.filter((one) => one !== done);
				signal.removeEventListener("abort", done);
				resolve();
			}
			viewportWaiters.push(done);
			signal.addEventListener("abort", done, { once: true });
		});

	windows.subscribe(() => {
		refresh();
		releaseViewportWaiters();
	});
	subscribePlaylist(key, lend);
	refresh();

	const viewports = new WeakMap<LibraryList, RowsViewport>();
	const playlists = new Map<string, WindowedPlaylist>();

	return {
		windows,
		playlistOf: (id) => {
			let playlist = playlists.get(id);
			if (!playlist) {
				playlist = createWindowedPlaylist({
					origin,
					id,
					windows,
					isLibraryHeld: () =>
						listOf(announced) !== null ||
						announced?.halted === true ||
						unbuiltTicks >= UNBUILT_TICKS,
				});
				playlists.set(id, playlist);
			}
			return playlist;
		},
		source: windowedSourceOf({
			windows,
			origin,
			listNow: () => state.list,
			coverOf: (ordinal) => coverIn(state.runs, ordinal),
		}),
		state: () => state,
		start: () => {
			isStarted = true;
			if (!announced) return;
			declareForFacts(announced);
		},
		watchPlaying: (ordinal) => {
			playingOrdinals.set(ordinal, (playingOrdinals.get(ordinal) ?? 0) + 1);
			watchPlayingCovers();
			return () => {
				const left = (playingOrdinals.get(ordinal) ?? 1) - 1;
				if (left > 0) playingOrdinals.set(ordinal, left);
				else playingOrdinals.delete(ordinal);
				watchPlayingCovers();
			};
		},
		coverUrlOf: (ordinal) => {
			const cover = coverIn(state.runs, ordinal);
			const { list } = state;
			if (cover === null || !list) return null;
			const held = windows.at(list, cover);
			if (held?.kind !== "library") return null;
			return libraryArtworkUrl(origin, trackPathAt(held.window, held.row));
		},
		subscribe: (listener) => {
			const stop = listeners.subscribe(listener);
			consider();
			return stop;
		},
		hold: () => heldHold,
		watchHold: (listener) => holdListeners.subscribe(listener),
		retryNow: () => {
			windows.clearHolds();
			for (const playlist of playlists.values()) playlist.retryNow();
			runsHold = NO_HOLD;
			declareHold = NO_HOLD;
			declaredFor = null;
			runsAsked = null;
			runsAreStale = true;
			holdMoved();
			consider();
		},
		readTileRows: async (structure, ordinals, afterViewport, signal) => {
			const held = heldTileRows(structure, ordinals);
			if (held) return held;

			if (afterViewport) await waitForViewport(signal);

			let result: RowsResult | null = null;
			while (!signal.aborted) {
				result = await windows.run(
					{ kind: "library" },
					() =>
						counted(
							readRows(
								origin,
								{ columns: TRACK_EXPRESSIONS, structure, set: { ordinals } },
								signal,
							),
						),
					{ signal },
				);
				if (result.ok || result.structureMoved || result.reason === "refused")
					break;
			}
			if (!result?.ok) return null;

			const { window } = result;
			rowsLanded(window);
			const rows = ordinals.map((ordinal) => window.ordinals.indexOf(ordinal));
			if (rows.some((row) => row < 0)) return null;
			return rows.map((row) => ({
				columns: rowInWindow(window, row),
				artworkUrl: libraryArtworkUrl(origin, trackPathAt(window, row)),
			}));
		},
		viewportOf: (list) => {
			let viewport = viewports.get(list);
			if (!viewport) {
				viewportMadeAt = list.structure;
				viewport = {
					watch: (first, end, direction) => {
						if (sight?.list !== list) viewportAsked = false;
						sight = { list, first, end };
						windows.view(list, first, end, direction);
						releaseViewportWaiters();
						watchCovers();
						if (!state.hasDiscs && discsInSight()) {
							state = { ...state, hasDiscs: true };
							listeners.notify();
						}
					},
					leave: () => {
						windows.leave(list);
						if (sight?.list !== list) return;
						sight = null;
						watchCovers();
					},
				};
				viewports.set(list, viewport);
			}
			return viewport;
		},
	};
}

const held = new Map<string, WindowedLibrary>();

export function windowedLibraryOf(origin: string): WindowedLibrary {
	let library = held.get(origin);
	if (!library) {
		library = create(origin);
		held.set(origin, library);
	}
	return library;
}
