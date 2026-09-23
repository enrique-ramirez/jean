import { readFileSync } from "node:fs";

import { parse } from "yaml";

const SPEC = new URL("./openapi.yaml", import.meta.url);

export interface Schema {
	type?: string | string[];
	properties?: Record<string, Schema>;
	required?: string[];
	additionalProperties?: boolean | Schema;
	items?: Schema;
	oneOf?: Schema[];
	anyOf?: Schema[];
	enum?: unknown[];
	const?: unknown;
}

export interface Parameter {
	name: string;
	in: string;
	required?: boolean;
	schema?: Schema;
}

export interface Operation {
	id: string;
	method: string;
	path: string;
	needsToken: boolean;
	parameters: Parameter[];
	published: Map<number, Schema | null>;
	body: Schema | null;
	examples: Record<string, unknown>;
}

type Mapping = Record<string, unknown>;

const pointer = (document: Mapping, ref: string) =>
	ref
		.slice(2)
		.split("/")
		.reduce<unknown>((node, key) => (node as Mapping)[key], document);

function inlined(document: Mapping): Mapping {
	const known = new Map<string, Mapping>();

	const walk = (node: unknown): unknown => {
		if (Array.isArray(node)) return node.map(walk);
		if (node === null || typeof node !== "object") return node;

		const ref = (node as Mapping).$ref;
		if (typeof ref !== "string")
			return Object.fromEntries(
				Object.entries(node as Mapping).map(([key, value]) => [
					key,
					walk(value),
				]),
			);

		const seen = known.get(ref);
		if (seen) return seen;

		const target: Mapping = {};
		known.set(ref, target);
		return Object.assign(target, walk(pointer(document, ref)) as Mapping);
	};

	return walk(document) as Mapping;
}

const jsonSchemaOf = (node: Mapping): Schema | null =>
	(((node.content as Mapping | undefined)?.["application/json"] as Mapping)
		?.schema as Schema) ?? null;

const publishedOf = (responses: Mapping) =>
	new Map(
		Object.entries(responses).map(([status, response]) => [
			Number(status),
			jsonSchemaOf(response as Mapping),
		]),
	);

const examplesOf = (requestBody: Mapping | undefined) => {
	const offered = (
		(requestBody?.content as Mapping | undefined)?.["application/json"] as
			| Mapping
			| undefined
	)?.examples as Record<string, Mapping> | undefined;

	return Object.fromEntries(
		Object.entries(offered ?? {}).map(([name, example]) => [
			name,
			example.value,
		]),
	);
};

// A parameter an operation declares replaces the path item's of the same name and place, which
// is OpenAPI's own rule rather than a convention of this spec.
const parametersOf = (entry: Mapping, operation: Mapping): Parameter[] => {
	const declared = [
		...((entry.parameters as Parameter[] | undefined) ?? []),
		...((operation.parameters as Parameter[] | undefined) ?? []),
	];

	return [
		...new Map(declared.map((one) => [`${one.in} ${one.name}`, one])).values(),
	];
};

const METHODS = ["get", "post", "put", "patch", "delete"];

export function publishedOperations(): Operation[] {
	const document = inlined(parse(readFileSync(SPEC, "utf8")));
	const paths = document.paths as Record<string, Mapping>;

	return Object.entries(paths).flatMap(([path, entry]) =>
		METHODS.filter((method) => entry[method]).map((method) => {
			const operation = entry[method] as Mapping;
			const requestBody = operation.requestBody as Mapping | undefined;

			return {
				id: String(operation.operationId),
				method: method.toUpperCase(),
				path,
				// An operation says it needs no credential by overriding the document's own
				// security with an empty list, so anything that does not override needs one.
				needsToken: operation.security === undefined,
				parameters: parametersOf(entry, operation),
				published: publishedOf(operation.responses as Mapping),
				body: requestBody ? jsonSchemaOf(requestBody) : null,
				examples: examplesOf(requestBody),
			};
		}),
	);
}
