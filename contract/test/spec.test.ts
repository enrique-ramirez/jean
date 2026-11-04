import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { parse } from "yaml";

import { type Context, drives } from "../probes.ts";
import { conforms } from "../shape.ts";
import { publishedOperations, type Schema } from "../spec.ts";

const operations = publishedOperations();

const settled: Context = {
	run: "0f1e2d3c",
	deviceId: "3f8a1c0e-2b7d-4a91-9c33-51e0a2f6d4b8",
	playlistId: "45837d74-fa4f-415c-bba9-bf2db8f0dc04",
	playlistPage: { structure: "12", revision: "30" },
	managed: { key: "", query: "%genre% IS Rock", sort: "", forceSort: false },
	ticket: "a-ticket",
	revision: 903,
};

const drive = (id: string) => {
	const found = drives.find((one) => one.id === id);
	assert.ok(found, `no drive for ${id}`);
	return found;
};

const operation = (id: string) => {
	const found = operations.find((one) => one.id === id);
	assert.ok(found, `the contract no longer publishes ${id}`);
	return found;
};

test("the suite drives every operation the contract publishes", () => {
	const published = operations.map((one) => one.id).sort();
	const driven = drives.map((one) => one.id).sort();

	assert.deepEqual(driven, published);
});

test("every operation publishes at least one response", () => {
	for (const one of operations)
		assert.ok(one.published.size > 0, `${one.id} publishes no responses`);
});

// A probe reaches into the spec for its request body by the name the spec gives the example,
// so renaming one there fails here rather than sending a malformed request at run time.
test("every probe can build a request", () => {
	for (const one of drives)
		assert.doesNotThrow(() => one.probe(operation(one.id), settled));
});

test("a probe with no answer to build on asks for nothing", () => {
	const fresh: Context = {
		...settled,
		playlistId: null,
		playlistPage: null,
		ticket: null,
		revision: null,
	};

	for (const id of [
		"getPlaylistItems",
		"getPlaylistItemChanges",
		"updateAutoPlaylist",
		"removeAutoPlaylist",
		"openStream",
	])
		assert.equal(drive(id).probe(operation(id), fresh), null);
});

const fills = ["fillOwnPlaylist", "fillPlaylist"];

const bodyKeys = (id: string) => {
	const keys = new Set(
		Object.values(operation(id).examples).flatMap((body) =>
			Object.keys(body as Record<string, unknown>),
		),
	);

	assert.ok(keys.size > 0, `${id} publishes no request example to read`);
	return keys;
};

const declaredKeys = (id: string) => {
	const declared = operation(id).body?.properties;
	assert.ok(declared, `${id} publishes no request schema to read`);
	return new Set(Object.keys(declared));
};

const parameter = (id: string, name: string) => {
	const found = operation(id).parameters.find((one) => one.name === name);
	assert.ok(found, `${id} no longer takes a ${name}`);
	return found;
};

test("the contract carries a fill per owner, and each is refused with a 403 of its own", () => {
	const own = operation("fillOwnPlaylist");
	const users = operation("fillPlaylist");

	assert.equal(`${own.method} ${own.path}`, "POST /playlists/own/{role}/items");
	assert.equal(`${users.method} ${users.path}`, "POST /playlists/{id}/items");

	assert.ok(
		own.published.has(403),
		"controlPlayback no longer refuses a fill of the component's own playlist",
	);
	assert.ok(
		users.published.has(403),
		"the read-only-playlists setting no longer refuses a fill of a user's playlist",
	);
});

test("playing a row is not one of the writes the read-only-playlists setting refuses", () => {
	const play = operation("playPlaylistRow");

	assert.equal(
		`${play.method} ${play.path}`,
		"POST /playlists/{id}/items/{index}/play",
	);
	assert.ok(
		play.published.has(403),
		"controlPlayback no longer refuses a playback command",
	);
});

// Read uninlined, because the two 504s carry one body and only the reference tells them apart.
const document = parse(
	readFileSync(new URL("../openapi.yaml", import.meta.url), "utf8"),
);

const RESPONSES = "#/components/responses/";

const responseNamed = (id: string, status: number) => {
	for (const entry of Object.values(document.paths))
		for (const one of Object.values(entry as Record<string, unknown>)) {
			const found = one as {
				operationId?: string;
				responses?: Record<string, { $ref?: string }>;
			};
			if (found.operationId !== id) continue;

			const ref = found.responses?.[status]?.$ref;
			if (!ref?.startsWith(RESPONSES))
				assert.fail(`${id} publishes no shared ${status}`);
			return ref.slice(RESPONSES.length);
		}

	assert.fail(`the contract no longer publishes ${id}`);
};

const playerCommands = [
	"playPause",
	"pause",
	"resume",
	"nextTrack",
	"previousTrack",
	"stop",
	"seek",
	"setPlaybackMode",
	"setVolume",
];

test("each player command says when the player refused it and when it ran out of time", () => {
	for (const id of playerCommands) {
		assert.equal(
			responseNamed(id, 500),
			"PlayerRefused",
			`${id} does not say the player refused it`,
		);

		const tooSlow = responseNamed(id, 504);
		assert.notEqual(
			tooSlow,
			"PlayerTooSlow",
			`${id} tells a client to re-read the playlists for a command that moves playback`,
		);

		const published = document.components.responses[tooSlow];
		assert.equal(
			published.content["application/json"].schema.$ref,
			"#/components/schemas/PlaylistFailed",
			`${id}'s 504 is not the PlaylistFailed body the play-row route answers`,
		);
		assert.match(
			published.description,
			/GET \/state/,
			`${id}'s 504 does not say GET /state is where a late command shows`,
		);
	}
});

test("a seek publishes that an absolute position is never negative, and an offset may be", () => {
	const fields = operation("seek").body?.properties;
	assert.ok(fields, "a seek publishes no request schema to read");

	const seconds = fields.seconds as {
		minimum?: number;
		exclusiveMinimum?: number;
	};
	assert.equal(seconds.minimum, 0, "a negative seconds is published as a seek");
	assert.equal(
		seconds.exclusiveMinimum,
		undefined,
		"a seek to the start is published as refused",
	);

	const relative = fields.relativeSeconds as { minimum?: number };
	assert.equal(
		relative.minimum,
		undefined,
		"a seek backward is published as refused",
	);
});

// A create reading a set the fill route would refuse, or refusing one it would take, is a
// second grammar for a client to learn. The contract holds the two together by declaring the
// same fields, so a client that can fill a playlist can fill one it is creating. `duplicates`
// is the one field apart: it asks about rows the target already holds, and a playlist being
// created holds none.
test("a create takes the fill's own set, and the setting refuses it", () => {
	const create = operation("createPlaylist");

	assert.equal(`${create.method} ${create.path}`, "POST /playlists");

	const naming = [...declaredKeys("fillPlaylist")].filter(
		(field) => field !== "duplicates",
	);
	for (const field of naming)
		assert.ok(
			declaredKeys("createPlaylist").has(field),
			`a create cannot be sent the ${field} a fill takes`,
		);

	assert.ok(
		create.published.has(403),
		"the read-only-playlists setting no longer refuses a create",
	);
});

test("each of the three playlist edits is addressed by GUID and refused by the setting", () => {
	const edits: Record<string, string> = {
		renamePlaylist: "POST /playlists/{id}",
		removePlaylist: "DELETE /playlists/{id}",
		movePlaylist: "POST /playlists/{id}/move",
	};

	for (const [id, route] of Object.entries(edits)) {
		const edit = operation(id);

		assert.equal(`${edit.method} ${edit.path}`, route);
		assert.ok(
			edit.published.has(403),
			`the read-only-playlists setting no longer refuses ${id}`,
		);
		assert.ok(
			edit.published.has(404),
			`${id} no longer says a playlist is gone, so a client cannot tell that from a refusal`,
		);
	}
});

test("the two row edits are addressed by GUID, and only the removal names a generation", () => {
	const copy = operation("copyPlaylistItems");
	const remove = operation("removePlaylistItems");

	assert.equal(
		`${copy.method} ${copy.path}`,
		"POST /playlists/{id}/items/copy",
	);
	assert.equal(
		`${remove.method} ${remove.path}`,
		"POST /playlists/{id}/items/remove",
	);

	for (const edit of [copy, remove]) {
		assert.ok(
			edit.published.has(403),
			`the read-only-playlists setting no longer refuses ${edit.id}`,
		);
		assert.ok(
			edit.published.has(404),
			`${edit.id} no longer says a playlist is gone, so a client cannot tell that from a refusal`,
		);
	}

	assert.ok(
		!declaredKeys("copyPlaylistItems").has("structure"),
		"a copy now takes a generation it cannot protect anything with",
	);
	assert.ok(
		declaredKeys("removePlaylistItems").has("structure"),
		"a removal takes no generation, so a stale position can take the wrong row out",
	);
	assert.ok(
		remove.published.has(409),
		"a removal against a generation the playlist has moved past is no longer refused",
	);

	assert.ok(
		!declaredKeys("copyPlaylistItems").has("title"),
		"a copy takes a title it has no playlist to give one to",
	);
});

test("a copy answers where its rows landed and what generation they landed at", () => {
	const copied = operation("copyPlaylistItems").published.get(200);
	assert.ok(copied, "a copy no longer answers a document");

	assert.deepEqual(copied.required?.sort(), [
		"positions",
		"skipped",
		"structure",
	]);

	const removed = operation("removePlaylistItems").published.get(200);
	assert.ok(removed, "a removal no longer answers a document");

	assert.deepEqual(removed.required, ["structure"]);
});

test("the conformance run cannot edit the rows of a playlist the player holds", () => {
	const held: Context = { ...settled, playlistId: "a-real-playlist" };

	for (const id of ["copyPlaylistItems", "removePlaylistItems"]) {
		const attempt = drive(id).probe(operation(id), held);

		assert.ok(attempt, `${id} is no longer driven at all`);
		assert.notEqual(
			attempt.pathParams?.id,
			held.playlistId,
			`the ${id} probe now names a playlist the run found on the player`,
		);
	}
});

// A run that deleted a playlist somebody owns has destroyed it: there is no undo, and nothing
// in contract/README.md's account of what one run costs would be true any more. The delete is
// driven at an id no implementation issues, and this is what keeps it that way.
test("the conformance run cannot delete a playlist the player holds", () => {
	const held: Context = { ...settled, playlistId: "a-real-playlist" };
	const attempt = drive("removePlaylist").probe(
		operation("removePlaylist"),
		held,
	);

	assert.ok(attempt, "the delete is no longer driven at all");
	assert.notEqual(
		attempt.pathParams?.id,
		held.playlistId,
		"the delete probe now names a playlist the run found on the player",
	);
});

// The queue was the second role, and the playlist behind it is gone: the play queue is the
// component's own, addressed through /api/queue by handle and by position. A contract still
// publishing the role is a client still filling a playlist nothing will ever queue from.
test("the role a fill addresses is closed to the scratch alone", () => {
	const role = parameter("fillOwnPlaylist", "role");

	assert.equal(role.in, "path");
	assert.deepEqual(
		[...(role.schema?.enum ?? [])].sort(),
		["scratch"],
		"a role the contract does not close is a role a client can invent",
	);
});

test("a fill takes its role from the path and never from the body", () => {
	assert.ok(
		operation("fillOwnPlaylist").path.includes("{role}"),
		"the role no longer addresses the playlist it fills",
	);

	for (const id of fills) {
		const carries = `${id} takes a role in its body, where a client picks it as freely as a title`;
		assert.ok(!declaredKeys(id).has("role"), carries);
		assert.ok(!bodyKeys(id).has("role"), carries);
	}
});

test("neither fill carries a field for whether it replaces", () => {
	for (const id of fills) {
		const carries = `${id} lets a caller decide what its target decides`;
		assert.ok(!declaredKeys(id).has("replace"), carries);
		assert.ok(!bodyKeys(id).has("replace"), carries);
	}
});

test("the capabilities document declares whether an install permits playlist writes", () => {
	const capabilities = operation("getCapabilities").published.get(200);
	assert.ok(capabilities, "the contract publishes no capabilities document");

	assert.ok(
		capabilities.properties?.canWritePlaylists,
		"a client generating its types from the contract cannot read a field the contract leaves out",
	);
	assert.ok(
		capabilities.required?.includes("canWritePlaylists"),
		"a field the contract leaves optional is one a client has to guess the meaning of",
	);
});

const tagWrite = (fields: Record<string, unknown>) => ({
	track: "Fictional Artist/Imaginary Album/01 Track.flac",
	fields,
});

test("a tag write takes an array of strings for a field, beside a string and a whole number", () => {
	const request = operation("writeTags").body;
	assert.ok(request, "the contract publishes no tag write request");

	for (const fields of [
		{ genre: ["Rock", "Ambient", "Pop"] },
		{ genre: [] },
		{ genre: "Rock; Pop" },
		{ rating: 4 },
	])
		assert.deepEqual(
			conforms(request, tagWrite(fields)),
			[],
			`the contract refuses ${JSON.stringify(fields)}`,
		);

	for (const fields of [
		{ genre: ["Rock", 4] },
		{ genre: [null] },
		{ genre: [["Rock"]] },
		{ genre: true },
	])
		assert.notDeepEqual(
			conforms(request, tagWrite(fields)),
			[],
			`the contract admits ${JSON.stringify(fields)}`,
		);
});

test("a tag write's answer echoes an array as an array and a string as a string", () => {
	const written = operation("writeTags").published.get(200);
	assert.ok(written, "the contract publishes no answer to a tag write");

	const echo = (fields: Record<string, unknown>) => ({
		written: true,
		track: "Fictional Artist/Imaginary Album/01 Track.flac",
		subsong: 0,
		fields,
	});

	for (const fields of [
		{ genre: ["Rock", "Ambient", "Pop"], rating: "4" },
		{ genre: [] },
	])
		assert.deepEqual(
			conforms(written, echo(fields)),
			[],
			`the contract cannot describe the echo of ${JSON.stringify(fields)}`,
		);

	assert.notDeepEqual(
		conforms(written, echo({ rating: 4 })),
		[],
		"the echo of a whole number is the text written, never the number sent",
	);
});

// Compared without order or case: the spec decides neither, and the allowlist is matched
// case-insensitively.
const DEFAULT_ALLOWLIST = [
	"rating",
	"unsynced lyrics",
	"title",
	"artist",
	"album",
	"album artist",
	"date",
	"genre",
	"publisher",
	"composer",
	"tracknumber",
	"totaltracks",
	"discnumber",
	"totaldiscs",
	"bpm",
].sort();

const asAllowlist = (fields: unknown) => {
	assert.ok(Array.isArray(fields), "allowedFields is not a list");
	return fields.map((field) => String(field).toLowerCase()).sort();
};

test("the contract shows a default install permitting rating, lyrics and every tag the details form edits", () => {
	const shown =
		document.paths["/capabilities"].get.responses["200"].content[
			"application/json"
		].examples.defaultInstall.value.allowedFields;
	assert.deepEqual(asAllowlist(shown), DEFAULT_ALLOWLIST);

	const declared =
		document.components.schemas.Capabilities.properties.allowedFields.examples;
	assert.deepEqual(asAllowlist(declared[0]), DEFAULT_ALLOWLIST);
});

// A playlist row carries a library path and no ordinal, so a details panel opened from one
// names its track the way GET /track/library's library form does.
test("a credit question takes a track and a subsong as GET /track/library takes them", () => {
	for (const name of ["track", "subsong"]) {
		const credits = parameter("getLibraryCredits", name);
		assert.equal(credits.in, "query");
		assert.notEqual(
			credits.required,
			true,
			`a credit question by ordinal is published as needing a ${name}`,
		);
		assert.deepEqual(
			credits.schema,
			parameter("getLibraryTrack", name).schema,
			`a credit question reads ${name} otherwise than GET /track/library does`,
		);
	}

	for (const name of ["ordinal", "structure"])
		assert.notEqual(
			parameter("getLibraryCredits", name).required,
			true,
			`a credit question by library path is published as needing an ${name}`,
		);
});

test("a credit question publishes the 404 a library path no track holds is answered", () => {
	assert.ok(
		operation("getLibraryCredits").published.has(404),
		"a client cannot tell a path no track holds from a refusal",
	);
});

const annotation: Schema = {
	type: "object",
	additionalProperties: false,
	required: ["id", "managed"],
	properties: {
		id: { type: "string" },
		managed: {
			oneOf: [
				{
					type: "object",
					additionalProperties: false,
					required: ["key"],
					properties: { key: { type: "string" } },
				},
				{ type: "null" },
			],
		},
	},
};

test("a document with the published keys is accepted", () => {
	assert.deepEqual(conforms(annotation, { id: "p1", managed: null }), []);
	assert.deepEqual(
		conforms(annotation, { id: "p1", managed: { key: "" } }),
		[],
	);
});

test("a missing key is named", () => {
	assert.deepEqual(conforms(annotation, { id: "p1" }), ["missing managed"]);
});

test("a key the contract does not declare is named", () => {
	assert.deepEqual(
		conforms(annotation, { id: "p1", managed: null, extra: 1 }),
		["undeclared extra"],
	);
});

// The nested case is the one worth having: a roster whose top level is right and whose
// devices are wrong would otherwise pass.
test("a nested document is checked too", () => {
	const roster: Schema = {
		type: "object",
		required: ["devices"],
		properties: {
			devices: {
				type: "array",
				items: {
					type: "object",
					additionalProperties: false,
					required: ["deviceId"],
					properties: { deviceId: { type: "string" } },
				},
			},
		},
	};

	assert.deepEqual(conforms(roster, { devices: [{ name: "a phone" }] }), [
		"missing deviceId in devices[0]",
		"undeclared name in devices[0]",
	]);
});

test("a value matching none of the published shapes is reported once", () => {
	assert.deepEqual(conforms(annotation, { id: "p1", managed: { wrong: 1 } }), [
		"the value in managed matches none of the shapes the spec allows",
	]);
});

test("a value of a type the contract does not publish is named", () => {
	assert.deepEqual(conforms(annotation, { id: 7, managed: null }), [
		"the value in id is integer where the spec declares string",
	]);
});

test("a value the contract enumerates is held to that list", () => {
	const refusal: Schema = {
		type: "object",
		additionalProperties: false,
		required: ["error", "detail"],
		properties: {
			error: { type: "string", enum: ["too many columns", "duplicate column"] },
			detail: { type: "string" },
		},
	};

	assert.deepEqual(
		conforms(refusal, { error: "duplicate column", detail: "" }),
		[],
	);
	assert.deepEqual(
		conforms(refusal, { error: "made up nonsense", detail: "" }),
		["the value in error is none of the values the spec publishes"],
	);
});

// The contract puts two refusal shapes at one status and tells them apart by disjoint error
// strings, so the value is the whole of what decides which shape a document is.
test("an error string neither shape at a status publishes matches no shape", () => {
	const refused = operation("movePlaylist").published.get(400);
	assert.ok(refused, "a move no longer refuses a body");

	assert.deepEqual(
		conforms(refused, { error: "unacceptable title", detail: "" }),
		[],
	);
	assert.deepEqual(
		conforms(refused, { error: "made up nonsense", detail: "" }),
		["the value matches none of the shapes the spec allows"],
	);
});

// A refusal is told from a write by one fixed field, so a body claiming the write happened is
// wrong on the only thing a client reads before it keeps an optimistic value.
test("a field the contract fixes is held to that value", () => {
	const refused = operation("writeTags").published.get(400);
	assert.ok(refused, "a tag write no longer refuses a body");

	assert.deepEqual(
		conforms(refused, {
			written: false,
			error: "malformed request",
			detail: "",
		}),
		[],
	);
	assert.deepEqual(
		conforms(refused, {
			written: true,
			error: "malformed request",
			detail: "",
		}),
		["the value in written is none of the values the spec publishes"],
	);
});

test("a key the contract constrains rather than declares is checked", () => {
	const written: Schema = {
		type: "object",
		required: ["fields"],
		properties: {
			fields: { type: "object", additionalProperties: { type: "string" } },
		},
	};

	assert.deepEqual(conforms(written, { fields: { rating: "4" } }), []);
	assert.deepEqual(conforms(written, { fields: { rating: 4 } }), [
		"the value in fields.rating is integer where the spec declares string",
	]);
});
