import assert from "node:assert/strict";
import { test } from "node:test";

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
		"getLibraryChanges",
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

test("the contract carries a fill per owner, and refuses only the one addressing a user's playlist", () => {
	const own = operation("fillOwnPlaylist");
	const users = operation("fillPlaylist");

	assert.equal(`${own.method} ${own.path}`, "POST /playlists/own/{role}/items");
	assert.equal(`${users.method} ${users.path}`, "POST /playlists/{id}/items");

	assert.ok(
		!own.published.has(403),
		"the read-only-playlists setting now reaches a playlist the component owns",
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
		!play.published.has(403),
		"a read-only instance now refuses a playback command as though it were an edit",
	);
});

// A create reading a set the fill route would refuse, or refusing one it would take, is a
// second grammar for a client to learn. The contract holds the two together by declaring the
// same fields, so a client that can fill a playlist can fill one it is creating.
test("a create takes the fill's own set, and the setting refuses it", () => {
	const create = operation("createPlaylist");

	assert.equal(`${create.method} ${create.path}`, "POST /playlists");

	for (const field of declaredKeys("fillPlaylist"))
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

	assert.deepEqual(copied.required?.sort(), ["positions", "structure"]);

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
