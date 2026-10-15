import { json, type Responder } from "../http.ts";
import type { Track } from "../state.ts";
import { notFound } from "./answers.ts";
import { delay } from "./latency.ts";
import {
	hasLibrarySnapshot,
	libraryTrackAt,
	NAMES_TWO_TRACKS,
	namesTwoTracks,
	subsongOf,
} from "./library.ts";
import type { Asked, FakeState } from "./request.ts";
import { generationText } from "./requestBodies.ts";

// What a write answers when the position it named was read at an older
// structure. `TagFailed` declares no `detail`, so the playlist routes' own
// `ROWS_MOVED` takes this sentence and adds one rather than the other way round.
export const TAG_ROWS_MOVED = {
	written: false,
	error:
		"the playlist's rows were added, removed or reordered; read them again",
};

const NO_SUCH_TRACK = {
	written: false,
	error: "foobar2000 does not know that track",
};

const LIBRARY_REBUILT = {
	written: false,
	error: "the media library was rebuilt; export it again",
};

const FAILURES: Record<number, unknown> = {
	403: {
		written: false,
		error: "field not allowed",
		detail: "rating",
		field: "rating",
	},
	404: NO_SUCH_TRACK,
	409: TAG_ROWS_MOVED,
	500: { written: false, error: "the player could not write the tags" },
	503: { written: false, error: "tag writing is not available" },
	504: { written: false, error: "the player did not answer in time" },
	429: { written: false, error: "too many tag writes" },
};

const refuseWrite = (response: Responder, status: number) => {
	if (status === 429) response.setHeader("Retry-After", "1");
	return json(
		response,
		FAILURES[status] ?? { written: false, error: "refused" },
		status,
	);
};

// The player holds one file's tags once, so a write reaches every copy of the
// track the fake is holding: the playlist row it was addressed through and the
// media library's own entry, which are separate objects whenever `withoutFields`
// or `retagged` copied one.
const applyTags = (
	state: FakeState,
	target: Track,
	fields: Record<string, string>,
) => {
	const patch = (track: Track) => {
		if (track["%path%"] !== target["%path%"]) return;
		if (subsongOf(track) !== subsongOf(target)) return;
		for (const [field, value] of Object.entries(fields)) {
			// foobar2000 answers `%field%` and `$meta(field)` from the one tag.
			const spellings = [`%${field}%`, `$meta(${field.toLowerCase()})`];
			for (const spelling of spellings) {
				if (value === "") delete track[spelling];
				else track[spelling] = value;
			}
		}
	};

	for (const playlist of state.playlists)
		for (const track of playlist.items) patch(track);
	for (const track of state.libraryTracks) patch(track);
	state.libraryEdited();
};

export async function handleTags({
	state,
	fake,
	method,
	body,
	response,
}: Asked) {
	if (method !== "POST") return notFound(response);

	if (state.latency > 0) await delay(state.latency);

	const written = body as {
		track?: unknown;
		subsong?: unknown;
		ordinal?: unknown;
		playlist?: unknown;
		index?: unknown;
		structure?: unknown;
		fields?: Record<string, string>;
	} | null;

	// Decided while the address is being resolved and so ahead of `failWrites`,
	// which stands for the player failing at a write it had already taken on.
	if (namesTwoTracks(state, written?.track))
		return json(response, { written: false, error: NAMES_TWO_TRACKS }, 409);

	// A write that lands anyway is refused at the end instead, once the address
	// has resolved and the tag has been written.
	if (fake.failWrites && !fake.writesLandAnyway)
		return refuseWrite(response, fake.failWrites);

	if (!written?.fields || Object.keys(written.fields).length === 0)
		return json(
			response,
			{
				written: false,
				error: "no fields to write",
				detail: "'fields' names at least one tag",
			},
			400,
		);

	// No filesystem path crosses this API any more, so a client still sending
	// one is refused rather than met halfway: the component declares its
	// members and takes nothing else.
	if ("path" in written)
		return json(
			response,
			{
				written: false,
				error: "unacceptable address",
				detail: "'path' is not a member of this request",
			},
			400,
		);

	const forms = (["track", "ordinal", "playlist"] as const).filter(
		(form) => written[form] !== undefined,
	);
	if (forms.length !== 1)
		return json(
			response,
			{
				written: false,
				error: "unacceptable address",
				detail:
					forms.length === 0
						? "'track', 'ordinal' or 'playlist' is required"
						: "a request names one of 'track', 'ordinal' and 'playlist', never two",
			},
			400,
		);

	const refused = Object.keys(written.fields).find(
		(field) =>
			!fake.allowedFields.some(
				(allowed) => allowed.toLowerCase() === field.toLowerCase(),
			),
	);
	if (refused)
		return json(
			response,
			{
				written: false,
				error: "field not allowed",
				detail: refused,
				field: refused,
			},
			403,
		);

	const stored =
		fake.storesRatingAs !== null && "rating" in written.fields
			? { ...written.fields, rating: fake.storesRatingAs }
			: written.fields;

	// The precise library form. One ordinal names one track of one root, so
	// nothing here can be ambiguous; what it can be is held against a snapshot
	// the player has replaced.
	if (forms[0] === "ordinal") {
		if (
			!Number.isInteger(written.ordinal) ||
			!Number.isInteger(written.structure)
		)
			return json(
				response,
				{
					written: false,
					error: "unacceptable address",
					detail: "'ordinal' and 'structure' are whole numbers",
				},
				400,
			);

		if (written.structure !== state.libraryFeed.structure)
			return json(response, LIBRARY_REBUILT, 409);

		// One answer for an ordinal past the end of the snapshot as well as for a
		// generation that has moved, because the component's own resolver reports
		// both as a miss and `writeToOrdinal` cannot tell them apart.
		const held = hasLibrarySnapshot(state)
			? state.ordinalOrder()[written.ordinal as number]?.track
			: null;
		if (!held) return json(response, LIBRARY_REBUILT, 409);

		applyTags(state, held, stored);
		if (fake.failWrites) return refuseWrite(response, fake.failWrites);
		return json(response, {
			written: true,
			ordinal: written.ordinal,
			fields: stored,
		});
	}

	if (forms[0] === "track") {
		if (
			typeof written.track !== "string" ||
			(written.subsong !== undefined &&
				!Number.isInteger(written.subsong as number))
		)
			return json(
				response,
				{
					written: false,
					error: "unacceptable address",
					detail: "'track' is a string and 'subsong' a whole number",
				},
				400,
			);

		const subsong = (written.subsong as number) ?? 0;
		const held = libraryTrackAt(state, written.track, subsong);
		if (!held) return json(response, NO_SUCH_TRACK, 404);

		applyTags(state, held, stored);
		if (fake.failWrites) return refuseWrite(response, fake.failWrites);
		return json(response, {
			written: true,
			track: written.track,
			subsong,
			fields: stored,
		});
	}

	if (
		typeof written.playlist !== "string" ||
		!Number.isInteger(written.index as number) ||
		typeof written.structure !== "string"
	)
		return json(
			response,
			{
				written: false,
				error: "unacceptable address",
				detail:
					"'playlist' and 'structure' are strings and 'index' a whole number",
			},
			400,
		);

	const playlist = state.playlistByGuid(written.playlist);
	if (!playlist) return json(response, NO_SUCH_TRACK, 404);

	// Before the row is read, so a write aimed at one row can never land on
	// another.
	if (written.structure !== generationText(playlist.structure))
		return json(response, TAG_ROWS_MOVED, 409);

	const row = playlist.items[written.index as number];
	if (!row) return json(response, NO_SUCH_TRACK, 404);

	applyTags(state, row, stored);
	if (fake.failWrites) return refuseWrite(response, fake.failWrites);
	return json(response, {
		written: true,
		playlist: written.playlist,
		index: written.index,
		fields: stored,
	});
}
