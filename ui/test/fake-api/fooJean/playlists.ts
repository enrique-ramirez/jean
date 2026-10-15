import { empty, json } from "../http.ts";
import type { FakePlaylist, Track } from "../state.ts";
import {
	NOT_BUILT,
	notFound,
	OWN_PLAYLIST,
	STRUCTURE_MOVED,
	WRITES_DISABLED,
} from "./answers.ts";
import { delay } from "./latency.ts";
import type { FooJeanFake, OwnPlaylistRole } from "./options.ts";
import type { Asked, FakeState } from "./request.ts";
import {
	decodeSelection,
	GUID_PATTERN,
	generationText,
	isNonNegInt,
	parseFill,
} from "./requestBodies.ts";

export const requirePlaylist = (state: FakeState, id: string): FakePlaylist => {
	const playlist = state.playlistById(id);
	if (!playlist)
		throw new Error(
			`fake fooJean: lost playlist ${id} immediately after creating it`,
		);
	return playlist;
};

export const ownRoleOf = (
	fake: FooJeanFake,
	id: string,
): OwnPlaylistRole | null =>
	fake.ownPlaylists.scratch === id ? "scratch" : null;

// Whether the player would lock this playlist against having rows added: seeded true on a
// fixture playlist, or built by `POST /api/autoplaylists` or the `autoPlaylists` fixture
// option, both of which only ever add an id to `fake.autoPlaylists`. The one function is what
// every route that would otherwise disagree with `GET /api/playlists` calls.
export const locksAgainstAdds = (
	fake: FooJeanFake,
	playlist: FakePlaylist,
): boolean =>
	Boolean(playlist.isAuto) || fake.autoPlaylists.includes(playlist.id);

// One playlist as `GET /api/playlists` lists it, which is also what the two
// autoplaylist writes answer with.
export const annotationOf = (state: FakeState, playlist: FakePlaylist) => ({
	id: playlist.guid,
	index: state.playlists.indexOf(playlist),
	title: playlist.title,
	itemCount: playlist.items.length,
	isAutoPlaylist: locksAgainstAdds(state.fooJean, playlist),
	role: ownRoleOf(state.fooJean, playlist.id),
	structure: generationText(playlist.structure),
	revision: generationText(playlist.revision),
	managed: state.fooJean.managedAutoPlaylists.get(playlist.id) ?? null,
});

export function insertTracks(
	state: FakeState,
	playlist: FakePlaylist,
	tracks: Track[],
	{ replace }: { replace: boolean },
): number[] {
	if (!replace && tracks.length === 0) return [];

	const start = replace ? 0 : playlist.items.length;
	state.editItems(playlist, () => {
		if (replace) playlist.items = [];
		for (const track of tracks) playlist.items.push(track);
	});
	return tracks.map((_, at) => start + at);
}

export async function handlePlaylists({
	state,
	fake,
	method,
	path,
	body,
	response,
}: Asked) {
	if (method === "GET" && path === "/api/playlists") {
		// `/__control/latency`, held after the request is recorded and before the list is built, so a
		// spec can hold a refetch open across a playlist mutation the tick has already moved past.
		if (state.latency > 0) await delay(state.latency);

		const annotated = state.playlists.map((playlist) =>
			annotationOf(state, playlist),
		);
		return json(response, {
			playlists: fake.annotatesEveryPlaylist
				? annotated
				: annotated.slice(0, -1),
		});
	}

	if (method === "POST" && path === "/api/playlists") {
		if (state.latency > 0) await delay(state.latency);

		if (fake.canWritePlaylists === false)
			return json(response, WRITES_DISABLED, 403);

		const asked = body as {
			title?: unknown;
			source?: unknown;
			structure?: unknown;
			runs?: unknown;
			bitset?: unknown;
			ordinals?: unknown;
		} | null;
		if (typeof asked?.title !== "string" || asked.title.length === 0)
			return json(
				response,
				{
					error: "unacceptable title",
					detail: "'title' is required",
				},
				400,
			);

		let fillTracks: Track[] | null = null;

		if (asked.source !== undefined) {
			if (typeof asked.source !== "string" || !GUID_PATTERN.test(asked.source))
				return json(
					response,
					{
						error: "unacceptable playlist id",
						detail: "'source' must be a playlist id this component issued",
					},
					400,
				);
			if (
				asked.structure !== undefined ||
				asked.bitset !== undefined ||
				asked.ordinals !== undefined
			)
				return json(
					response,
					{
						error: "malformed request",
						detail:
							"'source' is refused with 'structure', 'bitset' or 'ordinals'",
					},
					400,
				);

			const source = state.playlistByGuid(asked.source);
			if (!source)
				return json(response, { error: "no such playlist", detail: "" }, 404);

			const selection = decodeSelection(
				{ runs: asked.runs },
				source.items.length,
			);
			if (!selection.ok)
				return json(response, selection.body, selection.status);

			fillTracks = selection.ordinals.map((ordinal) => source.items[ordinal]);
		} else if (
			asked.structure !== undefined ||
			asked.runs !== undefined ||
			asked.bitset !== undefined ||
			asked.ordinals !== undefined
		) {
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
			if (parsed.structure !== state.libraryFeed.structure)
				return json(response, STRUCTURE_MOVED, 409);

			const tracks = state.ordinalOrder();
			fillTracks = parsed.ordinals.map((ordinal) => tracks[ordinal].track);
		}

		const made = state.addPlaylist(asked.title);
		const playlist = requirePlaylist(state, made.id);
		if (fillTracks && fillTracks.length > 0)
			insertTracks(state, playlist, fillTracks, { replace: true });
		state.notifyPlaylists();

		return json(response, {
			id: playlist.guid,
			index: state.playlists.length - 1,
			title: playlist.title,
			itemCount: playlist.items.length,
			isAutoPlaylist: false,
			role: ownRoleOf(fake, playlist.id),
			structure: generationText(playlist.structure),
			revision: generationText(playlist.revision),
			managed: null,
		});
	}

	const byIdMatch = /^\/api\/playlists\/([^/]+)$/.exec(path);
	if ((method === "POST" || method === "DELETE") && byIdMatch) {
		if (state.latency > 0) await delay(state.latency);

		const guid = byIdMatch[1];
		if (fake.canWritePlaylists === false)
			return json(response, WRITES_DISABLED, 403);

		const playlist = state.playlistByGuid(guid);
		if (!playlist)
			return json(response, { error: "no such playlist", detail: "" }, 404);

		if (ownRoleOf(fake, playlist.id)) return json(response, OWN_PLAYLIST, 403);

		if (method === "DELETE") {
			state.removePlaylist(playlist.id);
			return empty(response);
		}

		const asked = body as { title?: unknown } | null;
		if (typeof asked?.title !== "string" || asked.title.length === 0)
			return json(
				response,
				{ error: "unacceptable title", detail: "'title' is required" },
				400,
			);
		state.renamePlaylist(playlist.id, asked.title);
		return empty(response);
	}

	const moveMatch = /^\/api\/playlists\/([^/]+)\/move$/.exec(path);
	if (method === "POST" && moveMatch) {
		if (state.latency > 0) await delay(state.latency);

		const guid = moveMatch[1];
		if (fake.canWritePlaylists === false)
			return json(response, WRITES_DISABLED, 403);

		const playlist = state.playlistByGuid(guid);
		if (!playlist)
			return json(response, { error: "no such playlist", detail: "" }, 404);

		const asked = body as { index?: unknown } | null;
		if (!isNonNegInt(asked?.index))
			return json(
				response,
				{ error: "unacceptable index", detail: "'index' is required" },
				400,
			);
		if (ownRoleOf(fake, playlist.id)) return json(response, OWN_PLAYLIST, 403);
		if (asked.index >= state.playlists.length)
			return json(
				response,
				{ error: "that position is past the end", detail: "" },
				400,
			);

		state.movePlaylist(playlist.id, asked.index);
		return empty(response);
	}

	return notFound(response);
}
