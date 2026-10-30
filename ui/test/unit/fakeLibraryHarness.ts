import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { FIELD, TRACK_EXPRESSIONS } from "../../src/domain/track/fields.ts";
import type { components } from "../../src/shared/api/fooJeanSchema.d.ts";
import type { FooJeanOptions } from "../fake-api/fooJean/options.ts";
import { handleFooJean } from "../fake-api/fooJean.ts";
import type { Responder } from "../fake-api/http.ts";
import { handleControl } from "../fake-api/routes.ts";
import { createState, type Track } from "../fake-api/state.ts";
import type { CaseLibrary } from "./caseFiles.ts";

export type FakeState = ReturnType<typeof createState>;

type Section = components["schemas"]["LibrarySection"];
type WireColumn = components["schemas"]["LibraryColumn"];
export type RowsHeader = components["schemas"]["LibraryRowsHeader"];

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPOSITORY = resolve(HERE, "../../..");

export interface Answer {
	status: number;
	headers: Record<string, string>;
	bytes: Uint8Array[];
	answered: boolean;
	dropped: boolean;
}

const responderFor = (answer: Answer): Responder => {
	const take = (headers: Record<string, string> = {}) => {
		for (const [name, value] of Object.entries(headers))
			answer.headers[name.toLowerCase()] = String(value);
	};
	const keep = (chunk: string | Uint8Array) =>
		answer.bytes.push(
			typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk,
		);
	return {
		writeHead(code, headers) {
			answer.status = code;
			take(headers);
		},
		setHeader(name, value) {
			take({ [name]: value });
		},
		write(chunk) {
			keep(chunk);
		},
		end(chunk) {
			if (chunk !== undefined) keep(chunk);
			answer.answered = true;
		},
		on() {},
		destroy() {
			answer.dropped = true;
		},
	};
};

export interface Asking {
	method?: "GET" | "POST";
	query?: [string, string][];
	headers?: Record<string, string>;
	body?: unknown;
	client?: string;
}

export const send = (
	state: FakeState,
	path: string,
	{
		method = "GET",
		query = [],
		headers = {},
		body = null,
		client = "192.168.1.20",
	}: Asking = {},
) => {
	const url = new URL(path, "http://fake");
	for (const [name, value] of query) url.searchParams.append(name, value);
	const answer: Answer = {
		status: 0,
		headers: {},
		bytes: [],
		answered: false,
		dropped: false,
	};
	const sent = body === null ? "" : JSON.stringify(body);
	const done = handleFooJean({
		state,
		method,
		url,
		headers:
			method === "POST"
				? { "content-type": "application/json", ...headers }
				: headers,
		body,
		bodyBytes: new TextEncoder().encode(sent).length,
		client,
		response: responderFor(answer),
		artwork: () => false,
	}).then(() => answer);
	return { answer, done };
};

export const ask = (state: FakeState, path: string, asking: Asking = {}) =>
	send(state, path, asking).done;

export const rawOf = (answer: Answer) => Buffer.concat(answer.bytes);

export const bodyOf = (answer: Answer) =>
	JSON.parse(rawOf(answer).toString("utf8"));

export const tooFast = (answer: Answer) => ({
	status: answer.status,
	body: bodyOf(answer),
	waits: /^[1-9]\d*$/.test(answer.headers["retry-after"] ?? ""),
});

export const refusalOf = (answer: Answer) => ({
	status: answer.status,
	body: bodyOf(answer),
});

export const control = (state: FakeState, action: string, body: object) => {
	const answer: Answer = {
		status: 0,
		headers: {},
		bytes: [],
		answered: false,
		dropped: false,
	};
	handleControl({
		state,
		method: "POST",
		path: `/__control/${action}`,
		body: body as never,
		response: responderFor(answer),
	});
	return answer;
};

export const settled = () => new Promise((resolve) => setImmediate(resolve));

export const NOON = Date.UTC(2026, 9, 16, 12, 0, 0);
export const DAY = 24 * 60 * 60_000;

export const frozenAt = (t: TestContext, now = NOON) =>
	t.mock.timers.enable({ apis: ["Date"], now });

export const MISSING_FIELD = "%no such field%";

export const ROLES: [string, string][] = (
	Object.entries(FIELD) as [string, number][]
).map(([role, at]) => [role, TRACK_EXPRESSIONS[at]]);

export const withRole = (
	role: string,
	expression: string,
): [string, string][] => [
	...ROLES.filter(([name]) => name !== role),
	[role, expression],
];

export const libraryOf = async (state: FakeState) =>
	bodyOf(await ask(state, "/api/state")).library;

export const playerOf = async (state: FakeState) =>
	bodyOf(await ask(state, "/api/state")).player;

export const declared = (
	options: Parameters<typeof createState>[0] = {},
	columns: string[] = [...TRACK_EXPRESSIONS, MISSING_FIELD],
): FakeState => {
	const state = createState(options);
	state.startLibraryBuild(columns);
	state.finishLibraryBuild();
	return state;
};

export const withFake = (fooJean: object) => ({
	fooJean: fooJean as FooJeanOptions,
});

export type CaseTracks = Pick<CaseLibrary, "directory" | "columns">;

export const tracksOfCase = (one: CaseTracks): Track[] =>
	one.directory.map((_, at) => ({
		"%path%": `C:\\Music\\Case\\${String(at).padStart(4, "0")}.flac`,
		...Object.fromEntries(
			ROLES.map(([role, expression]) => [
				expression,
				one.columns[role]?.[at] ?? "?",
			]),
		),
	}));

export const caseState = (one: CaseTracks): FakeState =>
	declared({ mediaLibrary: tracksOfCase(one) }, [...TRACK_EXPRESSIONS]);

const routesLibrary = () =>
	["routes_library.h", "routes_library.cpp"]
		.map((file) =>
			readFileSync(join(REPOSITORY, "plugins/fb2k/src/core", file), "utf8"),
		)
		.join("\n");

const componentConstant = (source: string, name: string): string => {
	const declaredHere = new Map(
		[
			...source.matchAll(/constexpr\s+(?:int|auto)\s+(\w+)\s*=\s*([^;]+);/g),
		].map(([, constant, value]) => [constant, value.trim()]),
	);
	const value = declaredHere.get(name);
	assert.ok(
		value !== undefined,
		`routes_library.h and .cpp declare no ${name}`,
	);
	return /^k\w+$/.test(value) ? componentConstant(source, value) : value;
};

export const componentBucket = (burstName: string, refillName: string) => {
	const source = routesLibrary();
	const burst = Number(componentConstant(source, burstName));
	const refill = /^std::chrono::milliseconds\((\d+)\)$/.exec(
		componentConstant(source, refillName),
	);
	assert.ok(Number.isSafeInteger(burst) && burst > 0);
	assert.ok(refill, `${refillName} is not a count of milliseconds`);
	return { burst, refillMs: Number(refill[1]) };
};

export const failureText = (name: string) => {
	const said = new RegExp(
		`constexpr\\s+char\\s+${name}\\[\\]\\s*=\\s*"([^"]*)";`,
	).exec(
		readFileSync(join(REPOSITORY, "plugins/fb2k/src/core/failures.h"), "utf8"),
	);
	assert.ok(said, `failures.h declares no ${name}`);
	return said[1];
};

const UTF8 = new TextDecoder("utf-8", { ignoreBOM: true });

const numbersIn = (blob: DataView, section: Section) =>
	Array.from({ length: section.count }, (_, at) => {
		const offset = section.offset + at * section.width;
		if (section.width === 1) return blob.getUint8(offset);
		if (section.width === 2) return blob.getUint16(offset, true);
		assert.equal(section.width, 4, `a section of width ${section.width}`);
		return blob.getUint32(offset, true);
	});

export interface WindowColumn {
	cells: string[];
	dictionary: string[];
	facts: { distinct: number; hasUnresolved: boolean; allUnresolved: boolean };
}

const windowColumnOf = (
	blob: DataView,
	bytes: Uint8Array,
	column: WireColumn,
	what: string,
): WindowColumn => {
	assert.ok(column.ids && column.dict, `${what} carries no ids or dict`);
	const ends = numbersIn(blob, column.dict.ends);
	const text = bytes.subarray(
		column.dict.text.offset,
		column.dict.text.offset + column.dict.text.length,
	);
	const dictionary = ends.map((end, at) =>
		UTF8.decode(text.subarray(at === 0 ? 0 : ends[at - 1], end)),
	);
	const ids = numbersIn(blob, column.ids);
	for (const id of ids)
		assert.ok(
			id < dictionary.length,
			`${what} names id ${id} it carries none for`,
		);
	return {
		cells: ids.map((id) => dictionary[id]),
		dictionary,
		facts: {
			distinct: column.distinct,
			hasUnresolved: column.hasUnresolved,
			allUnresolved: column.allUnresolved,
		},
	};
};

export interface RowsBody {
	header: RowsHeader;
	columns: Map<string, WindowColumn>;
	spine: Record<"directory" | "filename" | "subsong", WindowColumn>;
}

// The framing `contract/openapi.yaml` gives under *The rows format*, read here rather than through
// the client's `decodeRows`, so the fake's bytes are held to the contract and not to the client.
export const readRows = (raw: Uint8Array): RowsBody => {
	assert.ok(raw.length >= 8, "a rows body shorter than its framing");
	assert.equal(UTF8.decode(raw.subarray(0, 4)), "JLIB");
	const framing = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
	const headerBytes = framing.getUint32(4, true);
	const blobAt = 8 + headerBytes;
	assert.equal(
		blobAt % 4,
		0,
		"the blob does not start on a four-byte boundary",
	);
	const header = JSON.parse(UTF8.decode(raw.subarray(8, blobAt))) as RowsHeader;
	const bytes = raw.subarray(blobAt);
	const blob = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const columns = new Map(
		header.columns.map((column) => {
			assert.ok(column.name, "a declared column with no name");
			return [
				column.name,
				windowColumnOf(blob, bytes, column, column.name),
			] as const;
		}),
	);
	const bone = (name: "directory" | "filename" | "subsong") =>
		windowColumnOf(blob, bytes, header.spine[name], name);
	return {
		header,
		columns,
		spine: {
			directory: bone("directory"),
			filename: bone("filename"),
			subsong: bone("subsong"),
		},
	};
};

const utf8Bytes = new TextEncoder();

export const bytewise = (left: string, right: string) =>
	Buffer.compare(utf8Bytes.encode(left), utf8Bytes.encode(right));

export const ordinalsOfRuns = (runs: [number, number][]) =>
	runs.flatMap(([start, count]) =>
		Array.from({ length: count }, (_, at) => start + at),
	);
