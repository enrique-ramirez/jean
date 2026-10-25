import type { components } from "../../../src/shared/api/fooJeanSchema.d.ts";
import { json, type Responder } from "../http.ts";

// Word for word what `kAskEveryTime` sends: the playing cover and the positional fallback name
// a different picture once the track or the row changes, and the state and library routes must
// stay current, so none of the five may be held past the request that answered it.
export const ASK_EVERY_TIME = "private, no-cache";

const NOT_FOUND = { error: "not found" };

export const notFound = (response: Responder) => json(response, NOT_FOUND, 404);

export const NOT_BUILT = {
	error: "the library snapshot has not been built yet",
	detail: "",
};

export const STRUCTURE_MOVED = {
	error: "tracks were added or removed; read the state and ask again",
	detail: "",
};

export const WRITES_DISABLED = {
	error:
		"this install has playlist writes turned off; turn on writePlaylists in config.json to allow them",
	detail: "",
} satisfies components["schemas"]["PlaylistFailed"];

export const PLAYER_REFUSED = {
	error: "the player could not do that",
	detail: "",
};

export const OWN_PLAYLIST = {
	error:
		"that playlist is foo_jean's own; address it by its role rather than by its id",
	detail: "",
};

export const NO_SUCH_SESSION = { error: "no such session" };
