import type { components } from "../../../src/shared/api/fooJeanSchema.d.ts";
import { json, one, type RequestHeaders, type Responder } from "../http.ts";
import { libraryItemsOf, type Track } from "../state.ts";
import { evaluate } from "../titleFormat.ts";
import {
	ASK_EVERY_TIME,
	NOT_BUILT,
	notFound,
	STRUCTURE_MOVED,
} from "./answers.ts";
import { abandoned, STALLED_READ_MS } from "./latency.ts";
import type { FooJeanFake } from "./options.ts";
import { refuseTooFast, spend } from "./rateLimits.ts";
import type { Asked, FakeState } from "./request.ts";

// RFC 9110's negotiation, as the component reads it: `gzip;q=0` is a refusal, and `*` offers
// nothing rather than everything.
const offersGzip = (headers: RequestHeaders) => {
	const offered = /(?:^|,)\s*gzip\s*(?:;\s*q\s*=\s*([\d.]+))?/.exec(
		one(headers["accept-encoding"]).toLowerCase(),
	);
	if (!offered) return false;
	return offered[1] === undefined || Number(offered[1]) > 0;
};

const gzipped = async (bytes: Uint8Array<ArrayBuffer>) => {
	const zip = new CompressionStream("gzip");
	const writer = zip.writable.getWriter();
	void writer.write(bytes);
	void writer.close();
	return new Uint8Array(await new Response(zip.readable).arrayBuffer());
};

export const MAX_TRACK_ADDRESS = 4096;

export const NAMES_TWO_TRACKS =
	"the media library holds more than one track at that address" satisfies components["schemas"]["TagFailed"]["error"];

export const subsongOf = (track: Track) => Number(track["%subsong%"]) || 0;

export const hasLibrarySnapshot = (state: FakeState) =>
	state.libraryFeed.columns.length > 0;

// The snapshot holds a track under each root, and the component answers neither.
// A property of the address rather than of the route, so both routes that take
// one ask before they resolve.
export const namesTwoTracks = (state: FakeState, address: unknown) =>
	typeof address === "string" && address === state.fooJean.twoRootsHold;

// Resolved against the snapshot's own relative paths rather than by the key the
// row that named it was minted from: a fake that answers its own spelling back
// proves nothing. The relative paths are part of the snapshot, so a component
// holding none resolves no library address at all, which is the `404` a player
// that has just started answers every library-form write with.
export const libraryTrackAt = (
	state: FakeState,
	address: string,
	subsong: number,
) => {
	if (!hasLibrarySnapshot(state)) return null;
	return (
		libraryItemsOf(state.libraryTracks).find(
			(entry) => entry.path === address && entry.subsong === subsong,
		)?.track ?? null
	);
};

// `librarySlice` mirrors `kQuerySlice` in `fb2k/library.cpp`.
export const libraryBuildOf = (
	state: FakeState,
	fake: FooJeanFake,
): components["schemas"]["LibraryBuild"] | null => {
	const feed = state.libraryFeed;
	if (!feed.building) return null;

	const total = state.libraryTracks.length;
	const totalSlices = Math.max(1, Math.ceil(total / fake.librarySlice));
	const formattingSteps = totalSlices - 1;
	const stepIndex = Math.min(feed.buildTicks, 1 + formattingSteps);

	if (stepIndex === 0) return { phase: "listing", formatted: 0, total: 0 };
	if (stepIndex === 1) return { phase: "ordering", formatted: 0, total };
	return {
		phase: "formatting",
		formatted: (stepIndex - 1) * fake.librarySlice,
		total,
	};
};

export const libraryStateOf = (state: FakeState, fake: FooJeanFake) => {
	const { structure, revision, columns } = state.libraryFeed;
	const ready = hasLibrarySnapshot(state);
	return {
		ready,
		structure,
		revision,
		trackCount: ready ? state.libraryTracks.length : 0,
		columns,
		build: libraryBuildOf(state, fake),
	};
};

const sameMembers = (held: string[], asked: string[]) =>
	held.length === asked.length && asked.every((one) => held.includes(one));

const MAX_COLUMNS = 64;

const refuseColumns = (asked: string[]) => {
	if (asked.length === 0)
		return { error: "unacceptable column", detail: "'columns' is required" };
	if (asked.length > MAX_COLUMNS)
		return {
			error: "too many columns",
			detail: `${asked.length} columns were asked for`,
		};
	const empty = asked.findIndex((column) => column.length === 0);
	if (empty >= 0)
		return {
			error: "unacceptable column",
			detail: `column ${empty} is empty`,
		};
	return null;
};

// 413 and 503 are `kLibraryTooLarge` and `kNoLibrary` in
// `plugins/fb2k/src/core/http_server.cpp`, verbatim. 500 stands for a failure
// this route has no fixed wording for. `errorDocument` there writes only
// `error`, with no `detail` field.
const LIBRARY_EXPORT_FAILURE: Record<413 | 500 | 503, { error: string }> = {
	413: {
		error: "the library snapshot is larger than this component sends",
	},
	500: { error: "the library export failed" },
	503: { error: "the media library is not available" },
};

const tagOf = (state: FakeState, coding: string, since?: string) =>
	`"s${state.libraryFeed.structure}-r${state.libraryFeed.revision}${
		since === undefined ? "" : `-f${since}`
	}-${coding}"`;

const sendBlob = async (
	response: Responder,
	headers: RequestHeaders,
	state: FakeState,
	bytes: Uint8Array<ArrayBuffer>,
	since?: string,
) => {
	const gzip = offersGzip(headers);
	const body = gzip ? await gzipped(bytes) : bytes;

	response.writeHead(200, {
		"Content-Type": "application/octet-stream",
		"Cache-Control": ASK_EVERY_TIME,
		Vary: "Origin, Accept-Encoding",
		ETag: tagOf(state, gzip ? "gzip" : "identity", since),
		...(gzip ? { "Content-Encoding": "gzip" } : null),
	});
	response.end(body);
	return true;
};

export async function handleLibrary({
	state,
	fake,
	method,
	path,
	url,
	headers,
	response,
	recorded,
}: Asked) {
	if (!fake.canReadLibrary)
		return json(response, { error: "the media library is not available" }, 503);

	// Rebuilds the set already declared, so it answers as the export's own `202` does
	// and the build finishes on the ticks that follow.
	if (method === "POST" && path === "/api/library/refresh") {
		const columns = state.libraryFeed.columns;
		if (columns.length > 0 && state.libraryFeed.building === null)
			state.startLibraryBuild(columns);
		return json(response, libraryStateOf(state, fake), 202);
	}

	if (method !== "GET") return notFound(response);

	// One track's columns, addressed the way a cover is. It echoes no
	// `libraryPath`, because the caller supplied the address.
	if (path === "/api/track/library") {
		if (fake.failLibraryTrack) {
			if (fake.failLibraryTrack === 429) response.setHeader("Retry-After", "1");
			return json(
				response,
				{ error: "the player could not read that track", detail: "" },
				fake.failLibraryTrack,
			);
		}
		// Nothing is answered once the hold is up either, for the reason
		// `hangLibraryTrack` gives.
		if (fake.hangLibraryTrack) {
			await abandoned(response, STALLED_READ_MS);
			return true;
		}

		const namesTrack =
			url.searchParams.has("track") || url.searchParams.has("subsong");
		const namesOrdinal = url.searchParams.has("ordinal");
		if (namesTrack && namesOrdinal)
			return json(
				response,
				{
					error: "a request names one of 'track' and 'ordinal', never both",
					detail: "",
				},
				400,
			);

		if (namesOrdinal) {
			const ordinal = url.searchParams.get("ordinal") ?? "";
			if (!/^\d+$/.test(ordinal) || Number(ordinal) > 0xffff_ffff)
				return json(
					response,
					{ error: "'ordinal' must be a non-negative number", detail: "" },
					400,
				);
			const structure = url.searchParams.get("structure") ?? "";
			if (!/^\d+$/.test(structure))
				return json(
					response,
					{
						error: "'structure' is required and must be a non-negative number",
						detail: "",
					},
					400,
				);

			const asked = url.searchParams.getAll("columns");
			const refused = refuseColumns(asked);
			if (refused) return json(response, refused, 400);

			if (Number(structure) !== state.libraryFeed.structure)
				return json(response, STRUCTURE_MOVED, 409);

			const held = hasLibrarySnapshot(state)
				? state.ordinalOrder()[Number(ordinal)]?.track
				: null;
			if (!held) return json(response, { error: "no such track" }, 404);

			return json(response, {
				columns: asked.map((expression) => evaluate(held, expression)),
			});
		}

		if (!namesTrack)
			return json(
				response,
				{ error: "'track' or 'ordinal' is required", detail: "" },
				400,
			);

		const asked = url.searchParams.getAll("columns");
		const refused = refuseColumns(asked);
		if (refused) return json(response, refused, 400);

		const address = url.searchParams.get("track") ?? "";
		if (!address || address.length > MAX_TRACK_ADDRESS)
			return json(
				response,
				{ error: "unacceptable track address", detail: "" },
				400,
			);

		// The caller asked this to find out what a write did, so one of the two
		// tracks at that address is worse than none.
		if (namesTwoTracks(state, address))
			return json(response, { error: NAMES_TWO_TRACKS, detail: "" }, 409);

		const held = libraryTrackAt(
			state,
			address,
			Number(url.searchParams.get("subsong")) || 0,
		);
		if (!held) return json(response, { error: "no such track" }, 404);

		return json(response, {
			columns: asked.map((expression) => evaluate(held, expression)),
		});
	}

	if (path === "/api/library/export") {
		const asked = [...new Set(url.searchParams.getAll("columns"))];
		const refused = refuseColumns(asked);
		if (refused) return json(response, refused, 400);

		if (fake.failLibraryExport && fake.failLibraryExport.times > 0) {
			const { status } = fake.failLibraryExport;
			fake.failLibraryExport.times -= 1;
			return json(response, LIBRARY_EXPORT_FAILURE[status], status);
		}

		if (fake.libraryBusy > 0) {
			fake.libraryBusy -= 1;
			return refuseTooFast(response, "libraryRebuilds");
		}

		if (!sameMembers(state.libraryFeed.columns, asked)) {
			const alreadyBuildingAsked =
				state.libraryFeed.building !== null &&
				sameMembers(state.libraryFeed.building, asked);
			if (!alreadyBuildingAsked) {
				if (
					fake.rateLimits &&
					!spend(fake.limiter, fake.rateLimits, "libraryRebuilds", "")
				) {
					recorded.limited = "libraryRebuilds";
					return refuseTooFast(response, "libraryRebuilds");
				}
				state.startLibraryBuild(asked);
			}
			if (fake.libraryBuilds > 0 || !fake.libraryReady)
				return json(response, libraryStateOf(state, fake), 202);
			state.finishLibraryBuild();
		}

		return sendBlob(response, headers, state, state.libraryExport());
	}

	if (path === "/api/library/changes") {
		if (state.libraryFeed.columns.length === 0)
			return json(response, NOT_BUILT, 503);
		const since = url.searchParams.get("since");
		if (since === null || !/^\d+$/.test(since))
			return json(
				response,
				{ error: "unacceptable revision", detail: "'since' is required" },
				400,
			);

		const changes = state.libraryChanges(Number(since));
		if (changes.status === 409)
			return json(
				response,
				{
					error: "tracks were added or removed; export the library again",
					detail: "",
				},
				409,
			);
		if (changes.status === 410)
			return json(
				response,
				{
					error:
						"that revision is older than the retained window; export the library again",
					detail: "",
				},
				410,
			);

		return sendBlob(response, headers, state, changes.bytes, since);
	}

	return notFound(response);
}

// Outside handleLibrary on purpose: this route answers even in the window
// canReadLibrary gates every /api/library/ route behind.
export async function handlePlayingTrack({
	fake,
	url,
	response,
	addressed,
}: Asked) {
	response.setHeader("Cache-Control", ASK_EVERY_TIME);

	const knobsApply =
		fake.playingTrackKnobsFor === null || fake.playingTrackKnobsFor > 0;
	if (fake.playingTrackKnobsFor) fake.playingTrackKnobsFor -= 1;

	if (knobsApply && fake.failPlayingTrack) {
		if (fake.failPlayingTrack === 429) response.setHeader("Retry-After", "1");
		return json(
			response,
			{ error: "the player could not read the playing track", detail: "" },
			fake.failPlayingTrack,
		);
	}

	if (knobsApply && fake.hangPlayingTrack) {
		await abandoned(response, STALLED_READ_MS);
		return true;
	}

	const asked = url.searchParams.getAll("columns");
	const refused = refuseColumns(asked);
	if (refused) return json(response, refused, 400);

	const track = addressed.playingTrack();
	if (!track) return json(response, { error: "nothing is playing" }, 404);

	return json(response, {
		path:
			(knobsApply ? fake.playingTrackAnswersPath : null) ??
			String(evaluate(track, "%path%") ?? ""),
		subsong:
			(knobsApply ? fake.playingTrackAnswersSubsong : null) ??
			(Number(track["%subsong%"]) || 0),
		columns: asked.map((expression) => evaluate(track, expression)),
	});
}
