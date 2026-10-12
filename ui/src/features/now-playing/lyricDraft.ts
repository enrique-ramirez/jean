import { readSource } from "./lyricsFormat";

export interface DraftLine {
	id: number;
	at: number | null;
	text: string;
}

export interface LyricDraft {
	headers: string[];
	lines: DraftLine[];
}

const wholeMilliseconds = (seconds: number) =>
	Math.max(0, Math.round(seconds * 1000) / 1000);

const isBlankUntimed = (line: Omit<DraftLine, "id">) =>
	line.at === null && !line.text;

export function draftFromText(raw: string): LyricDraft {
	const { headers, offset, lines } = readSource(raw);
	const rows = lines.flatMap(({ times, text }): Omit<DraftLine, "id">[] =>
		times.length === 0
			? [{ at: null, text }]
			: times.map((at) => ({ at: wholeMilliseconds(at - offset), text })),
	);

	const words = rows.filter((row) => !isBlankUntimed(row));
	const timedWords = words.filter(
		(row): row is Omit<DraftLine, "id"> & { at: number } => row.at !== null,
	);
	const fullyTimed = words.length > 0 && timedWords.length === words.length;

	let kept: Omit<DraftLine, "id">[];
	if (fullyTimed) {
		kept = timedWords.sort((a, b) => a.at - b.at);
	} else {
		const first = rows.findIndex((row) => !isBlankUntimed(row));
		const last = rows.findLastIndex((row) => !isBlankUntimed(row));
		kept = first < 0 ? [] : rows.slice(first, last + 1);
	}

	return { headers, lines: kept.map((line, id) => ({ id, ...line })) };
}

function shifted(line: DraftLine, seconds: number): DraftLine {
	return line.at === null
		? line
		: { ...line, at: wholeMilliseconds(line.at + seconds) };
}

export function shiftAll(draft: LyricDraft, seconds: number): LyricDraft {
	return { ...draft, lines: draft.lines.map((line) => shifted(line, seconds)) };
}

export function shiftLine(
	draft: LyricDraft,
	index: number,
	seconds: number,
): LyricDraft {
	return {
		...draft,
		lines: draft.lines.map((line, i) =>
			i === index ? shifted(line, seconds) : line,
		),
	};
}

export function stampLine(
	draft: LyricDraft,
	index: number,
	at: number,
): { draft: LyricDraft; selected: number } {
	return {
		draft: {
			...draft,
			lines: draft.lines.map((line, i) =>
				i === index ? { ...line, at: wholeMilliseconds(at) } : line,
			),
		},
		selected: Math.min(index + 1, draft.lines.length - 1),
	};
}

const twoDigits = (value: number) => String(value).padStart(2, "0");

// Rounding before splitting carries 59.996 s into the next minute.
function timeParts(at: number) {
	const hundredths = Math.round(at * 100);
	const rest = hundredths % 6000;
	return {
		minutes: Math.floor(hundredths / 6000),
		seconds: twoDigits(Math.floor(rest / 100)),
		hundredths: twoDigits(rest % 100),
	};
}

export function clockOf(at: number): string {
	const { minutes, seconds, hundredths } = timeParts(at);
	return `${minutes}:${seconds}.${hundredths}`;
}

export const clockOfTenths = (at: number) => clockOf(at).slice(0, -1);

// An LRC stamp is [mm:ss.xx], centiseconds.
function timestamp(at: number): string {
	const { minutes, seconds, hundredths } = timeParts(at);
	return `[${twoDigits(minutes)}:${seconds}.${hundredths}]`;
}

export function setLineText(
	draft: LyricDraft,
	index: number,
	text: string,
): LyricDraft {
	return {
		...draft,
		lines: draft.lines.map((line, i) =>
			i === index ? { ...line, text } : line,
		),
	};
}

export function insertLineBelow(
	draft: LyricDraft,
	index: number,
): { draft: LyricDraft; selected: number } {
	const id = draft.lines.reduce((top, line) => Math.max(top, line.id), -1) + 1;
	const lines = [...draft.lines];
	lines.splice(index + 1, 0, { id, at: null, text: "" });
	return { draft: { ...draft, lines }, selected: index + 1 };
}

export function removeLine(
	draft: LyricDraft,
	index: number,
): { draft: LyricDraft; selected: number | null } {
	const lines = draft.lines.filter((_, i) => i !== index);
	return {
		draft: { ...draft, lines },
		selected: lines.length === 0 ? null : Math.min(index, lines.length - 1),
	};
}

export function sameDraft(a: LyricDraft, b: LyricDraft): boolean {
	return (
		a.headers.length === b.headers.length &&
		a.headers.every((header, i) => header === b.headers[i]) &&
		a.lines.length === b.lines.length &&
		a.lines.every((line, i) => {
			const other = b.lines[i];
			return (
				line.id === other.id && line.at === other.at && line.text === other.text
			);
		})
	);
}

export function serialiseDraft(draft: LyricDraft): string {
	const timed = draft.lines.some((line) => line.at !== null);

	if (!timed) return draft.lines.map((line) => line.text).join("\n");

	return [
		...draft.headers,
		...draft.lines.map((line) =>
			line.at === null ? line.text : `${timestamp(line.at)}${line.text}`,
		),
	].join("\n");
}
