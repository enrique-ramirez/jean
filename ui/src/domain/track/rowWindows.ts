import { runsOf } from "@/shared/api/fillEncoding";
import type {
	RowSet,
	RowsFailure,
	RowsResult,
	RowsWindow,
} from "@/shared/api/libraryRows";
import type { PlaylistPage } from "@/shared/api/playlists";
import { readFailed } from "@/shared/api/readFailure";
import { subscribers } from "@/shared/lib/store";
import { type Hold, holdAfter, isDue, now } from "./libraryHolds";
import type { Refs } from "./project";

export const WINDOW_ROWS = 2048;
export const PREFETCH_ROWS = 512;
export const HELD_WINDOWS = 32;

const PACING_MS = 100;

type RowsSource = { kind: "library" } | { kind: "playlist"; id: string };

export type RowsList =
	| {
			kind: "library";
			id: string;
			structure: number;
			length: number;
			ordinals: Refs | null;
	  }
	| { kind: "playlist"; id: string; structure: string; length: number };

export type LibraryList = Extract<RowsList, { kind: "library" }>;
export type PlaylistList = Extract<RowsList, { kind: "playlist" }>;

// foo_jean's playlist `structure` is a run of decimal digits; any other string is an order Jean has
// drawn ahead of the write that makes it, and no page is asked at it.
export const provisionalStructure = (serial: number) => `~${serial}`;
export const isAnswered = (structure: string) => /^\d+$/.test(structure);

type PageResult = { ok: true; page: PlaylistPage } | RowsFailure;

export interface RowsTransport {
	readRows: (
		ask: { structure: number; set: RowSet },
		signal?: AbortSignal,
	) => Promise<RowsResult>;
	readPage: (
		ask: { id: string; structure: string; offset: number; count: number },
		signal?: AbortSignal,
	) => Promise<PageResult>;
}

type HeldRow =
	| { kind: "library"; window: RowsWindow; row: number }
	| { kind: "playlist"; page: PlaylistPage; row: number };

export const trackPathAt = ({ spine }: RowsWindow, row: number) =>
	spine.directory.at(row) + spine.filename.at(row);

export interface RowWindows {
	view(list: RowsList, first: number, end: number, direction: -1 | 0 | 1): void;
	leave(list: RowsList): void;
	at(list: RowsList, position: number): HeldRow | null;
	markStale(source: RowsSource): void;
	drop(source: RowsSource): void;
	patch(
		list: PlaylistList,
		position: number,
		item: PlaylistPage["items"][number],
	): boolean;
	// `order[newPosition]` is the position the row held before, as foo_jean answers a move, remove or sort.
	carry(id: string, from: string, to: string, order: ArrayLike<number>): void;
	rename(id: string, from: string, to: string): void;
	totalOf(id: string, structure: string): number | null;
	answered(): void;
	run<Result extends RowsResult>(
		source: RowsSource,
		read: () => Promise<Result>,
		options?: { signal?: AbortSignal; holds?: boolean },
	): Promise<Result | RowsFailure>;
	clearHolds(): void;
	subscribe(listener: () => void): () => void;
	version(): number;
}

interface Piece {
	stale: boolean;
	stamp: number;
}

interface LibraryPiece extends Piece {
	kind: "library";
	window: RowsWindow;
	rowOf: (ordinal: number) => number;
	live: number;
}

interface PlaylistPiece extends Piece {
	kind: "playlist";
	id: string;
	structure: string;
	offset: number;
	page: PlaylistPage;
}

type AnyPiece = LibraryPiece | PlaylistPiece;

interface View {
	list: RowsList;
	first: number;
	last: number;
	direction: -1 | 0 | 1;
	order: number;
}

type Ask =
	| {
			kind: "library";
			list: LibraryList;
			set: RowSet;
	  }
	| { kind: "playlist"; list: PlaylistList; window: number };

interface Out {
	ask: Ask;
	source: string;
	generation: number;
	staleEpoch: number;
}

const LIBRARY = "library";
const playlistSource = (id: string) => `playlist:${id}`;
const sourceOf = (list: RowsList | RowsSource) =>
	list.kind === "library" ? LIBRARY : playlistSource(list.id);
const viewKeyOf = (list: RowsList) => `${list.kind}:${list.id}`;
const pieceKeyOf = (id: string, structure: string, window: number) =>
	`${id}\u0000${structure}\u0000${window}`;

const OTHERS = "others" as const;

const NO_HOLD: Hold = { kind: "none" };

const unreachable = (): RowsFailure => ({
	...readFailed("unreachable"),
	structureMoved: false,
	building: null,
});

const windowOf = (position: number) => Math.floor(position / WINDOW_ROWS);

const rowReader = (ordinals: Int32Array): ((ordinal: number) => number) => {
	const first = ordinals[0];
	const rows = ordinals.length;
	if (ordinals.every((ordinal, row) => ordinal === first + row))
		return (ordinal) => {
			const row = ordinal - first;
			return row >= 0 && row < rows ? row : -1;
		};
	const rowOfOrdinal = new Map<number, number>();
	ordinals.forEach((ordinal, row) => {
		rowOfOrdinal.set(ordinal, row);
	});
	return (ordinal) => rowOfOrdinal.get(ordinal) ?? -1;
};

function windowsFor({ list, first, last, direction }: View) {
	if (list.length <= 0) return [];
	const count = windowOf(list.length - 1) + 1;
	const top = Math.max(0, first);
	const bottom = Math.max(top, Math.min(last, list.length) - 1);
	const firstWindow = windowOf(top);
	const lastWindow = windowOf(bottom);
	const windows: number[] = [];
	for (let window = firstWindow; window <= lastWindow; window += 1)
		windows.push(window);
	if (direction > 0 && lastWindow + 1 < count) {
		if ((lastWindow + 1) * WINDOW_ROWS - last <= PREFETCH_ROWS)
			windows.push(lastWindow + 1);
	}
	if (direction < 0 && firstWindow > 0) {
		if (top - firstWindow * WINDOW_ROWS <= PREFETCH_ROWS)
			windows.push(firstWindow - 1);
	}
	return windows;
}

type FailureMeaning =
	| { structureMoved: true }
	| { structureMoved: false; hold: Hold };

function meaningOf(hold: Hold, failure: RowsFailure): FailureMeaning {
	if (failure.structureMoved) return { structureMoved: true };
	return {
		structureMoved: false,
		hold: holdAfter(
			hold,
			failure.reason === "tooFast" ? "tooFast" : "failed",
			failure.retryAfterMs,
		),
	};
}

export function createRowWindows(transport: RowsTransport): RowWindows {
	const listeners = subscribers();
	let version = 0;
	const changed = () => {
		version += 1;
		listeners.notify();
	};

	const pieces = new Set<AnyPiece>();
	const libraryIndex = new Map<number, LibraryPiece>();
	const playlistPieces = new Map<string, PlaylistPiece>();
	const views = new Map<string, View>();

	let libraryStructure: number | null = null;
	let refusedLibrary: number | null = null;
	const refusedPlaylists = new Set<string>();
	const playlistStructures = new Map<string, string>();
	const generations = new Map<string, number>();
	const staleEpochs = new Map<string, number>();

	let tick = 0;
	let inFlight: Out | typeof OTHERS | null = null;
	let lastSentAt = Number.NEGATIVE_INFINITY;
	const holds = new Map<string, { hold: Hold; isReleased: boolean }>();
	interface Extra {
		source: string;
		holds: boolean;
		signal?: AbortSignal;
		read: () => Promise<RowsResult>;
		settle: (result: RowsResult) => void;
	}
	const readsOfOthers: Extra[] = [];
	let timer: ReturnType<typeof setTimeout> | null = null;

	const counter = (counts: Map<string, number>, source: string) =>
		counts.get(source) ?? 0;
	const bump = (counts: Map<string, number>, source: string) => {
		counts.set(source, counter(counts, source) + 1);
	};

	const ordinalAt = (list: LibraryList, position: number) =>
		list.ordinals ? list.ordinals[position] : position;

	const libraryPieceAt = (list: LibraryList, position: number) =>
		list.structure === libraryStructure
			? libraryIndex.get(ordinalAt(list, position))
			: undefined;

	const playlistPieceAt = (list: PlaylistList, position: number) =>
		playlistPieces.get(pieceKeyOf(list.id, list.structure, windowOf(position)));

	const pieceAt = (list: RowsList, position: number) =>
		list.kind === "library"
			? libraryPieceAt(list, position)
			: playlistPieceAt(list, position);

	const removePiece = (piece: AnyPiece) => {
		pieces.delete(piece);
		if (piece.kind === "library") {
			for (const ordinal of piece.window.ordinals)
				if (libraryIndex.get(ordinal) === piece) libraryIndex.delete(ordinal);
			return;
		}
		playlistPieces.delete(
			pieceKeyOf(piece.id, piece.structure, windowOf(piece.offset)),
		);
	};

	const sourceOfPiece = (piece: AnyPiece) =>
		piece.kind === "library" ? LIBRARY : playlistSource(piece.id);

	const piecesUnder = ({ list, first, last }: View) => {
		const shown = new Set<AnyPiece>();
		for (
			let position = Math.max(0, first);
			position < Math.min(last, list.length);
			position += 1
		) {
			const piece = pieceAt(list, position);
			if (piece) shown.add(piece);
		}
		return shown;
	};

	const onScreen = () => {
		const shown = new Set<AnyPiece>();
		for (const view of views.values())
			for (const piece of piecesUnder(view)) shown.add(piece);
		return shown;
	};

	const evict = () => {
		if (pieces.size <= HELD_WINDOWS) return;
		const shown = onScreen();
		const candidates = [...pieces]
			.filter((piece) => !shown.has(piece))
			.sort((a, b) => a.stamp - b.stamp);
		for (const piece of candidates) {
			if (pieces.size <= HELD_WINDOWS) break;
			removePiece(piece);
		}
	};

	const dropSource = (source: string) => {
		for (const piece of [...pieces])
			if (sourceOfPiece(piece) === source) removePiece(piece);
	};

	const dropLibrary = () => {
		dropSource(LIBRARY);
		libraryStructure = null;
		bump(generations, LIBRARY);
	};

	const arm = (ms: number) => {
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			timer = null;
			pump();
		}, ms);
	};

	function neededOrdinals(list: LibraryList, window: number) {
		const needed: number[] = [];
		const end = Math.min(list.length, (window + 1) * WINDOW_ROWS);
		for (let position = window * WINDOW_ROWS; position < end; position += 1) {
			const ordinal = ordinalAt(list, position);
			const held = libraryIndex.get(ordinal);
			if (!held || held.stale) needed.push(ordinal);
		}
		return needed;
	}

	function nextAsk(isBlocked: (source: string) => boolean): Ask | null {
		const current = [...views.values()].sort((a, b) => b.order - a.order);
		for (const view of current) {
			const { list } = view;
			if (isBlocked(sourceOf(list))) continue;
			for (const window of windowsFor(view)) {
				if (list.kind === "library") {
					if (list.structure === refusedLibrary) continue;
					const needed = neededOrdinals(list, window);
					if (needed.length === 0) continue;
					const set: RowSet = list.ordinals
						? { ordinals: needed }
						: { runs: runsOf(needed) };
					return { kind: "library", list, set };
				}
				if (
					!isAnswered(list.structure) ||
					refusedPlaylists.has(pieceKeyOf(list.id, list.structure, 0))
				)
					continue;
				const held = playlistPieceAt(list, window * WINDOW_ROWS);
				if (held && !held.stale) continue;
				return { kind: "playlist", list, window };
			}
		}
		return null;
	}

	function isBlocked(source: string, at: number) {
		const held = holds.get(source);
		if (!held) return false;

		const { hold } = held;
		if (hold.kind === "tooFast") {
			if (at < hold.until) return true;
			holds.delete(source);
			return false;
		}
		return hold.kind === "failing" && !held.isReleased;
	}

	function noteResult(source: string, result: RowsResult | PageResult) {
		if (result.ok) return void holds.delete(source);

		const meaning = meaningOf(holds.get(source)?.hold ?? NO_HOLD, result);
		if (!meaning.structureMoved)
			holds.set(source, { hold: meaning.hold, isReleased: false });
	}

	function pump() {
		if (inFlight) return;
		const at = now();
		const blocked = (source: string) => isBlocked(source, at);
		const extra = readsOfOthers.find((one) => !blocked(one.source));
		const ask = extra ? null : nextAsk(blocked);
		if (!extra && !ask) {
			const soonest = [...holds.values()].flatMap(({ hold }) =>
				hold.kind === "tooFast" && hold.until > at ? [hold.until] : [],
			);
			if (soonest.length > 0) arm(Math.min(...soonest) - at);
			return;
		}

		const wait = lastSentAt + PACING_MS - at;
		if (wait > 0) return arm(wait);

		if (extra) {
			readsOfOthers.splice(readsOfOthers.indexOf(extra), 1);
			inFlight = OTHERS;
			lastSentAt = at;
			extra
				.read()
				.catch(unreachable)
				.then((result) => {
					inFlight = null;
					if (extra.holds && !extra.signal?.aborted)
						noteResult(extra.source, result);
					extra.settle(result);
					pump();
				});
		} else if (ask) send(ask);
	}

	function send(ask: Ask) {
		lastSentAt = now();
		const source = sourceOf(ask.list);
		const sent: Out = {
			ask,
			source,
			generation: counter(generations, source),
			staleEpoch: counter(staleEpochs, source),
		};
		inFlight = sent;

		if (ask.kind === "library")
			settle(
				sent,
				transport.readRows({ structure: ask.list.structure, set: ask.set }),
				(rows, stale) => holdWindow(rows.window, stale),
			);
		else {
			const offset = ask.window * WINDOW_ROWS;
			settle(
				sent,
				transport.readPage({
					id: ask.list.id,
					structure: ask.list.structure,
					offset,
					count: Math.min(WINDOW_ROWS, ask.list.length - offset),
				}),
				(pageResult, stale) => holdPage(ask, pageResult.page, stale),
			);
		}
	}

	function settle<Result extends RowsResult | PageResult>(
		sent: Out,
		reading: Promise<Result>,
		keep: (read: Extract<Result, { ok: true }>, stale: boolean) => void,
	) {
		reading
			.catch(unreachable)
			.then((result) =>
				landed(
					sent,
					result,
					result.ok
						? (stale) => keep(result as Extract<Result, { ok: true }>, stale)
						: null,
				),
			);
	}

	function refuse(sent: Out) {
		if (sent.ask.kind === "library") {
			refusedLibrary = sent.ask.list.structure;
			dropLibrary();
		} else {
			const { id, structure } = sent.ask.list;
			refusedPlaylists.add(pieceKeyOf(id, structure, 0));
			for (const piece of [...pieces])
				if (
					piece.kind === "playlist" &&
					piece.id === id &&
					piece.structure === structure
				)
					removePiece(piece);
		}
		changed();
	}

	function landed(
		sent: Out,
		result: RowsResult | PageResult,
		keep: ((stale: boolean) => void) | null,
	) {
		inFlight = null;
		const isCurrent =
			sent.generation === counter(generations, sent.source) &&
			(sent.ask.kind !== "library" ||
				sent.ask.list.structure === libraryStructure);

		if (result.ok) {
			holds.delete(sent.source);
			if (isCurrent) {
				keep?.(sent.staleEpoch !== counter(staleEpochs, sent.source));
				evict();
				changed();
			}
		} else {
			if (result.structureMoved) {
				if (isCurrent) refuse(sent);
			} else noteResult(sent.source, result);
		}
		pump();
	}

	function holdWindow(window: RowsWindow, stale: boolean) {
		const piece: LibraryPiece = {
			kind: "library",
			window,
			rowOf: rowReader(window.ordinals),
			live: 0,
			stale,
			stamp: ++tick,
		};
		for (const ordinal of window.ordinals) {
			const previous = libraryIndex.get(ordinal);
			if (previous === piece) continue;
			if (previous && --previous.live === 0) pieces.delete(previous);
			libraryIndex.set(ordinal, piece);
			piece.live += 1;
		}
		pieces.add(piece);
	}

	function holdPage(
		ask: Extract<Ask, { kind: "playlist" }>,
		page: PlaylistPage,
		stale: boolean,
	) {
		const { id, structure } = ask.list;
		const piece: PlaylistPiece = {
			kind: "playlist",
			id,
			structure,
			offset: ask.window * WINDOW_ROWS,
			page,
			stale,
			stamp: ++tick,
		};
		const previous = playlistPieces.get(pieceKeyOf(id, structure, ask.window));
		if (previous) pieces.delete(previous);
		pieces.add(piece);
		playlistPieces.set(pieceKeyOf(id, structure, ask.window), piece);
	}

	const playlistPiecesOf = (id: string, structure: string) =>
		[...pieces].filter(
			(piece): piece is PlaylistPiece =>
				piece.kind === "playlist" &&
				piece.id === id &&
				piece.structure === structure,
		);

	function carryPlaylist(
		id: string,
		from: string,
		to: string,
		order: ArrayLike<number>,
	) {
		const held = playlistPiecesOf(id, from);
		for (const piece of playlistPiecesOf(id, to)) removePiece(piece);
		if (held.length === 0) return;

		const byWindow: (PlaylistPiece | undefined)[] = [];
		for (const piece of held) byWindow[windowOf(piece.offset)] = piece;

		interface Carried {
			items: PlaylistPage["items"];
			filled: number;
			isStale: boolean;
		}
		const total = order.length;
		const carried: (Carried | undefined)[] = [];
		for (let position = 0; position < total; position += 1) {
			const old = order[position];
			const source = byWindow[windowOf(old)];
			const item = source?.page.items[old - (source?.offset ?? 0)];
			if (!source || !item) continue;

			const window = windowOf(position);
			let target = carried[window];
			if (!target) {
				target = {
					items: new Array(Math.min(WINDOW_ROWS, total - window * WINDOW_ROWS)),
					filled: 0,
					isStale: false,
				};
				carried[window] = target;
			}
			target.items[position - window * WINDOW_ROWS] = item;
			target.filled += 1;
			target.isStale ||= source.stale;
		}

		for (const piece of held) removePiece(piece);
		const { revision } = held[0].page;
		for (const [window, made] of carried.entries()) {
			if (!made) continue;
			const piece: PlaylistPiece = {
				kind: "playlist",
				id,
				structure: to,
				offset: window * WINDOW_ROWS,
				page: { structure: to, revision, totalCount: total, items: made.items },
				stale: made.isStale || made.filled < made.items.length,
				stamp: ++tick,
			};
			pieces.add(piece);
			playlistPieces.set(pieceKeyOf(id, to, window), piece);
		}
		bump(generations, playlistSource(id));
		evict();
		changed();
	}

	function renamePlaylist(id: string, from: string, to: string) {
		const held = playlistPiecesOf(id, from);
		for (const piece of playlistPiecesOf(id, to)) removePiece(piece);
		for (const piece of held) {
			const window = windowOf(piece.offset);
			playlistPieces.delete(pieceKeyOf(id, from, window));
			piece.structure = to;
			piece.page = { ...piece.page, structure: to };
			playlistPieces.set(pieceKeyOf(id, to, window), piece);
		}
		if (playlistStructures.get(id) === from) playlistStructures.set(id, to);
		if (held.length > 0) changed();
	}

	return {
		view(list, first, last, direction) {
			if (list.kind === "library" && list.structure !== libraryStructure) {
				if (libraryStructure !== null) {
					dropLibrary();
					changed();
				}
				libraryStructure = list.structure;
				if (refusedLibrary !== list.structure) refusedLibrary = null;
			}
			if (
				list.kind === "playlist" &&
				playlistStructures.get(list.id) !== list.structure
			) {
				for (const piece of pieces)
					if (
						piece.kind === "playlist" &&
						piece.id === list.id &&
						piece.structure !== list.structure
					)
						removePiece(piece);
				playlistStructures.set(list.id, list.structure);
			}
			const seen: View = { list, first, last, direction, order: ++tick };
			views.set(viewKeyOf(list), seen);
			for (const piece of piecesUnder(seen)) piece.stamp = tick;
			pump();
		},

		leave(list) {
			views.delete(viewKeyOf(list));
		},

		at(list, position) {
			if (list.kind === "library") {
				const piece = libraryPieceAt(list, position);
				if (!piece) return null;
				const row = piece.rowOf(ordinalAt(list, position));
				return row < 0 ? null : { kind: "library", window: piece.window, row };
			}
			const piece = playlistPieceAt(list, position);
			if (!piece) return null;
			const row = position - piece.offset;
			return piece.page.items[row]
				? { kind: "playlist", page: piece.page, row }
				: null;
		},

		patch(list, position, item) {
			const piece = playlistPieceAt(list, position);
			const row = piece ? position - piece.offset : -1;
			if (inFlight && inFlight !== OTHERS && inFlight.ask.kind === "playlist") {
				const { ask } = inFlight;
				if (
					ask.list.id === list.id &&
					ask.list.structure === list.structure &&
					ask.window === windowOf(position)
				)
					inFlight.staleEpoch = -1;
			}
			if (!piece || row >= piece.page.items.length) return false;

			piece.page.items[row] = item;
			changed();
			return true;
		},

		carry: carryPlaylist,

		rename: renamePlaylist,

		totalOf: (id, structure) =>
			playlistPiecesOf(id, structure)[0]?.page.totalCount ?? null,

		markStale(source) {
			const key = sourceOf(source);
			bump(staleEpochs, key);
			for (const piece of pieces)
				if (sourceOfPiece(piece) === key) piece.stale = true;
			changed();
			pump();
		},

		drop(source) {
			const key = sourceOf(source);
			dropSource(key);
			holds.delete(key);
			bump(generations, key);
			for (const [name, view] of views)
				if (sourceOf(view.list) === key) views.delete(name);
			if (source.kind === "library") {
				libraryStructure = null;
				refusedLibrary = null;
			} else {
				playlistStructures.delete(source.id);
				for (const refused of [...refusedPlaylists])
					if (refused.startsWith(`${source.id}\u0000`))
						refusedPlaylists.delete(refused);
			}
			changed();
		},

		answered() {
			let isAnyDue = false;
			for (const held of holds.values())
				if (held.hold.kind === "failing" && isDue({ hold: held.hold })) {
					held.isReleased = true;
					isAnyDue = true;
				}
			if (isAnyDue) pump();
		},

		run(source, read, { signal, holds: notes = true } = {}) {
			return new Promise((resolve) => {
				const leaveQueue = () => {
					const at = readsOfOthers.indexOf(extra);
					if (at < 0) return;
					readsOfOthers.splice(at, 1);
					resolve(unreachable() as never);
				};
				const extra: Extra = {
					source: sourceOf(source),
					holds: notes,
					signal,
					read,
					settle: (result) => {
						signal?.removeEventListener("abort", leaveQueue);
						resolve(result as never);
					},
				};
				signal?.addEventListener("abort", leaveQueue, { once: true });
				readsOfOthers.push(extra);
				pump();
			});
		},

		clearHolds() {
			holds.clear();
			pump();
		},

		subscribe: listeners.subscribe,

		version: () => version,
	};
}
