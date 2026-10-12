import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const LAYER_ORDER = "@layer base, shared";

const BASE_STYLESHEET = "shared/styles/base.css";

const isShared = (file: string) =>
	/^shared\/(ui|keyboard)\/[^/]+\.css$/.test(file) ||
	file === "shared/styles/hitArea.module.css";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../../src");

const stylesheets = readdirSync(SRC, { recursive: true, encoding: "utf8" })
	.filter((file) => file.endsWith(".css"))
	.map((file) => ({
		file,
		statements: statementsOf(
			readFileSync(join(SRC, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, ""),
		),
	}));

interface Statement {
	prelude: string;
	body: string | null;
}

function statementsOf(text: string): Statement[] {
	const statements: Statement[] = [];
	let from = 0;
	let depth = 0;
	let open = 0;
	for (let at = 0; at < text.length; at += 1) {
		const character = text[at];
		if (character === "{") {
			if (depth === 0) open = at;
			depth += 1;
		} else if (character === "}") {
			depth -= 1;
			if (depth === 0) {
				statements.push({
					prelude: text.slice(from, open).trim(),
					body: text.slice(open + 1, at),
				});
				from = at + 1;
			}
		} else if (character === ";" && depth === 0) {
			statements.push({ prelude: text.slice(from, at).trim(), body: null });
			from = at + 1;
		}
	}
	return statements;
}

const layerOf = ({ prelude, body }: Statement) =>
	body === null ? null : (/^@layer\s+([\w-]+)$/.exec(prelude)?.[1] ?? null);

const namesALayer = ({ prelude }: Statement) => prelude.startsWith("@layer");

test("a stylesheet that puts rules in a layer states the order of the layers first", () => {
	const offenders = stylesheets
		.filter(({ statements }) => statements.some(namesALayer))
		.filter(({ statements }) => {
			const [first, ...rest] = statements;
			return (
				first.prelude !== LAYER_ORDER ||
				first.body !== null ||
				rest.some((statement) => statement.body === null)
			);
		})
		.map(({ file }) => file);
	assert.deepEqual(
		offenders,
		[],
		`${LAYER_ORDER}; must be the first statement of each of these. A browser ranks layers by where each is first named, any chunk of the build can be the first stylesheet it reads, and an order stated after a layered rule does not reorder it.`,
	);
});

test("a shared component's stylesheet is one block in the shared layer", () => {
	const offenders = stylesheets
		.filter(({ file }) => isShared(file))
		.filter(
			({ statements }) =>
				statements.length !== 2 || layerOf(statements[1]) !== "shared",
		)
		.map(({ file }) => file);
	assert.deepEqual(offenders, []);
});

test("base.css keeps every rule that is not a class of its own in the base layer", () => {
	const base = stylesheets.find(({ file }) => file === BASE_STYLESHEET);
	assert.ok(base);
	const [, layer, ...unlayered] = base.statements;
	assert.equal(layerOf(layer), "base");
	const offenders = unlayered
		.filter(({ prelude }) => !prelude.startsWith("@"))
		.flatMap(({ prelude }) => prelude.split(","))
		.map((selector) => selector.trim())
		.filter((selector) => !/^(:where\()?\./.test(selector));
	assert.deepEqual(offenders, []);
});

test("no other stylesheet names a layer", () => {
	const offenders = stylesheets
		.filter(({ file }) => !isShared(file) && file !== BASE_STYLESHEET)
		.filter(({ statements }) => statements.some(namesALayer))
		.map(({ file }) => file);
	assert.deepEqual(offenders, []);
});

test("nothing in a layer is !important", () => {
	const offenders = stylesheets
		.filter(({ statements }) =>
			statements.some(
				(statement) =>
					layerOf(statement) !== null && statement.body?.includes("!important"),
			),
		)
		.map(({ file }) => file);
	assert.deepEqual(offenders, []);
});
