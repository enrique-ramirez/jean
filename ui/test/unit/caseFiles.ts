import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { components } from "../../src/shared/api/fooJeanSchema.d.ts";

export const FIXTURES = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../../../plugins/fb2k/tests/fixtures",
);

export const QUESTIONS_FILE = "library_questions_cases.json";
export const SETS_FILE = "library_sets_cases.json";
export const SUMMARY_FILE = "library_summary_cases.json";

export const fixture = <Shape>(name: string): Shape =>
	JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));

export interface CaseLibrary {
	directory: string[];
	filename: string[];
	subsong: string[];
	columns: Record<string, string[]>;
}

export type Question =
	| { kind: "album"; name: string; by?: string }
	| { kind: "artist"; name: string; splitsCredits: boolean }
	| { kind: "genre"; name: string }
	| {
			kind: "search";
			query: string;
			limit: number;
			entityLimit: number;
			splitsCredits: boolean;
	  };

export interface StoredQuestionCase {
	name: string;
	structure: number;
	revision: number;
	library: string;
	question: Question;
	expected: Record<string, unknown>;
}

export interface QuestionCase extends CaseLibrary {
	name: string;
	structure: number;
	revision: number;
	question: Question;
	expected: Record<string, unknown>;
}

export interface FoldCase {
	text: string;
	fold: string;
	squash: string;
	tokenize: string[];
	length: number;
}

export interface QuestionsFile {
	commit: string;
	libraries: Record<string, CaseLibrary>;
	cases: StoredQuestionCase[];
	fold: FoldCase[];
}

export interface Figures {
	albumCount: number;
	trackCount: number;
	seconds: number;
	earliestYear: number | null;
	latestYear: number | null;
}

export interface FrozenGenre {
	name: string;
	count: number;
	share: number;
}

export interface FrozenCards {
	playedShare: number;
	plays: number;
	neverPlayed: number;
	lastPlayed: number | null;
	mostPlayed: { position: number; ordinal: number; plays: number } | null;
	topGenres: FrozenGenre[];
}

export interface FrozenRecord {
	album: string;
	artist: string | null;
	year: number | null;
	cover: number;
	trackCount: number;
}

export type Part = "refs" | "own" | "shared" | "guest" | "all" | "matched";

export interface FrozenSet {
	kind: Question["kind"];
	question: Question;
	part: Part;
	figures: Figures;
	cards?: FrozenCards;
	records?: FrozenRecord[];
}

export type Measure = "duration" | "year" | "playCount" | "lastPlayed";

export interface SetsCase {
	name: string;
	source: typeof QUESTIONS_FILE;
	measures: Record<Measure, string[]>;
	genres: {
		name: string;
		count: number;
		albumCount: number;
		artistCount: number;
		covers: number[];
	}[];
	sets: FrozenSet[];
}

export interface SetsFile {
	zone: string;
	cases: SetsCase[];
}

type LibrarySummary = components["schemas"]["LibrarySummary"];
type Shelf = LibrarySummary["shelves"][number];

export type FrozenSummary = Omit<LibrarySummary, "shelves"> & {
	shelves: Omit<Shelf, "figures">[];
};

export interface SummaryCase extends CaseLibrary {
	name: string;
	structure: number;
	revision: number;
	now: number;
	expected: FrozenSummary;
}

export interface KeyCase {
	a: string;
	b: string;
	match: boolean;
}

export interface SummaryFile {
	zone: string;
	cases: SummaryCase[];
	keys: KeyCase[];
}

const once = <Shape>(load: () => Shape) => {
	let held: Shape | undefined;
	return () => {
		held ??= load();
		return held;
	};
};

export const questionsFile = once(() => fixture<QuestionsFile>(QUESTIONS_FILE));
export const setsFile = once(() => fixture<SetsFile>(SETS_FILE));
export const summaryFile = once(() => fixture<SummaryFile>(SUMMARY_FILE));

export const libraryNamed = (file: QuestionsFile, name: string) => {
	const library = file.libraries[name];
	if (!library) throw new Error(`${QUESTIONS_FILE} holds no library ${name}`);
	return library;
};

export const questionCases = once((): QuestionCase[] => {
	const file = questionsFile();
	return file.cases.map(({ library, ...stored }) => ({
		...stored,
		...libraryNamed(file, library),
	}));
});
