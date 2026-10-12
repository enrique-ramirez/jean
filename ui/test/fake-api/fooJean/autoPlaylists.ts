import type { components } from "../../../src/shared/api/fooJeanSchema.d.ts";
import { json } from "../http.ts";
import {
	notFound,
	OWN_PLAYLIST,
	PLAYER_REFUSED,
	WRITES_DISABLED,
} from "./answers.ts";
import type { ManagedAutoPlaylist } from "./options.ts";
import {
	annotationOf,
	locksAgainstAdds,
	ownRoleOf,
	requirePlaylist,
} from "./playlists.ts";
import { refuseTooFast } from "./rateLimits.ts";
import type { Asked } from "./request.ts";
import { GUID_PATTERN } from "./requestBodies.ts";

const AUTOPLAYLISTS_UNAVAILABLE = {
	error: "autoplaylists are not available",
	detail: "",
} satisfies components["schemas"]["PlaylistFailed"];

const NOT_AN_AUTOPLAYLIST = {
	error: "that playlist is not an autoplaylist",
	detail: "",
};

interface AutoPlaylistAsked {
	title?: string;
	key?: string;
	query?: string;
	sort?: string;
	forceSort?: boolean;
}

const managedOf = (asked: AutoPlaylistAsked | null): ManagedAutoPlaylist => ({
	key: String(asked?.key ?? ""),
	query: String(asked?.query ?? ""),
	sort: String(asked?.sort ?? ""),
	forceSort: asked?.forceSort === true,
});

export function handleAutoPlaylists({
	state,
	fake,
	method,
	path,
	body,
	response,
}: Asked) {
	if (method === "POST" && path === "/api/autoplaylists/preview") {
		if (fake.previewBusy > 0) {
			fake.previewBusy -= 1;
			return refuseTooFast(response, "previews");
		}

		const asked = body as { query?: string; rows?: unknown } | null;
		const query = String(asked?.query ?? "");
		const valid = query.length > 0 && !query.includes("((");
		const ordinals =
			valid && fake.libraryEnabled ? state.previewMatches(query) : [];
		return json(response, {
			valid,
			error: valid ? "" : "Query syntax error",
			matches: ordinals.length,
			libraryEnabled: fake.libraryEnabled,
			...(asked?.rows === true
				? { structure: state.libraryFeed.structure, ordinals }
				: null),
		});
	}

	const asked = body as AutoPlaylistAsked | null;

	if (method === "POST" && path === "/api/autoplaylists") {
		// Before the limit, as the component checks it: the two refusals have separate causes and a
		// fixture setting both would otherwise be told the wrong one.
		if (fake.canWritePlaylists === false)
			return json(response, WRITES_DISABLED, 403);
		if (fake.maxAutoPlaylists === 0)
			return json(response, AUTOPLAYLISTS_UNAVAILABLE, 503);
		if (fake.failCreate) return json(response, PLAYER_REFUSED, fake.failCreate);

		const made = state.addPlaylist(String(asked?.title ?? ""));
		fake.autoPlaylists.push(made.id);
		fake.managedAutoPlaylists.set(made.id, managedOf(asked));
		return json(response, annotationOf(state, requirePlaylist(state, made.id)));
	}

	const autoPlaylistMatch = /^\/api\/autoplaylists\/([^/]+)$/.exec(path);
	if ((method === "POST" || method === "DELETE") && autoPlaylistMatch) {
		if (fake.canWritePlaylists === false)
			return json(response, WRITES_DISABLED, 403);
		if (!GUID_PATTERN.test(autoPlaylistMatch[1]))
			return json(
				response,
				{ error: "unacceptable playlist id", detail: "" },
				400,
			);

		const playlist = state.playlistByGuid(autoPlaylistMatch[1]);
		if (!playlist)
			return json(response, { error: "no such playlist", detail: "" }, 404);
		if (ownRoleOf(fake, playlist.id)) return json(response, OWN_PLAYLIST, 403);
		if (!locksAgainstAdds(fake, playlist))
			return json(response, NOT_AN_AUTOPLAYLIST, 409);

		if (method === "DELETE") {
			fake.managedAutoPlaylists.delete(playlist.id);
			fake.autoPlaylists.splice(fake.autoPlaylists.indexOf(playlist.id), 1);
			state.removePlaylist(playlist.id);
			return json(response, { removed: true, id: playlist.guid });
		}

		const isJeans = fake.managedAutoPlaylists.has(playlist.id);
		if (!isJeans && asked?.key !== undefined && asked.key !== "")
			return json(response, { error: "unacceptable key", detail: "" }, 400);

		if (isJeans) fake.managedAutoPlaylists.set(playlist.id, managedOf(asked));
		if (typeof asked?.title === "string" && asked.title.length > 0)
			state.renamePlaylist(playlist.id, asked.title);

		// The refill foobar2000 does once the query changes.
		const tracks = state.previewTracks(String(asked?.query ?? ""));
		state.editItems(playlist, () => {
			playlist.items = tracks;
		});
		state.notifyPlaylists();
		return json(response, annotationOf(state, playlist));
	}

	return notFound(response);
}
