import type { components } from "../../../src/shared/api/fooJeanSchema.d.ts";
import { json, one, type RequestHeaders, type Responder } from "../http.ts";
import { sameMembers, type Track } from "../state.ts";
import { evaluate } from "../titleFormat.ts";
import { runYielding, type Sweep } from "../yielding.ts";
import { ASK_EVERY_TIME, notFound, STRUCTURE_MOVED } from "./answers.ts";
import { readsAsCount } from "./decimal.ts";
import { abandoned, STALLED_READ_MS } from "./latency.ts";
import { answerQuestionSweep, type Question } from "./libraryQuestions.ts";
import { parseRowsRequest, UNACCEPTABLE_ORDINAL_SET } from "./libraryRows.ts";
import {
	albumCoversSweep,
	RUN_ROLES,
	runColumnsKey,
	runsSweep,
} from "./libraryRuns.ts";
import {
	fixedOffset,
	LIBRARY_ROLE_NAMES,
	type LocalTime,
	SUMMARY_ROLES,
	type SummaryRole,
	summariseSweep,
} from "./librarySummary.ts";
import { VALUE_FIELDS, type ValueField } from "./libraryValues.ts";
import type { FooJeanFake } from "./options.ts";
import { type Bucket, refuseTooFast, spend } from "./rateLimits.ts";
import type { Asked, FakeState } from "./request.ts";

// RFC 9110's negotiation, as the component reads it: `gzip;q=0` is a refusal, and `*` offers
// nothing rather than everything.
export const offersGzip = (headers: RequestHeaders) => {
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

export const gzipped = (bytes: Uint8Array<ArrayBuffer>) => {
	let held = packed.get(bytes);
	if (!held) {
		held = compress(bytes);
		packed.set(bytes, held);
	}
	return held;
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
		state.libraryEntriesAt(address).find((entry) => entry.subsong === subsong)
			?.track ?? null
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
		changeCounts: state.libraryChangeCounts(),
		build: fake.libraryHalted ? null : libraryBuildOf(state, fake),
		halted: fake.libraryHalted,
	};
};

const MAX_COLUMNS = 64;

// cpp-httplib drops a query pair whose raw text repeats an earlier one before the component reads
// any, so a pair sent twice byte for byte reaches it once.
const pairsAsTheComponentReadsThem = (url: URL) =>
	new URLSearchParams([...new Set(url.search.slice(1).split("&"))].join("&"));

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

// `kNoLibrary` in `plugins/fb2k/src/core/failures.h`, verbatim. `errorDocument` there writes only
// `error`, with no `detail` field.
export const LIBRARY_UNAVAILABLE = {
	error: "the media library is not available",
};

const SUMMARY_FAILURE: Record<500 | 503, { error: string }> = {
	500: { error: "the library summary failed" },
	503: LIBRARY_UNAVAILABLE,
};

const tagOf = (state: FakeState, coding: string, variant = "") =>
	`"s${state.libraryFeed.structure}-r${state.libraryFeed.revision}-e${state.libraryFeed.edits}${variant}-${coding}"`;

export const sendJson = async (
	response: Responder,
	headers: RequestHeaders,
	document: unknown,
	more: Record<string, string> = {},
) => {
	const bytes = new TextEncoder().encode(
		JSON.stringify(document),
	) as Uint8Array<ArrayBuffer>;
	const gzip = offersGzip(headers);
	response.writeHead(200, {
		"Content-Type": "application/json; charset=utf-8",
		"Cache-Control": ASK_EVERY_TIME,
		Vary: "Accept-Encoding",
		...more,
		...(gzip ? { "Content-Encoding": "gzip" } : null),
	});
	response.end(gzip ? await gzipped(bytes) : bytes);
	return true;
};

export const holdsTag = (headers: RequestHeaders, tag: string) =>
	one(headers["if-none-match"])
		.split(",")
		.some((candidate) => candidate.trim() === "*" || candidate.trim() === tag);

// `produce` runs after the `If-None-Match` check, the order `sendBodyIfChanged` in
// `plugins/fb2k/src/core/http_responses.cpp` keeps.
const sendBlob = async (
	response: Responder,
	headers: RequestHeaders,
	state: FakeState,
	produce: () => Uint8Array<ArrayBuffer>,
	variant?: string,
	{ contentType = "application/octet-stream" } = {},
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

const refusedParameter = (error: string, detail: string) => ({ error, detail });

// cpp-httplib's `Params` keeps the pairs in the order they were sent.
const pairsInSentOrder = (url: URL) => [...pairsAsTheComponentReadsThem(url)];

export const rolesAsked = <Role extends string>(
	url: URL,
	accepted: readonly Role[],
	owned: readonly string[] = [],
) => {
	const asked = new Map<Role, string>();
	for (const [name, expression] of pairsInSentOrder(url)) {
		if (owned.includes(name)) continue;
		if (!accepted.includes(name as Role))
			return refusedParameter("unacceptable role", `'${name}' is not a role`);
		if (
			expression === "" ||
			new TextEncoder().encode(expression).length > MAX_EXPRESSION_BYTES ||
			UNPRINTABLE.test(expression)
		)
			return refusedParameter(
				"unacceptable role",
				`role '${name}' must be printable text of 1 to ${MAX_EXPRESSION_BYTES} characters`,
			);
		if (asked.has(name as Role))
			return refusedParameter(
				"duplicate role",
				`role '${name}' is named twice`,
			);
		asked.set(name as Role, expression);
	}
	return asked;
};

const genresAsked = (url: URL) => {
	const sent = pairsInSentOrder(url).filter(([name]) => name === "genres");
	if (sent.length > 1)
		return refusedParameter("duplicate question", "'genres' is named twice");
	const value = sent[0]?.[1];
	if (value === undefined || value === "false") return false;
	return value === "true"
		? true
		: refusedParameter(
				"unacceptable question",
				"'genres' must be true or false",
			);
};

export const hashOf = (text: string) => {
	let hash = 0x811c9dc5;
	for (let at = 0; at < text.length; at += 1)
		hash = Math.imul(hash ^ text.charCodeAt(at), 0x01000193) >>> 0;
	return hash.toString(16);
};

interface BuiltSummary {
	variant: string;
	bytes: Uint8Array<ArrayBuffer>;
}

const summariesBuilt = new WeakMap<
	FakeState,
	Map<string, Promise<BuiltSummary>>
>();

const releasedFromHold = async (
	fake: FooJeanFake,
	hold: "holdSummary" | "holdQuestions" | "holdRows",
	waiting: "summariesHeld" | "questionsHeld" | "rowsHeld",
) => {
	while (fake[hold])
		await new Promise<void>((release) => fake[waiting].push(release));
};

const failedByOption = (
	response: Responder,
	option: {
		status: 429 | 500 | 503 | "drop";
		times: number;
	} | null,
	bucket: Bucket,
	failures: Record<500 | 503, { error: string }>,
) => {
	if (!option || option.times <= 0) return false;
	const { status } = option;
	option.times -= 1;
	if (status === "drop") response.destroy();
	else if (status === 429) refuseTooFast(response, bucket);
	else json(response, failures[status], status);
	return true;
};

const structureMoved = (
	response: Responder,
	asked: string,
	state: FakeState,
) => {
	if (BigInt(asked) === BigInt(state.libraryFeed.structure)) return false;
	json(response, STRUCTURE_MOVED, 409);
	return true;
};

export function* libraryReadSweep(
	state: FakeState,
	roles: Map<string, string>,
) {
	const { structure, revision } = state.libraryFeed;
	const { directory, filename, subsong, paths } = yield* state.partsSweep();
	const columns = yield* state.columnsReadSweep(roles);
	return { structure, revision, directory, filename, subsong, paths, columns };
}

function* buildSummary(
	state: FakeState,
	roles: Map<SummaryRole, string>,
	now: number,
	local: LocalTime,
	withGenres: boolean,
): Sweep<Uint8Array<ArrayBuffer>> {
	const document = yield* summariseSweep(
		yield* libraryReadSweep(state, roles),
		now,
		local,
		withGenres,
	);
	return new TextEncoder().encode(
		JSON.stringify(document),
	) as Uint8Array<ArrayBuffer>;
}

const summaryOf = (
	state: FakeState,
	roles: Map<SummaryRole, string>,
	now: number,
	withGenres: boolean,
): Promise<BuiltSummary> => {
	const local = fixedOffset(-new Date(now).getTimezoneOffset());
	const roleSet = [...roles].map(([role, from]) => `${role}=${from}`).sort();
	const date = local.yyyymmddOf(now);
	const variant = `-d${date}${withGenres ? "g" : ""}-${hashOf(roleSet.join("\u0000"))}`;
	const { structure, revision, edits } = state.libraryFeed;
	const key = [structure, revision, edits, variant].join("\u0000");

	const built =
		summariesBuilt.get(state) ?? new Map<string, Promise<BuiltSummary>>();
	summariesBuilt.set(state, built);
	const kept = built.get(key);
	if (kept) return kept;

	const made = runYielding(
		buildSummary(state, roles, now, local, withGenres),
		state.isDiscarded,
	).then((bytes) => ({ variant, bytes }));
	built.set(key, made);
	return made;
};

export const answeredUnlessReady = (
	state: FakeState,
	fake: FooJeanFake,
	response: Responder,
	expressions: string[],
) => {
	const { columns, building } = state.libraryFeed;
	const stillBuilding = (from: string) =>
		!columns.includes(from) && building?.includes(from);
	if (!hasLibrarySnapshot(state) || expressions.some(stillBuilding)) {
		json(response, libraryStateOf(state, fake), 202);
		return true;
	}

	const undeclared = expressions.find(
		(from) => !columns.includes(from) && !building?.includes(from),
	);
	if (undeclared === undefined) return false;
	json(response, { error: `'${undeclared}' is not a declared column` }, 409);
	return true;
};

async function handleLibrarySummary({
	state,
	fake,
	url,
	headers,
	response,
	recorded,
}: Asked) {
	const roles = rolesAsked(url, SUMMARY_ROLES, ["genres"]);
	if (!(roles instanceof Map)) return json(response, roles, 400);
	const genres = genresAsked(url);
	if (typeof genres !== "boolean") return json(response, genres, 400);

	if (!fake.canReadLibrary) return json(response, LIBRARY_UNAVAILABLE, 503);

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

	if (answeredUnlessReady(state, fake, response, [...roles.values()]))
		return true;

	await releasedFromHold(fake, "holdSummary", "summariesHeld");

	const { variant, bytes } = await summaryOf(state, roles, Date.now(), genres);
	return sendBlob(response, headers, state, () => bytes, variant, {
		contentType: "application/json; charset=utf-8",
	});
}

const QUESTION_FAILURE: Record<500 | 503, { error: string }> = {
	500: { error: "the library question failed" },
	503: LIBRARY_UNAVAILABLE,
};

// A credits question addressed by library path: it becomes an ordinal once the snapshot is known to be built.
interface CreditsAtPath {
	kind: "creditsAtPath";
	track: string;
	subsong: number;
	splitsCredits: boolean;
}

export interface QuestionRoute {
	required: readonly string[];
	optional: readonly string[];
	flags: readonly string[];
	counts?: readonly string[];
	// Judged once the required names are present, before any value is read.
	refuses?: (given: Map<string, string>) => string | null;
	asks: (given: Map<string, string>) => Question | CreditsAtPath;
}

const MAX_TRACK_ADDRESS_CHARACTERS = 4096;

// Exactly one address form: `ordinal` with `structure`, or `track` with an optional `subsong`.
const addressFormRefusal = (given: Map<string, string>) => {
	const ordinalForm = given.has("ordinal") || given.has("structure");
	const pathForm = given.has("track") || given.has("subsong");
	if (ordinalForm && pathForm)
		return "name 'ordinal' with 'structure', or 'track', and not both";
	if (!ordinalForm && !pathForm)
		return "'ordinal' with 'structure', or 'track', is required";
	if (ordinalForm && !given.has("structure")) return "'structure' is required";
	if (ordinalForm && !given.has("ordinal")) return "'ordinal' is required";
	if (pathForm && !given.has("track")) return "'track' is required";
	return null;
};

const MAX_QUERY_BYTES = 1024;

const QUESTION_ROUTES: Record<string, QuestionRoute> = {
	"/api/library/search": {
		required: ["query", "limit", "entityLimit", "splitsCredits"],
		optional: [],
		flags: ["splitsCredits"],
		counts: ["entityLimit", "limit"],
		asks: (given) => ({
			kind: "search",
			query: given.get("query") ?? "",
			limit: Number(given.get("limit")),
			entityLimit: Number(given.get("entityLimit")),
			splitsCredits: given.get("splitsCredits") === "true",
		}),
	},
	"/api/library/album": {
		required: ["name"],
		optional: ["by"],
		flags: [],
		asks: (given) => ({
			kind: "album",
			name: given.get("name") ?? "",
			by: given.get("by"),
		}),
	},
	"/api/library/artist": {
		required: ["name", "splitsCredits"],
		optional: [],
		flags: ["splitsCredits"],
		asks: (given) => ({
			kind: "artist",
			name: given.get("name") ?? "",
			splitsCredits: given.get("splitsCredits") === "true",
		}),
	},
	"/api/library/genre": {
		required: ["name"],
		optional: [],
		flags: [],
		asks: (given) => ({ kind: "genre", name: given.get("name") ?? "" }),
	},
	"/api/library/credits": {
		required: ["splitsCredits"],
		optional: ["structure", "ordinal", "track", "subsong"],
		flags: ["splitsCredits"],
		counts: ["ordinal", "subsong"],
		refuses: addressFormRefusal,
		asks: (given) =>
			given.has("track")
				? {
						kind: "creditsAtPath",
						track: given.get("track") ?? "",
						subsong: Number(given.get("subsong") ?? 0),
						splitsCredits: given.get("splitsCredits") === "true",
					}
				: {
						kind: "credits",
						ordinal: Number(given.get("ordinal")),
						splitsCredits: given.get("splitsCredits") === "true",
					},
	},
	"/api/library/values": {
		required: ["field", "prefix", "limit"],
		optional: [],
		flags: [],
		counts: ["limit"],
		asks: (given) => ({
			kind: "values",
			field: given.get("field") as ValueField,
			prefix: given.get("prefix") ?? "",
			limit: Number(given.get("limit")),
		}),
	},
};

const rawBytesOf = (url: URL, parameter: string) => {
	for (const pair of url.search.slice(1).split("&")) {
		const [name, ...rest] = pair.split("=");
		if (new URLSearchParams(name).keys().next().value !== parameter) continue;
		return new TextEncoder().encode(
			rest.join("=").replace(/%[0-9a-f]{2}/gi, "\0"),
		).length;
	}
	return 0;
};

export const questionAsked = (
	url: URL,
	route: Pick<
		QuestionRoute,
		"required" | "optional" | "flags" | "counts" | "refuses"
	>,
) => {
	const owned = [...route.required, ...route.optional];
	const sent = pairsInSentOrder(url);
	const given = new Map<string, string>();
	for (const [name, value] of sent)
		if (owned.includes(name) && !given.has(name)) given.set(name, value);

	for (const name of route.required)
		if (!given.has(name))
			return refusedParameter("unacceptable question", `'${name}' is required`);

	const unaddressed = route.refuses?.(given);
	if (unaddressed)
		return refusedParameter("unacceptable question", unaddressed);

	for (const name of owned) {
		const value = given.get(name);
		if (value === undefined) continue;
		if (route.flags.includes(name) && value !== "true" && value !== "false")
			return refusedParameter(
				"unacceptable question",
				`'${name}' must be true or false`,
			);
		if (route.counts?.includes(name) && !readsAsCount(value))
			return refusedParameter(
				"unacceptable question",
				`'${name}' must be a whole number of 0 or more`,
			);
		if (
			(name === "query" || name === "prefix") &&
			rawBytesOf(url, name) > MAX_QUERY_BYTES
		)
			return refusedParameter(
				"unacceptable question",
				`'${name}' must be at most ${MAX_QUERY_BYTES} bytes`,
			);
		if (
			name === "track" &&
			(value === "" || [...value].length > MAX_TRACK_ADDRESS_CHARACTERS)
		)
			return refusedParameter(
				"unacceptable question",
				`'track' must be printable text of at most ${MAX_TRACK_ADDRESS_CHARACTERS} characters`,
			);
		if (name === "structure" && !readsAsCount(value))
			return refusedParameter(
				"unacceptable question",
				"'structure' must be a string of decimal digits",
			);
		if (
			name === "field" &&
			!(VALUE_FIELDS as readonly string[]).includes(value)
		)
			return refusedParameter(
				"unacceptable question",
				`'field' must be ${VALUE_FIELDS.slice(0, -1).join(", ")} or ${VALUE_FIELDS.at(-1)}`,
			);
	}

	for (const [name] of sent)
		if (owned.includes(name) && sent.filter(([one]) => one === name).length > 1)
			return refusedParameter("duplicate question", `'${name}' is named twice`);
	return given;
};

const questionsMaking = new WeakMap<FakeState, Map<string, Promise<object>>>();

async function handleLibraryQuestion(
	{ state, fake, url, headers, response, recorded }: Asked,
	route: QuestionRoute,
) {
	const owned = [...route.required, ...route.optional];
	const roles = rolesAsked(url, LIBRARY_ROLE_NAMES, owned);
	if (!(roles instanceof Map)) return json(response, roles, 400);
	const given = questionAsked(url, route);
	if (!(given instanceof Map)) return json(response, given, 400);

	if (!fake.canReadLibrary) return json(response, LIBRARY_UNAVAILABLE, 503);

	if (
		failedByOption(
			response,
			fake.failQuestions,
			"libraryQuestions",
			QUESTION_FAILURE,
		)
	)
		return true;

	if (
		fake.rateLimits &&
		!spend(fake.limiter, fake.rateLimits, "libraryQuestions", "")
	) {
		recorded.limited = "libraryQuestions";
		return refuseTooFast(response, "libraryQuestions");
	}

	if (answeredUnlessReady(state, fake, response, [...roles.values()]))
		return true;

	await releasedFromHold(fake, "holdQuestions", "questionsHeld");

	const asked = route.asks(given);
	let question: Question;
	if (asked.kind === "creditsAtPath") {
		// Resolved as `GET /track/library` resolves a library address.
		if (namesTwoTracks(state, asked.track))
			return json(response, { error: NAMES_TWO_TRACKS, detail: "" }, 409);
		const ordinal = state.libraryOrdinalFor(
			libraryTrackAt(state, asked.track, asked.subsong),
		);
		if (ordinal === null)
			return json(response, { error: "no such track" }, 404);
		question = {
			kind: "credits",
			ordinal,
			splitsCredits: asked.splitsCredits,
		};
	} else question = asked;
	if (asked.kind === "credits") {
		if (structureMoved(response, given.get("structure") ?? "", state))
			return true;
		if (asked.ordinal >= state.ordinalOrder().length)
			return json(
				response,
				refusedParameter(
					"unacceptable question",
					"'ordinal' is past the last track",
				),
				400,
			);
	}

	if (question.kind === "search")
		state.afterLargeBuild(() => {
			// A rebuilt library has its search tables read again before anyone types, as a component
			// holds them with the snapshot.
			void runYielding(
				(function* () {
					return yield* answerQuestionSweep(
						yield* libraryReadSweep(state, roles),
						question,
						fixedOffset(-new Date().getTimezoneOffset()),
					);
				})(),
				state.isDiscarded,
			);
		});

	// A client asking the same again while the answer is made waits for that one.
	const { structure, revision, edits } = state.libraryFeed;
	const key = [url.pathname, url.search, structure, revision, edits].join(
		"\u0000",
	);
	const making =
		questionsMaking.get(state) ?? new Map<string, Promise<object>>();
	questionsMaking.set(state, making);
	let made = making.get(key);
	if (!made) {
		const now = Date.now();
		made = runYielding(
			(function* () {
				const read = yield* libraryReadSweep(state, roles);
				return yield* answerQuestionSweep(
					read,
					question,
					fixedOffset(-new Date(now).getTimezoneOffset()),
				);
			})(),
			state.isDiscarded,
		).finally(() => making.delete(key));
		making.set(key, made);
	}
	return sendJson(response, headers, await made);
}

const beginDeclaring = (
	{ state, fake, response, recorded }: Asked,
	columns: string[],
) => {
	if (fake.libraryHalted) {
		json(response, libraryStateOf(state, fake), 202);
		return true;
	}
	const { building } = state.libraryFeed;
	if (building !== null && sameMembers(building, columns)) return false;

	if (
		fake.rateLimits &&
		!spend(fake.limiter, fake.rateLimits, "libraryRebuilds", "")
	) {
		recorded.limited = "libraryRebuilds";
		refuseTooFast(response, "libraryRebuilds");
		return true;
	}
	state.startLibraryBuild(columns);
	return false;
};

const ROWS_FAILURE: Record<500 | 503, { error: string }> = {
	500: { error: "the library rows failed" },
	503: LIBRARY_UNAVAILABLE,
};

async function handleLibraryRows(asked: Asked) {
	const { state, fake, body, headers, response, recorded, client } = asked;
	const parsed = parseRowsRequest(body);
	if ("refused" in parsed) return json(response, parsed.refused, 400);

	if (!fake.canReadLibrary) return json(response, LIBRARY_UNAVAILABLE, 503);

	if (failedByOption(response, fake.failRows, "libraryRows", ROWS_FAILURE))
		return true;

	if (
		fake.rateLimits &&
		!spend(fake.limiter, fake.rateLimits, "libraryRows", client)
	) {
		recorded.limited = "libraryRows";
		return refuseTooFast(response, "libraryRows");
	}

	if (!sameMembers(state.libraryFeed.columns, parsed.columns)) {
		if (beginDeclaring(asked, parsed.columns)) return true;
		return json(response, libraryStateOf(state, fake), 202);
	}

	await state.settledLibrary();
	await releasedFromHold(fake, "holdRows", "rowsHeld");

	if (structureMoved(response, parsed.structure, state)) return true;
	const trackCount = state.ordinalOrder().length;
	if (parsed.ordinals.some((ordinal) => ordinal >= trackCount))
		return json(response, UNACCEPTABLE_ORDINAL_SET, 400);

	const bytes = state.libraryRows(parsed.ordinals);
	const gzip = offersGzip(headers);
	response.writeHead(200, {
		"Content-Type": "application/octet-stream",
		"Cache-Control": ASK_EVERY_TIME,
		Vary: "Accept-Encoding",
		...(gzip ? { "Content-Encoding": "gzip" } : null),
	});
	response.end(gzip ? await gzipped(bytes) : bytes);
	return true;
}

interface HeldRuns {
	key: string;
	lengths: number[];
	covers: number[];
	untagged: number[];
	tag: string;
}

const runsHeld = new WeakMap<FakeState, HeldRuns>();

const hashOfNumbers = (...lists: number[][]) => {
	let hash = 0x811c9dc5;
	for (const list of lists) {
		hash = Math.imul(hash ^ list.length, 0x01000193) >>> 0;
		for (const number of list)
			hash = Math.imul(hash ^ number, 0x01000193) >>> 0;
	}
	return hash.toString(16);
};

interface GroupedLibrary {
	key: string;
	read: ReturnType<typeof libraryReadSweep> extends Sweep<infer R> ? R : never;
	covers: number[];
	draftAt: number[];
}

const groupedHeld = new WeakMap<
	FakeState,
	{ key: string; made: Promise<GroupedLibrary> }
>();

function* groupedSweep(state: FakeState, roles: Map<string, string>) {
	const read = yield* libraryReadSweep(
		state,
		new Map(
			RUN_ROLES.flatMap((role) => {
				const expression = roles.get(role);
				return expression === undefined ? [] : [[role, expression] as const];
			}),
		),
	);
	const { covers, draftAt } = yield* albumCoversSweep(
		read.columns,
		read.directory.length,
	);
	return { key: runColumnsKey(state, roles), read, covers, draftAt };
}

export const groupedLibrary = (
	state: FakeState,
	roles: Map<string, string>,
) => {
	const key = runColumnsKey(state, roles);
	const kept = groupedHeld.get(state);
	if (kept?.key === key) return kept.made;
	const made = runYielding(groupedSweep(state, roles), state.isDiscarded);
	groupedHeld.set(state, { key, made });
	return made;
};

function* runsForSweep(
	state: FakeState,
	roles: Map<string, string>,
	{ read, covers: albumCovers, draftAt }: GroupedLibrary,
) {
	const key = runColumnsKey(state, roles);
	const { lengths, covers, untagged } = yield* runsSweep(
		{ count: read.directory.length, columns: read.columns },
		{ covers: albumCovers, draftAt },
	);
	const made = {
		key,
		lengths,
		covers,
		untagged,
		tag: `r${hashOfNumbers(lengths, covers, untagged)}-${lengths.length}`,
	};
	runsHeld.set(state, made);
	return made;
}

const runsMaking = new WeakMap<
	FakeState,
	{ key: string; made: ReturnType<typeof runsAsync> }
>();

const runsAsync = async (state: FakeState, roles: Map<string, string>) => {
	const kept = runsHeld.get(state);
	if (kept?.key === runColumnsKey(state, roles)) return kept;
	const grouped = await groupedLibrary(state, roles);
	return runYielding(runsForSweep(state, roles, grouped), state.isDiscarded);
};

const runsMade = (state: FakeState, roles: Map<string, string>) => {
	const key = runColumnsKey(state, roles);
	const making = runsMaking.get(state);
	if (making?.key === key) return making.made;
	const made = runsAsync(state, roles);
	runsMaking.set(state, { key, made });
	return made;
};

async function handleLibraryRuns({
	state,
	fake,
	url,
	headers,
	response,
	recorded,
}: Asked) {
	const roles = rolesAsked(url, LIBRARY_ROLE_NAMES);
	if (!(roles instanceof Map)) return json(response, roles, 400);

	if (!fake.canReadLibrary) return json(response, LIBRARY_UNAVAILABLE, 503);

	if (
		fake.rateLimits &&
		!spend(fake.limiter, fake.rateLimits, "libraryRuns", "")
	) {
		recorded.limited = "libraryRuns";
		return refuseTooFast(response, "libraryRuns");
	}

	if (answeredUnlessReady(state, fake, response, [...roles.values()]))
		return true;

	const gzip = offersGzip(headers);
	const held = await runsMade(state, roles);
	const tag = `"${held.tag}-${gzip ? "gzip" : "identity"}"`;
	const revalidating = {
		"Cache-Control": ASK_EVERY_TIME,
		Vary: "Accept-Encoding",
		ETag: tag,
	};
	if (holdsTag(headers, tag)) {
		response.writeHead(304, revalidating);
		response.end();
		return true;
	}

	const { structure, revision } = state.libraryFeed;
	return sendJson(
		response,
		headers,
		{
			structure,
			revision,
			lengths: held.lengths,
			covers: held.covers,
			untagged: held.untagged,
		},
		{ ETag: tag },
	);
}

export async function handleLibrary(request: Asked) {
	const { state, fake, method, path, url, response } = request;
	if (method === "POST" && path === "/api/library/rows")
		return handleLibraryRows(request);
	if (method === "GET" && path === "/api/library/runs")
		return handleLibraryRuns(request);
	if (method === "GET" && path === "/api/library/summary")
		return handleLibrarySummary(request);
	if (method === "GET" && Object.hasOwn(QUESTION_ROUTES, path))
		return handleLibraryQuestion(request, QUESTION_ROUTES[path]);

	if (!fake.canReadLibrary)
		return json(response, { error: "the media library is not available" }, 503);

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
