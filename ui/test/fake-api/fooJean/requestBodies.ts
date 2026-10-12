export const GUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type FillFailure = {
	status: number;
	body: { error: string; detail: string };
};

export const fillFailure = (
	status: number,
	error: string,
	detail = "",
): FillFailure => ({ status, body: { error, detail } });

export const isNonNegInt = (value: unknown): value is number =>
	Number.isInteger(value) && (value as number) >= 0;

const isRunPair = (value: unknown): value is [number, number] =>
	Array.isArray(value) &&
	value.length === 2 &&
	isNonNegInt(value[0]) &&
	isNonNegInt(value[1]);

type DecodedSelection =
	| { ok: true; ordinals: number[] }
	| ({ ok: false } & FillFailure);

export function decodeSelection(
	record: Record<string, unknown>,
	trackCount: number,
): DecodedSelection {
	const forms = (["runs", "bitset", "ordinals"] as const).filter(
		(key) => record[key] !== undefined,
	);
	if (forms.length !== 1)
		return {
			ok: false,
			...fillFailure(
				400,
				"unacceptable ordinal set",
				forms.length === 0
					? "one of 'runs', 'bitset' or 'ordinals' is required"
					: `'${forms[0]}' and '${forms[1]}' were both present; send exactly one`,
			),
		};

	const [form] = forms;
	let ordinals: number[];

	if (form === "ordinals") {
		const asked = record.ordinals;
		if (!Array.isArray(asked) || !asked.every(isNonNegInt))
			return {
				ok: false,
				...fillFailure(
					400,
					"unacceptable ordinal set",
					"'ordinals' must be a list of non-negative integers",
				),
			};
		ordinals = asked;
	} else if (form === "runs") {
		const asked = record.runs;
		if (!Array.isArray(asked) || !asked.every(isRunPair))
			return {
				ok: false,
				...fillFailure(
					400,
					"unacceptable ordinal set",
					"'runs' must be a list of [start, count] pairs",
				),
			};
		ordinals = asked
			.flatMap(([start, count]) =>
				Array.from({ length: count }, (_, at) => start + at),
			)
			.sort((a, b) => a - b);
	} else {
		const asked = record.bitset;
		if (typeof asked !== "string")
			return {
				ok: false,
				...fillFailure(
					400,
					"unacceptable ordinal set",
					"'bitset' must be base64",
				),
			};
		let bytes: Uint8Array;
		try {
			bytes = Uint8Array.from(atob(asked), (char) => char.charCodeAt(0));
		} catch {
			return {
				ok: false,
				...fillFailure(
					400,
					"unacceptable ordinal set",
					"'bitset' is not valid base64",
				),
			};
		}
		ordinals = [];
		for (let byte = 0; byte < bytes.length; byte += 1)
			for (let bit = 0; bit < 8; bit += 1)
				if (bytes[byte] & (1 << bit)) ordinals.push(byte * 8 + bit);
	}

	const outOfRange = ordinals.find((ordinal) => ordinal >= trackCount);
	if (outOfRange !== undefined)
		return {
			ok: false,
			...fillFailure(
				400,
				"unacceptable ordinal set",
				`ordinal ${outOfRange} is outside a library of ${trackCount} tracks`,
			),
		};

	return { ok: true, ordinals };
}

type ParsedFill =
	| {
			ok: true;
			title?: string;
			structure: number;
			ordinals: number[];
			skipsDuplicates: boolean;
	  }
	| ({ ok: false } & FillFailure);

const DUPLICATES = ["add", "skip"];

export const duplicatesFailure = (duplicates: unknown): FillFailure | null =>
	duplicates === undefined || DUPLICATES.includes(duplicates as string)
		? null
		: fillFailure(
				400,
				"malformed request",
				"'duplicates' must be 'add' or 'skip'",
			);

export function parseFill(
	body: unknown,
	{ requireTitle, trackCount }: { requireTitle: boolean; trackCount: number },
): ParsedFill {
	if (typeof body !== "object" || body === null)
		return {
			ok: false,
			...fillFailure(
				400,
				"malformed request",
				"the body did not parse as JSON",
			),
		};

	const record = body as Record<string, unknown>;
	const allowed = new Set([
		"structure",
		"runs",
		"bitset",
		"ordinals",
		...(requireTitle ? ["title"] : ["duplicates"]),
	]);
	const stray = Object.keys(record).find((key) => !allowed.has(key));
	if (stray)
		return {
			ok: false,
			...fillFailure(
				400,
				"malformed request",
				`'${stray}' is not a field this route accepts`,
			),
		};

	let title: string | undefined;
	if (requireTitle) {
		if (typeof record.title !== "string" || record.title.length === 0)
			return {
				ok: false,
				...fillFailure(400, "unacceptable title", "'title' is required"),
			};
		title = record.title;
	}

	if (!Number.isInteger(record.structure))
		return {
			ok: false,
			...fillFailure(400, "malformed request", "'structure' is required"),
		};

	const refused = duplicatesFailure(record.duplicates);
	if (refused) return { ok: false, ...refused };

	const selection = decodeSelection(record, trackCount);
	if (!selection.ok) return selection;

	return {
		ok: true,
		title,
		structure: record.structure as number,
		ordinals: selection.ordinals,
		skipsDuplicates: record.duplicates === "skip",
	};
}

export const declaresOnly = (
	record: Record<string, unknown>,
	fields: readonly string[],
): boolean => Object.keys(record).every((key) => fields.includes(key));

// A query parameter and a URL segment both arrive as untyped text rather than a JSON number.
export const isDecimal = (text: string): boolean => /^\d+$/.test(text);

// A playlist's own `structure` and `revision` travel as strings of decimal digits on the wire;
// `shared/api/README.md` has why.
export const generationText = (value: bigint): string => String(value);

export function parseGeneration(text: string | null): bigint | null {
	if (text === null || !isDecimal(text)) return null;
	return BigInt(text);
}

// Word for word what core/api.cpp's parseJsonObject and declaresOnly answer for every playback
// route. The JSON-parse exception text a body that fails to parse at all gets there cannot be
// reproduced here: by the time a body reaches this handler it has already been reduced to `null`,
// so that case collapses into the one static string parseJsonObject also answers for a body that
// parsed but was not an object.
export const NOT_A_JSON_OBJECT = "expected a JSON object";
export const FIELD_NOT_TAKEN = "a field this route does not take was named";
