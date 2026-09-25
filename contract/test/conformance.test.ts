import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, test } from "node:test";

import { type Attempt, type Context, drives } from "../probes.ts";
import { conforms } from "../shape.ts";
import { type Operation, publishedOperations } from "../spec.ts";

const base = (process.env.CONTRACT_URL ?? "").replace(/\/+$/, "");

// The contract publishes 30 seconds as the point at which an implementation gives up on the
// player, so anything shorter here would report a conformant one as unreachable.
const PATIENCE_MS = 35_000;

const DECLINED = 503;

const operations = new Map(publishedOperations().map((one) => [one.id, one]));

const context: Context = {
	run: randomUUID().slice(0, 8),
	deviceId: randomUUID(),
	playlistId: null,
	playlistPage: null,
	managed: null,
	ticket: null,
	revision: null,
};

function address(operation: Operation, attempt: Attempt) {
	const path = Object.entries(attempt.pathParams ?? {}).reduce(
		(text, [name, value]) =>
			text.replace(`{${name}}`, encodeURIComponent(value)),
		operation.path,
	);

	const url = new URL(base + path);
	for (const [name, value] of Object.entries(attempt.query ?? {}))
		url.searchParams.set(name, value);

	return url;
}

function ask(operation: Operation, attempt: Attempt) {
	const headers: Record<string, string> = {};
	if (operation.method === "POST") headers["Content-Type"] = "application/json";

	return fetch(address(operation, attempt), {
		method: operation.method,
		headers,
		body: attempt.body === undefined ? undefined : JSON.stringify(attempt.body),
		signal: AbortSignal.timeout(PATIENCE_MS),
	});
}

describe("an implementation of the contract", {
	skip: base
		? false
		: "set CONTRACT_URL to the base url of a running implementation",
}, () => {
	for (const drive of drives)
		test(drive.id, async (t) => {
			const operation = operations.get(drive.id);
			assert.ok(operation, `the contract no longer publishes ${drive.id}`);

			const attempt = drive.probe(operation, context);
			if (attempt === null)
				return t.skip(
					"an earlier operation did not answer with what this needs",
				);

			const named = `${operation.method} ${operation.path}`;
			const response = await ask(operation, attempt).catch((reason: Error) => {
				assert.fail(`${named} did not answer: ${reason.message}`);
			});

			assert.ok(
				operation.published.has(response.status),
				`${named} answered ${response.status}, which the contract does not publish for it`,
			);

			const schema = operation.published.get(response.status) ?? null;

			if (schema === null) {
				await response.body?.cancel();
				return;
			}

			const body = await response.json().catch(() => {
				assert.fail(
					`${named} answered ${response.status} without the JSON document the contract publishes for it`,
				);
			});

			const wrong = conforms(schema, body);
			assert.ok(
				wrong.length === 0,
				`${named} answered ${response.status} with a document the contract does not describe: ${wrong.join(", ")}`,
			);

			if (response.status === DECLINED)
				return t.diagnostic(`${named} is not offered by this install`);

			if (response.ok) drive.learns?.(body, context);
		});
});
