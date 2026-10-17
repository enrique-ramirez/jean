import type { components } from "../../../src/shared/api/fooJeanSchema.d.ts";
import { json, one, type RequestHeaders, type Responder } from "../http.ts";
import { compareUtf8 } from "../jlib.ts";
import {
	type ChangesRefusal,
	libraryItemsOf,
	sameMembers,
	type Track,
} from "../state.ts";
import { evaluate } from "../titleFormat.ts";
import {
	ASK_EVERY_TIME,
	NOT_BUILT,
	notFound,
	STRUCTURE_MOVED,
} from "./answers.ts";
import { abandoned, STALLED_READ_MS } from "./latency.ts";
import {
	fixedOffset,
	type LocalTime,
	SUMMARY_ROLES,
	type SummaryRole,
	summarise,
} from "./librarySummary.ts";
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

const compress = async (bytes: Uint8Array<ArrayBuffer>) => {
	const zip = new CompressionStream("gzip");
	const writer = zip.writable.getWriter();
	void writer.write(bytes);
	void writer.close();
	return new Uint8Array(await new Response(zip.readable).arrayBuffer());
};

const packed = new WeakMap<Uint8Array, Promise<Uint8Array<ArrayBuffer>>>();

const gzipped = (bytes: Uint8Array<ArrayBuffer>) => {
	let held = packed.get(bytes);
	if (!held) {
		held = compress(bytes);
		packed.set(bytes, held);
	}
	return held;
};

export { MAX_LIBRARY_BYTES } from "./options.ts";

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
		snapshotId: state.librarySnapshotId(),
		trackCount: ready ? state.libraryTracks.length : 0,
		columns,
		build: fake.libraryHalted ? null : libraryBuildOf(state, fake),
		halted: fake.libraryHalted,
	};
};

const MAX_COLUMNS = 64;

const refuseOnly = (declared: string[], only: string[]) => {
	for (let at = 0; at < only.length; at += 1) {
		if (!declared.includes(only[at]))
			return {
				error: "column not declared",
				detail: `'only' column ${at} is not one of 'columns'`,
			};
		if (only.indexOf(only[at]) < at)
			return {
				error: "duplicate column",
				detail: `'only' column ${at} repeats an earlier one`,
			};
	}
	return null;
};

// cpp-httplib drops a query pair whose raw text repeats an earlier one before the component reads
// any, so `only=A&only=A` reaches it as one column.
const pairsAsTheComponentReadsThem = (url: URL) =>
	new URLSearchParams([...new Set(url.search.slice(1).split("&"))].join("&"));

const CHANGES_REFUSAL: Record<ChangesRefusal, string> = {
	pairNotHeld:
		"that structure and revision name no position this library held; export the library again",
	revisionTooOld:
		"that revision is older than the retained window; export the library again",
	revisionUnknown: "no such revision",
	spliceTooLarge:
		"the tracks added or removed since then are too many to send; export the library again",
	dictionariesCompacted:
		"the library was rebuilt with its dictionaries compacted; export the library again",
	rearranged:
		"the library was rebuilt with other columns or in another order; export the library again",
};

const subsetReleased = async (fake: FooJeanFake, only: string[]) => {
	const holds = () => {
		const { holdSubset } = fake;
		return holdSubset !== null && only.some((one) => holdSubset.includes(one));
	};
	while (holds())
		await new Promise<void>((release) => fake.subsetsHeld.push(release));
};

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
// `plugins/fb2k/src/core/failures.h`, verbatim. 500 stands for a failure
// this route has no fixed wording for. `errorDocument` there writes only
// `error`, with no `detail` field.
const LIBRARY_EXPORT_FAILURE: Record<413 | 500 | 503, { error: string }> = {
	413: {
		error: "the library snapshot is larger than this component sends",
	},
	500: { error: "the library export failed" },
	503: { error: "the media library is not available" },
};

const SUMMARY_FAILURE: Record<500 | 503, { error: string }> = {
	500: { error: "the library summary failed" },
	503: LIBRARY_EXPORT_FAILURE[503],
};

const tagOf = (state: FakeState, coding: string, variant = "") =>
	`"s${state.libraryFeed.structure}-r${state.libraryFeed.revision}-e${state.libraryFeed.edits}${variant}-${coding}"`;

const holdsTag = (headers: RequestHeaders, tag: string) =>
	one(headers["if-none-match"])
		.split(",")
		.some((candidate) => candidate.trim() === "*" || candidate.trim() === tag);

// `produce` runs after the `If-None-Match` check and before the ceiling, the order
// `sendBodyIfChanged` in `plugins/fb2k/src/core/http_responses.cpp` keeps.
const sendBlob = async (
	response: Responder,
	headers: RequestHeaders,
	state: FakeState,
	fake: FooJeanFake,
	produce: () => Uint8Array<ArrayBuffer>,
	variant?: string,
	{ contentType = "application/octet-stream", capped = true } = {},
) => {
	const gzip = offersGzip(headers);
	const tag = tagOf(state, gzip ? "gzip" : "identity", variant);
	const revalidating = {
		"Cache-Control": ASK_EVERY_TIME,
		Vary: "Origin, Accept-Encoding",
		ETag: tag,
	};

	if (holdsTag(headers, tag)) {
		response.writeHead(304, revalidating);
		response.end();
		return true;
	}

	const bytes = produce();
	if (
		capped &&
		fake.libraryCeiling !== null &&
		bytes.length > fake.libraryCeiling
	)
		return json(response, LIBRARY_EXPORT_FAILURE[413], 413);

	const body = gzip ? await gzipped(bytes) : bytes;

	response.writeHead(200, {
		"Content-Type": contentType,
		...revalidating,
		...(gzip ? { "Content-Encoding": "gzip" } : null),
	});
	response.end(body);
	return true;
};

const MAX_EXPRESSION_BYTES = 1024;

const UNPRINTABLE = /[^\u0020-\u007e\u0080-\u{10ffff}]/u;

const refusedRole = (error: string, detail: string) => ({ error, detail });

const rolesAsked = (url: URL) => {
	const asked = new Map<SummaryRole, string>();
	// cpp-httplib holds the pairs in a multimap, so the component reads them in name order.
	const pairs = [...pairsAsTheComponentReadsThem(url)].sort(([a], [b]) =>
		compareUtf8(a, b),
	);
	for (const [name, expression] of pairs) {
		if (!SUMMARY_ROLES.includes(name as SummaryRole))
			return refusedRole("unacceptable role", `'${name}' is not a role`);
		if (
			expression === "" ||
			new TextEncoder().encode(expression).length > MAX_EXPRESSION_BYTES ||
			UNPRINTABLE.test(expression)
		)
			return refusedRole(
				"unacceptable role",
				`role '${name}' must be printable text of 1 to ${MAX_EXPRESSION_BYTES} characters`,
			);
		if (asked.has(name as SummaryRole))
			return refusedRole("duplicate role", `role '${name}' is named twice`);
		asked.set(name as SummaryRole, expression);
	}
	return asked;
};

const hashOf = (text: string) => {
	let hash = 0x811c9dc5;
	for (let at = 0; at < text.length; at += 1)
		hash = Math.imul(hash ^ text.charCodeAt(at), 0x01000193) >>> 0;
	return hash.toString(16);
};

interface BuiltSummary {
	variant: string;
	bytes: Uint8Array<ArrayBuffer>;
}

const summariesBuilt = new WeakMap<FakeState, Map<string, BuiltSummary>>();

const summaryReleased = async (fake: FooJeanFake) => {
	while (fake.holdSummary)
		await new Promise<void>((release) => fake.summariesHeld.push(release));
};

const buildSummary = (
	state: FakeState,
	roles: Map<SummaryRole, string>,
	now: number,
	local: LocalTime,
): Uint8Array<ArrayBuffer> => {
	const { structure, revision } = state.libraryFeed;
	const items = state.ordinalOrder();
	const directoryEnd = (path: string) => path.lastIndexOf("/") + 1;
	const columns = Object.fromEntries(
		[...roles].map(([role, expression]) => [
			role,
			items.map((entry) => String(evaluate(entry.track, expression))),
		]),
	);
	const document = summarise(
		{
			structure,
			revision,
			directory: items.map((entry) =>
				entry.path.slice(0, directoryEnd(entry.path)),
			),
			filename: items.map((entry) =>
				entry.path.slice(directoryEnd(entry.path)),
			),
			columns,
		},
		now,
		local,
	);
	return new TextEncoder().encode(
		JSON.stringify(document),
	) as Uint8Array<ArrayBuffer>;
};

const summaryOf = (
	state: FakeState,
	roles: Map<SummaryRole, string>,
	now: number,
): BuiltSummary => {
	const local = fixedOffset(-new Date(now).getTimezoneOffset());
	const roleSet = [...roles].map(([role, from]) => `${role}=${from}`).sort();
	const date = local.yyyymmddOf(now);
	const variant = `-d${date}-${hashOf(roleSet.join("\u0000"))}`;
	const { structure, revision, edits } = state.libraryFeed;
	const key = [structure, revision, edits, variant].join("\u0000");

	const built = summariesBuilt.get(state) ?? new Map<string, BuiltSummary>();
	summariesBuilt.set(state, built);
	const kept = built.get(key);
	if (kept) return kept;

	const made = { variant, bytes: buildSummary(state, roles, now, local) };
	built.set(key, made);
	return made;
};

async function handleLibrarySummary({
	state,
	fake,
	url,
	headers,
	response,
	recorded,
}: Asked) {
	const roles = rolesAsked(url);
	if (!(roles instanceof Map)) return json(response, roles, 400);

	if (!fake.canReadLibrary)
		return json(response, LIBRARY_EXPORT_FAILURE[503], 503);

	if (fake.failSummary && fake.failSummary.times > 0) {
		const { status } = fake.failSummary;
		fake.failSummary.times -= 1;
		return status === 429
			? refuseTooFast(response, "librarySummaries")
			: json(response, SUMMARY_FAILURE[status], status);
	}

	if (
		fake.rateLimits &&
		!spend(fake.limiter, fake.rateLimits, "librarySummaries", "")
	) {
		recorded.limited = "librarySummaries";
		return refuseTooFast(response, "librarySummaries");
	}

	const { columns, building } = state.libraryFeed;
	const expressions = [...roles.values()];
	const stillBuilding = (from: string) =>
		!columns.includes(from) && building?.includes(from);
	if (!hasLibrarySnapshot(state) || expressions.some(stillBuilding))
		return json(response, libraryStateOf(state, fake), 202);

	const undeclared = expressions.find(
		(from) => !columns.includes(from) && !building?.includes(from),
	);
	if (undeclared !== undefined)
		return json(
			response,
			{ error: `'${undeclared}' is not a declared column` },
			409,
		);

	await summaryReleased(fake);

	const { variant, bytes } = summaryOf(state, roles, Date.now());
	return sendBlob(response, headers, state, fake, () => bytes, variant, {
		contentType: "application/json; charset=utf-8",
		capped: false,
	});
}

export async function handleLibrary(asked: Asked) {
	const { state, fake, method, path, url, headers, response, recorded } = asked;
	if (method === "GET" && path === "/api/library/summary")
		return handleLibrarySummary(asked);

	if (!fake.canReadLibrary)
		return json(response, { error: "the media library is not available" }, 503);

	// Rebuilds the set already declared, so it answers as the export's own `202` does
	// and the build finishes on the ticks that follow.
	if (method === "POST" && path === "/api/library/refresh") {
		const columns = state.libraryFeed.columns;
		if (
			columns.length > 0 &&
			state.libraryFeed.building === null &&
			!fake.libraryHalted
		)
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

		const pairs = pairsAsTheComponentReadsThem(url);
		const only = pairs.has("only") ? pairs.getAll("only") : undefined;
		const refusedOnly = only && refuseOnly(asked, only);
		if (refusedOnly) return json(response, refusedOnly, 400);
		const flag = pairs.get("spine");
		if (flag !== null && flag !== "true" && flag !== "false")
			return json(
				response,
				{
					error: "unacceptable spine",
					detail: "'spine' must be true or false",
				},
				400,
			);
		const spine = flag !== "false";

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
			if (fake.libraryHalted)
				return json(response, libraryStateOf(state, fake), 202);
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

		if (only) await subsetReleased(fake, only);

		const part = only
			? `-o${state.libraryFeed.columns.flatMap((column, at) => (only.includes(column) ? [at] : [])).join(".")}`
			: "";
		return sendBlob(
			response,
			headers,
			state,
			fake,
			() => state.libraryExport({ only, spine }),
			`${part}${spine ? "" : "-n"}`,
		);
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
		const structure = url.searchParams.get("structure");
		if (structure === null || !/^\d+$/.test(structure))
			return json(
				response,
				{ error: "unacceptable revision", detail: "'structure' is required" },
				400,
			);

		const changes = state.libraryChanges(Number(since), Number(structure));
		if (changes.status !== 200)
			return json(
				response,
				{ error: CHANGES_REFUSAL[changes.outcome], detail: "" },
				changes.status,
			);

		return sendBlob(
			response,
			headers,
			state,
			fake,
			() => changes.bytes,
			`-f${structure}.${since}`,
		);
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
