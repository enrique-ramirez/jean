import { readsAsCount } from "./decimal.ts";

// `kMaxRowsPerAnswer` in `plugins/fb2k/src/core/library_rows.h`.
export const MAX_ROWS_PER_ANSWER = 4096;

const ORDINAL_LIMIT = 2 ** 32;

const MAX_COLUMNS = 64;
const MAX_COLUMN_BYTES = 1024;

const UNPRINTABLE = /[^ -~\u0080-\u{10ffff}]/u;

export const MALFORMED_REQUEST = { error: "malformed request", detail: "" };
export const UNACCEPTABLE_ORDINAL_SET = {
	error: "unacceptable ordinal set",
	detail: "",
};

const refusal = (error: string, detail: string) => ({ error, detail });

const isCount = (value: unknown): value is number =>
	typeof value === "number" && Number.isInteger(value) && value >= 0;

const rowsNamed = (root: Record<string, unknown>) => {
	const { ordinals, runs } = root;
	if (Object.hasOwn(root, "ordinals"))
		return Array.isArray(ordinals) ? ordinals.length : 0;
	if (!Array.isArray(runs)) return 0;

	let total = 0;
	for (const run of runs) {
		if (!Array.isArray(run) || run.length !== 2 || !isCount(run[1])) continue;
		total += Math.min(run[1], MAX_ROWS_PER_ANSWER + 1);
		if (total > MAX_ROWS_PER_ANSWER) break;
	}
	return total;
};

const ordinalsOf = (root: Record<string, unknown>): number[] | null => {
	const { ordinals, runs } = root;
	if (Object.hasOwn(root, "ordinals")) {
		if (!Array.isArray(ordinals)) return null;
		return ordinals.every((one) => isCount(one) && one < ORDINAL_LIMIT)
			? (ordinals as number[])
			: null;
	}

	if (!Array.isArray(runs)) return null;
	const named: number[] = [];
	for (const run of runs) {
		if (
			!Array.isArray(run) ||
			run.length !== 2 ||
			!isCount(run[0]) ||
			!isCount(run[1]) ||
			run[0] + run[1] > ORDINAL_LIMIT
		)
			return null;
		for (let at = 0; at < run[1]; at += 1) named.push(run[0] + at);
	}
	return named.sort((a, b) => a - b);
};

const declarationRefusal = (columns: string[]) => {
	if (columns.length === 0)
		return refusal("unacceptable column", "'columns' is required");
	if (columns.length > MAX_COLUMNS)
		return refusal(
			"too many columns",
			`at most ${MAX_COLUMNS} columns, and ${columns.length} were asked for`,
		);

	const seen = new Set<string>();
	for (const [at, column] of columns.entries()) {
		if (
			column === "" ||
			new TextEncoder().encode(column).length > MAX_COLUMN_BYTES ||
			UNPRINTABLE.test(column)
		)
			return refusal(
				"unacceptable column",
				`column ${at} must be printable text of 1 to ${MAX_COLUMN_BYTES} characters`,
			);
		if (seen.has(column))
			return refusal("duplicate column", `column ${at} repeats an earlier one`);
		seen.add(column);
	}
	return null;
};

export interface RowsAsked {
	structure: string;
	columns: string[];
	ordinals: number[];
}

// Judged in the order `parseRowsRequest` in `core/library_rows.cpp` judges, so the first refusal
// is the component's.
export function parseRowsRequest(
	body: unknown,
): { refused: { error: string; detail: string } } | RowsAsked {
	if (typeof body !== "object" || body === null || Array.isArray(body))
		return { refused: MALFORMED_REQUEST };
	const root = body as Record<string, unknown>;

	const { structure, columns } = root;
	if (typeof structure !== "string" || !readsAsCount(structure))
		return { refused: MALFORMED_REQUEST };

	const declared = columns === undefined ? [] : columns;
	if (
		!Array.isArray(declared) ||
		!declared.every((one): one is string => typeof one === "string")
	)
		return { refused: MALFORMED_REQUEST };

	const forms = ["runs", "bitset", "ordinals"].filter((form) =>
		Object.hasOwn(root, form),
	);
	if (Object.hasOwn(root, "bitset") || forms.length !== 1)
		return { refused: UNACCEPTABLE_ORDINAL_SET };

	if (rowsNamed(root) > MAX_ROWS_PER_ANSWER)
		return {
			refused: refusal(
				"too many rows asked for",
				`a request names at most ${MAX_ROWS_PER_ANSWER} rows`,
			),
		};

	const ordinals = ordinalsOf(root);
	if (ordinals === null) return { refused: UNACCEPTABLE_ORDINAL_SET };

	const refused = declarationRefusal(declared);
	if (refused) return { refused };
	return { structure, columns: declared, ordinals };
}
