import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { components } from "../src/shared/api/fooJeanSchema.d.ts";
import { fold, squash, tokenize } from "../src/shared/lib/text.ts";
import { answerQuestion } from "../test/fake-api/fooJean/libraryQuestions.ts";
import { setsOverSweep } from "../test/fake-api/fooJean/librarySets.ts";
import {
	fixedOffset,
	type SummaryInput,
	summarise,
} from "../test/fake-api/fooJean/librarySummary.ts";
import { runToEnd } from "../test/fake-api/yielding.ts";
import {
	type CaseLibrary,
	FIXTURES,
	type FrozenCards,
	type FrozenSet,
	type FrozenSummary,
	libraryNamed,
	type Part,
	QUESTIONS_FILE,
	type QuestionsFile,
	questionsFile,
	SETS_FILE,
	type SetsFile,
	SUMMARY_FILE,
	type SummaryCase,
	type SummaryFile,
	setsFile,
	summaryFile,
} from "../test/unit/caseFiles.ts";

type OrdinalSet = components["schemas"]["OrdinalSet"];
type ArtistCards = components["schemas"]["ArtistCards"];
type AlbumRecord = components["schemas"]["AlbumRecord"];
type Kind = FrozenSet["kind"];

const FROZEN_ZONE = "Asia/Kolkata";
const FROZEN_OFFSET_MINUTES = 330;
const NOON = Date.UTC(2026, 9, 16, 12, 0, 0);

const LOCAL = fixedOffset(FROZEN_OFFSET_MINUTES);

const frozenIn = (file: string, zone: string) => {
	if (!zone.startsWith(FROZEN_ZONE))
		throw new Error(`${file} is frozen in ${zone}, not ${FROZEN_ZONE}`);
};

const SET_KEYS: Record<Kind, readonly string[]> = {
	album: ["refs"],
	artist: ["own", "shared", "guest"],
	genre: ["refs"],
	search: ["matched"],
};

const SET_SUMMARY_KEYS = ["figures", "cards", "records"];

const asSent = <Document>(document: Document): Document =>
	JSON.parse(JSON.stringify(document));

const ordinalsOf = (set: OrdinalSet, trackCount: number): number[] => {
	if ("runs" in set)
		return set.runs.flatMap(([start, count]) =>
			Array.from({ length: count }, (_, at) => start + at),
		);
	const bytes = Buffer.from(set.bitset, "base64");
	const ordinals: number[] = [];
	for (let ordinal = 0; ordinal < trackCount; ordinal += 1)
		if (bytes[ordinal >> 3] & (1 << (ordinal & 7))) ordinals.push(ordinal);
	return ordinals;
};

type Answer = Record<string, unknown>;

const frozenAnswer = (
	library: CaseLibrary & { structure: number; revision: number },
	question: FrozenSet["question"],
): Answer => {
	const sent: Answer = asSent(answerQuestion(library, question, LOCAL));
	for (const key of SET_SUMMARY_KEYS) delete sent[key];
	for (const key of SET_KEYS[question.kind])
		if (sent[key] !== null)
			sent[key] = ordinalsOf(sent[key] as OrdinalSet, library.directory.length);
	return sent;
};

const renderQuestions = (): QuestionsFile => {
	const file = questionsFile();
	return {
		commit: file.commit,
		libraries: file.libraries,
		cases: file.cases.map((stored) => ({
			...stored,
			expected: frozenAnswer(
				{
					...libraryNamed(file, stored.library),
					structure: stored.structure,
					revision: stored.revision,
				},
				stored.question,
			),
		})),
		fold: file.fold.map(({ text }) => ({
			text,
			fold: fold(text),
			squash: squash(text),
			tokenize: tokenize(text),
			length: text.length,
		})),
	};
};

const partsOf = (kind: Kind, expected: Answer): [Part, number[]][] => {
	const named = (part: Part) => expected[part] as number[];
	switch (kind) {
		case "artist": {
			const all = [
				...new Set([...named("own"), ...named("shared"), ...named("guest")]),
			].sort((a, b) => a - b);
			return [
				["own", named("own")],
				["shared", named("shared")],
				["guest", named("guest")],
				["all", all],
			];
		}
		case "search":
			return expected.matched === null ? [] : [["matched", named("matched")]];
		default:
			return [["refs", named("refs")]];
	}
};

const frozenCards = (
	cards: ArtistCards,
	ordinals: readonly number[],
): FrozenCards => ({
	playedShare: cards.playedShare,
	plays: cards.plays,
	neverPlayed: cards.neverPlayed,
	lastPlayed: cards.lastPlayed,
	mostPlayed: cards.mostPlayed && {
		position: ordinals.indexOf(cards.mostPlayed.ordinal),
		ordinal: cards.mostPlayed.ordinal,
		plays: cards.mostPlayed.plays,
	},
	topGenres: cards.topGenres,
});

const ordinalFinder = ({ directory, filename }: CaseLibrary) => {
	const ordinals = new Map<string, number>();
	directory.forEach((_, at) => {
		const path = `${directory[at]}${filename[at]}`;
		if (!ordinals.has(path)) ordinals.set(path, at);
	});
	return (path: string) => {
		const ordinal = ordinals.get(path);
		if (ordinal === undefined) throw new Error(`no track at ${path}`);
		return ordinal;
	};
};

const renderSets = (questions: QuestionsFile): SetsFile => {
	const held = setsFile();
	frozenIn(SETS_FILE, held.zone);
	const measuresOf = new Map(held.cases.map((one) => [one.name, one.measures]));
	return {
		zone: held.zone,
		cases: questions.cases.map((stored) => {
			const library = libraryNamed(questions, stored.library);
			const measures = measuresOf.get(stored.name);
			if (!measures) throw new Error(`${SETS_FILE} holds no ${stored.name}`);
			const input: SummaryInput = {
				structure: stored.structure,
				revision: stored.revision,
				directory: library.directory,
				filename: library.filename,
				columns: { ...library.columns, ...measures },
			};
			const sets = runToEnd(setsOverSweep(input, LOCAL));
			const ordinalAt = ordinalFinder(library);
			const { kind } = stored.question;
			const frozenRecords = (records: AlbumRecord[]) =>
				records.map((record) => ({
					...record,
					cover: ordinalAt(record.cover),
				}));
			return {
				name: stored.name,
				source: QUESTIONS_FILE,
				measures,
				genres: (summarise(input, NOON, LOCAL, true).genres ?? []).map(
					(genre) => ({ ...genre, covers: genre.covers.map(ordinalAt) }),
				),
				sets: partsOf(kind, stored.expected).map(
					([part, ordinals]): FrozenSet => ({
						kind,
						question: stored.question,
						part,
						figures: runToEnd(sets.figures(ordinals)),
						...(kind === "artist"
							? {
									cards: frozenCards(sets.cards(ordinals), ordinals),
									records: frozenRecords(sets.records(ordinals)),
								}
							: null),
					}),
				),
			};
		}),
	};
};

const frozenSummary = (one: SummaryCase): FrozenSummary => {
	const { structure, revision, directory, filename, columns, now } = one;
	const document = asSent(
		summarise(
			{ structure, revision, directory, filename, columns },
			now,
			LOCAL,
		),
	);
	return {
		...document,
		shelves: document.shelves.map(({ figures: _, ...shelf }) => shelf),
	};
};

const renderSummary = (): SummaryFile => {
	const held = summaryFile();
	frozenIn(SUMMARY_FILE, held.zone);
	return {
		zone: held.zone,
		cases: held.cases.map((one) => ({
			...one,
			expected: frozenSummary(one),
		})),
		keys: held.keys,
	};
};

interface Rendered {
	name: string;
	text: string;
	cases: Map<string, string>;
}

const casesIn = (file: { cases: { name: string }[] }) =>
	new Map(file.cases.map((one) => [one.name, JSON.stringify(one)]));

const rendered = (
	name: string,
	document: { cases: { name: string }[] },
	indent: number | string,
): Rendered => ({
	name,
	text: `${JSON.stringify(document, null, indent)}\n`,
	cases: casesIn(document),
});

export const renderCaseFiles = (): Rendered[] => {
	const questions = renderQuestions();
	return [
		rendered(QUESTIONS_FILE, questions, 2),
		rendered(SETS_FILE, renderSets(questions), "\t"),
		rendered(SUMMARY_FILE, renderSummary(), 2),
	];
};

export interface Drift {
	file: string;
	cases: string[];
}

const SHAPE_DRIFT = "(the file's shape or formatting)";

export const caseFileDrift = (): Drift[] =>
	renderCaseFiles().flatMap(({ name, text, cases }) => {
		const committed = readFileSync(join(FIXTURES, name), "utf8");
		if (committed === text) return [];
		const held = casesIn(JSON.parse(committed));
		const moved = [...new Set([...held.keys(), ...cases.keys()])].filter(
			(one) => held.get(one) !== cases.get(one),
		);
		return [{ file: name, cases: moved.length > 0 ? moved : [SHAPE_DRIFT] }];
	});

export const writeCaseFiles = () => {
	for (const { name, text } of renderCaseFiles())
		writeFileSync(join(FIXTURES, name), text);
};

const main = () => {
	if (!process.argv.includes("--check")) {
		writeCaseFiles();
		return;
	}
	const drift = caseFileDrift();
	for (const { file, cases } of drift) {
		console.error(`${file} differs from what the fake answers today:`);
		for (const name of cases) console.error(`  ${name}`);
	}
	process.exitCode = drift.length > 0 ? 1 : 0;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
