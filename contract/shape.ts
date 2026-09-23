import type { Schema } from "./spec.ts";

const inside = (path: string) => (path ? ` in ${path}` : "");

const step = (path: string, key: string) => (path ? `${path}.${key}` : key);

const declaredTypes = (schema: Schema): string[] =>
	schema.type === undefined
		? []
		: Array.isArray(schema.type)
			? schema.type
			: [schema.type];

const typeOf = (value: unknown): string =>
	value === null
		? "null"
		: Array.isArray(value)
			? "array"
			: typeof value === "number" && Number.isInteger(value)
				? "integer"
				: typeof value;

const matchesType = (types: string[], value: unknown) => {
	const found = typeOf(value);
	return (
		types.includes(found) || (found === "integer" && types.includes("number"))
	);
};

function keysOfObject(schema: Schema, body: unknown, path: string): string[] {
	const declared = schema.properties ?? {};
	const entries = Object.entries(body as Record<string, unknown>);
	const present = new Set(entries.map(([key]) => key));

	const missing = (schema.required ?? [])
		.filter((key) => !present.has(key))
		.map((key) => `missing ${key}${inside(path)}`);

	const undeclared =
		schema.additionalProperties === false
			? entries
					.filter(([key]) => !(key in declared))
					.map(([key]) => `undeclared ${key}${inside(path)}`)
			: [];

	const rest =
		typeof schema.additionalProperties === "object"
			? schema.additionalProperties
			: null;

	const nested = entries.flatMap(([key, value]) => {
		const property = declared[key] ?? rest;
		return property ? conforms(property, value, step(path, key)) : [];
	});

	return [...missing, ...undeclared, ...nested];
}

// A `const` is an enum of one, and the contract writes both.
const publishedValues = (schema: Schema): unknown[] | undefined =>
	schema.enum ?? ("const" in schema ? [schema.const] : undefined);

// The keywords below are the whole of what this file judges a body against. A schema
// declaring none of them constrains nothing it reads, so answering "conforms" would report
// success on a document nothing looked at.
const judgeable = (schema: Schema) =>
	schema.type !== undefined ||
	schema.properties !== undefined ||
	schema.items !== undefined ||
	schema.oneOf !== undefined ||
	schema.anyOf !== undefined ||
	publishedValues(schema) !== undefined;

// Values are never quoted back: one of these documents carries a bearer token.
export function conforms(schema: Schema, body: unknown, path = ""): string[] {
	if (!judgeable(schema))
		throw new Error(
			`the spec constrains ${path || "the body"} by nothing this file reads, so a check of it would pass on anything`,
		);

	// Both keywords are read as at least one branch matching. The spec's `oneOf` pairs closed
	// schemas with disjoint enums, where exactly one and at least one are the same question.
	const alternatives = schema.oneOf ?? schema.anyOf;
	if (alternatives) {
		const branches = alternatives.map((branch) => conforms(branch, body, path));
		return branches.some((found) => found.length === 0)
			? []
			: [`the value${inside(path)} matches none of the shapes the spec allows`];
	}

	const types = declaredTypes(schema);
	if (types.length > 0 && !matchesType(types, body))
		return [
			`the value${inside(path)} is ${typeOf(body)} where the spec declares ${types.join(" or ")}`,
		];

	const published = publishedValues(schema);
	if (published && !published.includes(body))
		return [
			`the value${inside(path)} is none of the values the spec publishes`,
		];

	const items = schema.items;
	if (items && Array.isArray(body))
		return body.flatMap((item, index) =>
			conforms(items, item, `${path}[${index}]`),
		);

	// A schema with properties and no declared type is still an object, which is how the
	// contract writes several of its inline shapes.
	if (schema.properties === undefined && !types.includes("object")) return [];
	if (typeof body !== "object" || body === null || Array.isArray(body))
		return [`the value${inside(path)} is not an object`];

	return keysOfObject(schema, body, path);
}
