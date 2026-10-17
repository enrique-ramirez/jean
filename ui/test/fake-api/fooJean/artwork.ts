import { json, type Responder } from "../http.ts";
import { ASK_EVERY_TIME, notFound } from "./answers.ts";
import { abandoned, STALLED_READ_MS } from "./latency.ts";
import { MAX_TRACK_ADDRESS } from "./library.ts";
import type { Asked } from "./request.ts";

const SECONDS_PER_DAY = 24 * 60 * 60;

// Word for word what `kCoverCacheLifetimeSeconds`, `kStaleCoverDrawnForSeconds` and
// `kMissingCoverCacheLifetimeSeconds` in the component's `core/routes_artwork.cpp` hold.
const COVER_CACHE_LIFETIME_SECONDS = 7 * SECONDS_PER_DAY;
const STALE_COVER_DRAWN_FOR_SECONDS = 180 * SECONDS_PER_DAY;
const MISSING_COVER_CACHE_LIFETIME_SECONDS = 10 * 60;

const freshFor = (seconds: number) => `private, max-age=${seconds}`;

const HELD_COVER = `${freshFor(COVER_CACHE_LIFETIME_SECONDS)}, stale-while-revalidate=${STALE_COVER_DRAWN_FOR_SECONDS}`;

// Both artwork routes answer 404 with this one string, as the component does:
// from a reader's side "no cover for that track" and "no cover for whatever is
// playing" are one fact.
const NO_ARTWORK = { error: "no artwork for that track" };

// The status and the body size go into the request log, because a cover sent
// again and a cover revalidated are one GET at one address and a spec asserting
// on paths alone cannot tell them apart.
const reporting = (
	response: Responder,
	note: (answer: { status: number; bytes: number }) => void,
): Responder => {
	let status = 0;
	let bytes = 0;
	return {
		writeHead(code, headers) {
			status = code;
			return response.writeHead(code, headers);
		},
		setHeader: (name, value) => response.setHeader(name, value),
		write(chunk) {
			bytes += chunk.length;
			return response.write(chunk);
		},
		end(body) {
			if (body) bytes += body.length;
			note({ status, bytes });
			return response.end(body);
		},
		on: (event, listener) => response.on(event, listener),
		destroy: () => response.destroy(),
		get writableEnded() {
			return response.writableEnded;
		},
	};
};

const ARTWORK_FAILURES: Record<number, { error: string }> = {
	400: { error: "unacceptable track address" },
	404: NO_ARTWORK,
	413: { error: "that artwork is larger than this component sends" },
	429: { error: "too many artwork requests" },
	500: { error: "the player could not do that" },
	503: { error: "artwork is not available" },
	504: { error: "the player did not answer in time" },
};

const refuseArtwork = (response: Responder, status: number) => {
	if (status === 429) response.setHeader("Retry-After", "1");
	return json(response, ARTWORK_FAILURES[status], status);
};

export async function handleArtwork({
	state,
	fake,
	path,
	url,
	headers,
	response,
	recorded,
	session,
	artwork,
}: Asked) {
	const sendCover = (file: string, cacheControl: string) => {
		const conditional = Boolean(headers["if-none-match"]);
		return artwork(
			file,
			headers,
			reporting(response, (answer) => {
				recorded.answered = { conditional, ...answer };
			}),
			cacheControl,
		);
	};

	if (path === "/api/artwork") {
		if (fake.failArtwork) return refuseArtwork(response, fake.failArtwork);
		if (fake.hangArtwork) {
			await abandoned(response, STALLED_READ_MS);
			return true;
		}

		const track = url.searchParams.get("track") ?? "";
		if (!track || track.length > MAX_TRACK_ADDRESS)
			return json(response, { error: "unacceptable track address" }, 400);

		const file = state.libraryArtworkFor(track);
		if (!file) {
			response.setHeader(
				"Cache-Control",
				freshFor(MISSING_COVER_CACHE_LIFETIME_SECONDS),
			);
			return json(response, NO_ARTWORK, 404);
		}

		return sendCover(file, HELD_COVER);
	}

	// Addressed by nothing: no path, no index, no handle. Not gated on the media
	// library either, which is why the contract gives this route no 503 where
	// `GET /api/artwork` has one. The same URL names a different picture once the
	// track changes, so every outcome here revalidates rather than holding.
	// Poorer than the component in two ways. This resolves a sleeve by matching the playing path
	// against the captured albums, so a track it has never seen answers 404, where the component
	// reads the file through foobar2000's now-playing loader and gives an off-library track with
	// embedded art a cover. And it resolves a new cover in the same tick, where the component
	// clears the held picture on a track change and answers 404 until the core pushes the next one.
	// A spec cannot see that gap, and modelling it would put a timing race into the assertion that
	// a track change within an album costs no request, since every row addresses the same cover.
	if (path === "/api/artwork/playing") {
		response.setHeader("Cache-Control", ASK_EVERY_TIME);
		if (fake.failPlayingArtwork)
			return refuseArtwork(response, fake.failPlayingArtwork);

		const file = session
			? state.artworkOfTrack(session.playingTrack())
			: state.playingArtwork();
		if (!file) return json(response, NO_ARTWORK, 404);

		return sendCover(file, ASK_EVERY_TIME);
	}

	// The fallback for a row `GET /api/artwork` cannot address: no path reaches the
	// client, so the playlist and the row stand in for one. A row the media library
	// already holds a path for is refused the same way a missing cover is -- one
	// album is one address, and a position is not an address for an album. A
	// position outlives no reorder, so every outcome revalidates rather than holding.
	const positionalArtworkMatch =
		/^\/api\/artwork\/playlists\/([^/]+)\/(\d+)$/.exec(path);
	if (positionalArtworkMatch) {
		response.setHeader("Cache-Control", ASK_EVERY_TIME);
		if (fake.failRowArtwork)
			return refuseArtwork(response, fake.failRowArtwork);

		const [, guid, rowText] = positionalArtworkMatch;
		const playlist = state.playlistByGuid(guid);
		if (!playlist) return json(response, { error: "no such playlist" }, 404);

		const track = playlist.items[Number(rowText)];
		if (!track)
			return json(response, { error: "that position is past the end" }, 404);

		if (state.libraryPathFor(track)) return json(response, NO_ARTWORK, 404);

		const file = state.artworkFor(playlist.id, Number(rowText));
		if (!file) return json(response, NO_ARTWORK, 404);

		return sendCover(file, ASK_EVERY_TIME);
	}

	return notFound(response);
}
