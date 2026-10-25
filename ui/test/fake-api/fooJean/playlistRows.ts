import { empty, json, type Responder } from "../http.ts";
import { type FakePlaylist, type Track, trackKey } from "../state.ts";
import { evaluate, sortedOrder } from "../titleFormat.ts";
import {
	NOT_BUILT,
	notFound,
	OWN_PLAYLIST,
	PLAYER_REFUSED,
	STRUCTURE_MOVED,
	WRITES_DISABLED,
} from "./answers.ts";
import { delay } from "./latency.ts";
import { rolesAsked, subsongOf } from "./library.ts";
import { LIBRARY_ROLE_NAMES } from "./librarySummary.ts";
import type { FooJeanFake, OwnPlaylistRole } from "./options.ts";
import { coversFor, settleCovers } from "./playlistCovers.ts";
import {
	insertTracks,
	locksAgainstAdds,
	ownRoleOf,
	requirePlaylist,
} from "./playlists.ts";
import { refuseTooFast, spend } from "./rateLimits.ts";
import type { Asked, FakeState } from "./request.ts";
import {
	declaresOnly,
	decodeSelection,
	duplicatesFailure,
	type FillFailure,
	fillFailure,
	GUID_PATTERN,
	generationText,
	isNonNegInt,
	parseFill,
	parseGeneration,
} from "./requestBodies.ts";
import { TAG_ROWS_MOVED } from "./tags.ts";

// `PlaylistLocked` and `FillConflict` in `contract/openapi.yaml` publish the same two fields for
// this cause, so one constant answers both routes.
const PLAYLIST_LOCKED = {
	error: "another component has locked that playlist against that edit",
	detail: "",
};

export const ROWS_MOVED = {
	error: TAG_ROWS_MOVED.error,
	detail: "",
};

const REVISION_GONE = {
	error:
		"that revision is not one this playlist can catch up from; read its rows again",
	detail: "",
};

const PAGE_PARAMETERS = ["offset", "count", "columns"];
const CHANGES_PARAMETERS = ["structure", "since", "columns"];

const MOVE_ROWS_FIELDS = ["structure", "runs", "ordinals", "to"];
const SORT_ROWS_FIELDS = ["structure", "pattern"];
const MAX_SORT_PATTERN = 4096;

type ParsedRowEdit =
	| { ok: true; record: Record<string, unknown> }
	| ({ ok: false } & FillFailure);

const parseRowEdit = (
	body: unknown,
	fields: readonly string[],
): ParsedRowEdit =>
	typeof body === "object" &&
	body !== null &&
	declaresOnly(body as Record<string, unknown>, fields)
		? { ok: true, record: body as Record<string, unknown> }
		: { ok: false, ...fillFailure(400, "malformed request") };

const parseRowEditStructure = (record: Record<string, unknown>) =>
	typeof record.structure === "string"
		? parseGeneration(record.structure)
		: null;

const failRowEditAnswer = (response: Responder, status: number) => {
	if (status === 429) response.setHeader("Retry-After", "1");
	return json(response, PLAYER_REFUSED, status);
};

// `moveOrder` in `src/domain/track/playlistPatch.ts`, written out again because the fake imports
// nothing from `src/` beyond types.
const movedOrder = (
	count: number,
	ordinals: readonly number[],
	to: number,
): number[] => {
	const moved = [...new Set(ordinals)].sort((a, b) => a - b);
	const moving = new Set(moved);
	const rest = Array.from({ length: count }, (_, at) => at).filter(
		(at) => !moving.has(at),
	);
	return [...rest.slice(0, to), ...moved, ...rest.slice(to)];
};

function splitDuplicates<T>(
	playlist: FakePlaylist,
	named: T[],
	trackOf: (entry: T) => Track,
): { fresh: T[]; held: T[] } {
	const present = new Set(playlist.items.map(trackKey));
	const isHeld = (entry: T) => present.has(trackKey(trackOf(entry)));
	return {
		fresh: named.filter((entry) => !isHeld(entry)),
		held: named.filter(isHeld),
	};
}

// foobar2000 locks an autoplaylist against a reorder only where it is force-sorted.
const locksAgainstReorder = (
	fake: FooJeanFake,
	playlist: FakePlaylist,
): boolean =>
	fake.lockedPlaylists.has(playlist.id) ||
	fake.managedAutoPlaylists.get(playlist.id)?.forceSort === true;

const OWN_TITLE_PREFIX = "#Jean";

// A title beginning `#Jean` reaches the player exactly as sent; one that does not is prefixed
// with `#Jean ` first. The check is exact and case-sensitive, matching the component's own.
const ownPlaylistTitle = (asked: string) =>
	asked.startsWith(OWN_TITLE_PREFIX) ? asked : `${OWN_TITLE_PREFIX} ${asked}`;

// Applies `title` only where this is what makes the playlist for `role`; finding one
// already there leaves its title alone, since the caller retitles it once the structure
// check has passed. Keyed on the role rather than on the title, so a playlist renamed at
// the player is still found.
function resolveOwnPlaylist(
	state: FakeState,
	fake: FooJeanFake,
	role: OwnPlaylistRole,
	title: string,
): FakePlaylist {
	const existingId = fake.ownPlaylists[role];
	if (existingId && state.playlistById(existingId))
		return requirePlaylist(state, existingId);
	const made = state.addPlaylist(ownPlaylistTitle(title));
	fake.ownPlaylists[role] = made.id;
	return requirePlaylist(state, made.id);
}

const changedColumnDictionaries = (columns: string[], rows: Track[]) =>
	columns.map((expression) => {
		const text: string[] = [];
		const idOf = new Map<string, number>();
		const ids = rows.map((track) => {
			const value = evaluate(track, expression);
			let id = idOf.get(value);
			if (id === undefined) {
				id = text.length;
				text.push(value);
				idOf.set(value, id);
			}
			return id;
		});
		return { text, ids };
	});

// A page and a delta of a playlist's rows spend from one bucket for each client, after the
// request's own 400s and before the player is asked.
const refusedAsTooFast = ({ fake, recorded, client, response }: Asked) => {
	if (
		!fake.rateLimits ||
		spend(fake.limiter, fake.rateLimits, "playlistRows", client)
	)
		return false;
	recorded.limited = "playlistRows";
	refuseTooFast(response, "playlistRows");
	return true;
};

export async function handlePlaylistRows(asked: Asked) {
	const { state, fake, method, path, url, body, response, session } = asked;
	const playMatch = /^\/api\/playlists\/([^/]+)\/items\/(\d+)\/play$/.exec(
		path,
	);
	if (method === "POST" && playMatch) {
		const [, guid, indexText] = playMatch;
		const playlist = state.playlistByGuid(guid);
		if (!playlist)
			return json(response, { error: "no such playlist", detail: "" }, 404);

		const index = Number(indexText);
		if (index >= playlist.items.length)
			return json(
				response,
				{ error: "that position is past the end", detail: "" },
				400,
			);

		if (session) session.play(playlist.items, index);
		else state.playItem(playlist.id, index);
		return empty(response);
	}

	const rowsMatch = /^\/api\/playlists\/([^/]+)\/items$/.exec(path);
	if (method === "GET" && rowsMatch) {
		const guid = rowsMatch[1];
		const offset = Number(url.searchParams.get("offset"));
		const count = Number(url.searchParams.get("count"));
		const columns = url.searchParams.getAll("columns");
		if (columns.length === 0)
			return json(
				response,
				{ error: "unacceptable column", detail: "'columns' is required" },
				400,
			);
		const roles = rolesAsked(url, LIBRARY_ROLE_NAMES, PAGE_PARAMETERS);
		if (!(roles instanceof Map)) return json(response, roles, 400);

		if (refusedAsTooFast(asked)) return true;

		const playlist = state.playlistByGuid(guid);
		if (!playlist)
			return json(response, { error: "no such playlist", detail: "" }, 404);

		await settleCovers(state, roles);
		const coverOf = coversFor(state, roles);
		const page = playlist.items.slice(offset, offset + count);
		return json(response, {
			structure: generationText(playlist.structure),
			revision: generationText(playlist.revision),
			totalCount: playlist.items.length,
			items: page.map((track) => ({
				columns: columns.map((expression) => evaluate(track, expression)),
				libraryPath: state.libraryPathFor(track),
				// Off the handle the row was drawn from, so a row the media library
				// does not hold carries one too.
				subsong: subsongOf(track),
				...(coverOf ? { cover: coverOf(track) } : null),
			})),
		});
	}

	const changesMatch = /^\/api\/playlists\/([^/]+)\/items\/changes$/.exec(path);
	if (method === "GET" && changesMatch) {
		const guid = changesMatch[1];
		const columns = url.searchParams.getAll("columns");
		if (columns.length === 0)
			return json(
				response,
				{ error: "unacceptable column", detail: "'columns' is required" },
				400,
			);
		const roles = rolesAsked(url, LIBRARY_ROLE_NAMES, CHANGES_PARAMETERS);
		if (!(roles instanceof Map)) return json(response, roles, 400);

		const structure = parseGeneration(url.searchParams.get("structure"));
		const since = parseGeneration(url.searchParams.get("since"));
		if (structure === null || since === null)
			return json(
				response,
				{
					error: "unacceptable revision",
					detail: "'structure' and 'since' must be a run of decimal digits",
				},
				400,
			);

		if (refusedAsTooFast(asked)) return true;

		const playlist = state.playlistByGuid(guid);
		if (!playlist)
			return json(response, { error: "no such playlist", detail: "" }, 404);

		if (structure !== playlist.structure)
			return json(response, ROWS_MOVED, 409);

		if (since === playlist.revision)
			return json(response, {
				revision: generationText(playlist.revision),
				columns: [],
				items: [],
			});

		const at = playlist.changeHistory.findIndex(
			(entry) => entry.revision === since,
		);
		if (at < 0) return json(response, REVISION_GONE, 410);

		const positions = new Set<number>();
		for (const entry of playlist.changeHistory.slice(at + 1))
			for (const position of entry.positions) positions.add(position);

		const ordered = [...positions].sort((a, b) => a - b);
		const rows = ordered.map((position) => playlist.items[position]);
		await settleCovers(state, roles);
		const coverOf = coversFor(state, roles);

		return json(response, {
			revision: generationText(playlist.revision),
			columns: changedColumnDictionaries(columns, rows),
			items: ordered.map((position) => ({
				position,
				libraryPath: state.libraryPathFor(playlist.items[position]),
				subsong: subsongOf(playlist.items[position]),
				...(coverOf ? { cover: coverOf(playlist.items[position]) } : null),
			})),
		});
	}

	const copyMatch = /^\/api\/playlists\/([^/]+)\/items\/copy$/.exec(path);
	if (method === "POST" && copyMatch) {
		if (state.latency > 0) await delay(state.latency);

		const guid = copyMatch[1];
		if (fake.canWritePlaylists === false)
			return json(response, WRITES_DISABLED, 403);

		const asked = body as {
			source?: unknown;
			runs?: unknown;
			duplicates?: unknown;
		} | null;
		if (typeof asked?.source !== "string" || !GUID_PATTERN.test(asked.source))
			return json(
				response,
				{
					error: "unacceptable playlist id",
					detail: "'source' must be a playlist id this component issued",
				},
				400,
			);

		const refused = duplicatesFailure(asked.duplicates);
		if (refused) return json(response, refused.body, refused.status);

		const target = state.playlistByGuid(guid);
		if (!target)
			return json(response, { error: "no such playlist", detail: "" }, 404);
		if (ownRoleOf(fake, target.id)) return json(response, OWN_PLAYLIST, 403);
		if (locksAgainstAdds(fake, target) || fake.lockedPlaylists.has(target.id))
			return json(response, PLAYLIST_LOCKED, 409);

		const source = state.playlistByGuid(asked.source);
		if (!source)
			return json(response, { error: "no such playlist", detail: "" }, 404);

		const selection = decodeSelection(
			{ runs: asked.runs },
			source.items.length,
		);
		if (!selection.ok) return json(response, selection.body, selection.status);

		const { fresh, held } =
			asked.duplicates === "skip"
				? splitDuplicates(
						target,
						selection.ordinals,
						(ordinal) => source.items[ordinal],
					)
				: { fresh: selection.ordinals, held: [] };

		const positions = insertTracks(
			state,
			target,
			fresh.map((ordinal) => source.items[ordinal]),
			{ replace: false },
		);
		state.notifyPlaylists();

		return json(response, {
			structure: generationText(target.structure),
			positions,
			skipped: held,
		});
	}

	const removeRowsMatch = /^\/api\/playlists\/([^/]+)\/items\/remove$/.exec(
		path,
	);
	if (method === "POST" && removeRowsMatch) {
		if (state.latency > 0) await delay(state.latency);

		const guid = removeRowsMatch[1];
		if (fake.canWritePlaylists === false)
			return json(response, WRITES_DISABLED, 403);

		const playlist = state.playlistByGuid(guid);
		if (!playlist)
			return json(response, { error: "no such playlist", detail: "" }, 404);

		const asked = body as { structure?: unknown } | null;
		const structure =
			typeof asked?.structure === "string"
				? parseGeneration(asked.structure)
				: null;
		if (structure === null)
			return json(
				response,
				{ error: "malformed request", detail: "'structure' is required" },
				400,
			);
		if (ownRoleOf(fake, playlist.id)) return json(response, OWN_PLAYLIST, 403);
		if (structure !== playlist.structure)
			return json(response, STRUCTURE_MOVED, 409);

		const selection = decodeSelection(
			body as Record<string, unknown>,
			playlist.items.length,
		);
		if (!selection.ok) return json(response, selection.body, selection.status);

		if (
			locksAgainstAdds(fake, playlist) ||
			fake.lockedPlaylists.has(playlist.id)
		)
			return json(response, PLAYLIST_LOCKED, 409);

		const drop = new Set(selection.ordinals);
		state.editItems(playlist, () => {
			playlist.items = playlist.items.filter((_, at) => !drop.has(at));
		});
		state.notifyPlaylists();

		return json(response, { structure: generationText(playlist.structure) });
	}

	const moveRowsMatch = /^\/api\/playlists\/([^/]+)\/items\/move$/.exec(path);
	if (method === "POST" && moveRowsMatch) {
		if (state.latency > 0) await delay(state.latency);

		if (fake.canWritePlaylists === false)
			return json(response, WRITES_DISABLED, 403);

		const playlist = state.playlistByGuid(moveRowsMatch[1]);
		if (!playlist)
			return json(response, { error: "no such playlist", detail: "" }, 404);

		const asked = parseRowEdit(body, MOVE_ROWS_FIELDS);
		if (!asked.ok) return json(response, asked.body, asked.status);
		const { record } = asked;

		const structure = parseRowEditStructure(record);
		const { to } = record;
		if (structure === null || !isNonNegInt(to))
			return json(
				response,
				{
					error: "malformed request",
					detail: "'structure' and 'to' are required",
				},
				400,
			);
		if (ownRoleOf(fake, playlist.id)) return json(response, OWN_PLAYLIST, 403);
		if (structure !== playlist.structure)
			return json(response, ROWS_MOVED, 409);

		const selection = decodeSelection(record, playlist.items.length);
		if (!selection.ok) return json(response, selection.body, selection.status);
		const distinct = new Set(selection.ordinals).size;
		if (to > playlist.items.length - distinct)
			return json(
				response,
				{
					error: "malformed request",
					detail: "'to' is past the end of the playlist without the moved rows",
				},
				400,
			);

		if (locksAgainstReorder(fake, playlist))
			return json(response, PLAYLIST_LOCKED, 409);
		if (fake.failRowEdit) return failRowEditAnswer(response, fake.failRowEdit);

		const before = playlist.items;
		const order = movedOrder(before.length, selection.ordinals, to);
		state.editItems(playlist, () => {
			playlist.items = order.map((old) => before[old]);
		});
		state.notifyPlaylists();

		return json(response, { structure: generationText(playlist.structure) });
	}

	const sortRowsMatch = /^\/api\/playlists\/([^/]+)\/items\/sort$/.exec(path);
	if (method === "POST" && sortRowsMatch) {
		if (state.latency > 0) await delay(state.latency);

		if (fake.canWritePlaylists === false)
			return json(response, WRITES_DISABLED, 403);

		const playlist = state.playlistByGuid(sortRowsMatch[1]);
		if (!playlist)
			return json(response, { error: "no such playlist", detail: "" }, 404);

		const asked = parseRowEdit(body, SORT_ROWS_FIELDS);
		if (!asked.ok) return json(response, asked.body, asked.status);
		const { record } = asked;

		const structure = parseRowEditStructure(record);
		const { pattern } = record;
		if (
			structure === null ||
			typeof pattern !== "string" ||
			pattern.length === 0 ||
			pattern.length > MAX_SORT_PATTERN
		)
			return json(
				response,
				{
					error: "malformed request",
					detail:
						"'structure' and a 'pattern' of 1 to 4096 characters are required",
				},
				400,
			);
		if (ownRoleOf(fake, playlist.id)) return json(response, OWN_PLAYLIST, 403);
		if (structure !== playlist.structure)
			return json(response, ROWS_MOVED, 409);
		if (locksAgainstReorder(fake, playlist))
			return json(response, PLAYLIST_LOCKED, 409);
		if (fake.failRowEdit) return failRowEditAnswer(response, fake.failRowEdit);

		const before = playlist.items;
		const order = sortedOrder(before, pattern);
		state.editItems(playlist, () => {
			playlist.items = order.map((old) => before[old]);
		});
		state.notifyPlaylists();

		return json(response, {
			structure: generationText(playlist.structure),
			order,
		});
	}

	const ownFillMatch = /^\/api\/playlists\/own\/([^/]+)\/items$/.exec(path);
	if (method === "POST" && ownFillMatch) {
		// `/__control/latency`, held after the request is recorded and before the playlist is touched, so
		// two racing fills are applied in the order they arrived, as `MainThreadQueue` applies them.
		if (state.latency > 0) await delay(state.latency);

		const role = ownFillMatch[1];
		if (role !== "scratch")
			return json(
				response,
				{
					error: "malformed request",
					detail: `'${role}' is not a role this component knows`,
				},
				400,
			);

		if (!fake.canReadLibrary)
			return json(
				response,
				{ error: "the media library is not available" },
				503,
			);
		if (state.libraryFeed.columns.length === 0)
			return json(response, NOT_BUILT, 503);

		const parsed = parseFill(body, {
			requireTitle: true,
			trackCount: state.libraryTracks.length,
		});
		if (!parsed.ok) return json(response, parsed.body, parsed.status);

		// Made or found before the structure is checked and retitled only after it,
		// the order the component takes: a fill refused for a stale structure can
		// leave a new, empty playlist behind, but never an existing one misnamed.
		const playlist = resolveOwnPlaylist(state, fake, role, parsed.title ?? "");

		if (parsed.structure !== state.libraryFeed.structure)
			return json(response, STRUCTURE_MOVED, 409);

		state.renamePlaylist(playlist.id, ownPlaylistTitle(parsed.title ?? ""));

		const tracks = state.ordinalOrder();
		const positions = insertTracks(
			state,
			playlist,
			parsed.ordinals.map((ordinal) => tracks[ordinal].track),
			{ replace: true },
		);
		state.notifyPlaylists();

		return json(response, {
			playlistId: playlist.guid,
			structure: generationText(playlist.structure),
			positions,
			skipped: [],
		});
	}

	if (method === "DELETE" && ownFillMatch) {
		const role = ownFillMatch[1];
		if (role !== "scratch")
			return json(
				response,
				{
					error: "malformed request",
					detail: `'${role}' is not a role this component knows`,
				},
				400,
			);

		const held = fake.ownPlaylists[role];
		const playlist = held ? state.playlistById(held) : undefined;
		if (playlist && playlist.items.length > 0) {
			state.removeItems(playlist.id, [...playlist.items.keys()]);
			state.notifyPlaylists();
		}
		return empty(response);
	}

	const idFillMatch = /^\/api\/playlists\/([^/]+)\/items$/.exec(path);
	if (method === "POST" && idFillMatch) {
		const guid = idFillMatch[1];

		if (fake.canWritePlaylists === false)
			return json(response, WRITES_DISABLED, 403);

		if (!fake.canReadLibrary)
			return json(
				response,
				{ error: "the media library is not available" },
				503,
			);
		if (state.libraryFeed.columns.length === 0)
			return json(response, NOT_BUILT, 503);

		if (!GUID_PATTERN.test(guid))
			return json(
				response,
				{
					error: "unacceptable playlist id",
					detail: `'${guid}' is not a playlist id this component issued`,
				},
				400,
			);

		const parsed = parseFill(body, {
			requireTitle: false,
			trackCount: state.libraryTracks.length,
		});
		if (!parsed.ok) return json(response, parsed.body, parsed.status);

		const playlist = state.playlistByGuid(guid);
		if (!playlist)
			return json(response, { error: "no such playlist", detail: "" }, 404);
		if (ownRoleOf(fake, playlist.id)) return json(response, OWN_PLAYLIST, 403);

		if (
			locksAgainstAdds(fake, playlist) ||
			fake.lockedPlaylists.has(playlist.id)
		)
			return json(response, PLAYLIST_LOCKED, 409);

		if (parsed.structure !== state.libraryFeed.structure)
			return json(response, STRUCTURE_MOVED, 409);

		const tracks = state.ordinalOrder();
		const { fresh, held } = parsed.skipsDuplicates
			? splitDuplicates(
					playlist,
					parsed.ordinals,
					(ordinal) => tracks[ordinal].track,
				)
			: { fresh: parsed.ordinals, held: [] };

		const positions = insertTracks(
			state,
			playlist,
			fresh.map((ordinal) => tracks[ordinal].track),
			{ replace: false },
		);
		state.notifyPlaylists();

		return json(response, {
			playlistId: guid,
			structure: generationText(playlist.structure),
			positions,
			skipped: held,
		});
	}

	return notFound(response);
}
