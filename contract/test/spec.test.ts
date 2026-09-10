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
		ticket: null,
		revision: null,
	};

	for (const id of [
		"updateAutoPlaylist",
		"removeAutoPlaylist",
		"openStream",
		"getLibraryChanges",
	])
		assert.equal(drive(id).probe(operation(id), fresh), null);
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
