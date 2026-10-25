import {
	fetchLibraryAnswer,
	type LibraryQuestion,
	type LibraryRoleName,
	type LibraryRoles,
	type QuestionAnswerTo,
} from "@/shared/api/libraryQuestions";
import type { StateDocument } from "@/shared/api/state";
import { subscribers } from "@/shared/lib/store";
import { FIELD, TRACK_EXPRESSIONS } from "./fields";
import { INTENSITY_FIELDS } from "./intensity";
import {
	announcedLibraryOf,
	declaredAgain,
	holdAfterResult,
	holdsDeclaration,
	isDue,
	isWaitingOnTime,
	now,
	reportedReady,
	type Waiting,
	watchLibrary,
} from "./libraryHolds";

const FIELDS_NO_QUESTION_READS = [...INTENSITY_FIELDS, FIELD.rating];

const READ_EXPRESSIONS = TRACK_EXPRESSIONS.filter(
	(_, field) => !FIELDS_NO_QUESTION_READS.includes(field),
);

type Announced = StateDocument["library"];

function movedAmong(
	before: Announced,
	after: Announced,
	expressions: readonly string[],
) {
	return expressions.some((expression) => {
		const was = before.columns.indexOf(expression);
		const is = after.columns.indexOf(expression);
		return (
			was >= 0 && is >= 0 && before.changeCounts[was] !== after.changeCounts[is]
		);
	});
}

export const readColumnMoved = (before: Announced, after: Announced) =>
	movedAmong(before, after, READ_EXPRESSIONS);

const RATING_EXPRESSION_ONLY = [TRACK_EXPRESSIONS[FIELD.rating]];

const OTHER_EXPRESSIONS = TRACK_EXPRESSIONS.filter(
	(_, field) => field !== FIELD.rating,
);

export const onlyRatingMoved = (before: Announced, after: Announced) =>
	movedAmong(before, after, RATING_EXPRESSION_ONLY) &&
	!movedAmong(before, after, OTHER_EXPRESSIONS);

export const LIBRARY_ROLES = (() => {
	const roles = {} as LibraryRoles;
	for (const name of Object.keys(FIELD) as LibraryRoleName[])
		roles[name] = TRACK_EXPRESSIONS[FIELD[name]];
	return roles;
})();

const QUESTION_RETRY_MS = 1_000;

export interface AnswerFailure {
	reason: "failed" | "unreachable";
}

export interface AnswerView<Question extends LibraryQuestion> {
	answer: QuestionAnswerTo<Question> | null;
	failure: AnswerFailure | null;
}

interface Kept {
	structure: number;
	value: unknown;
}

interface Asker extends Waiting {
	origin: string;
	question: LibraryQuestion;
	listeners: ReturnType<typeof subscribers>;
	at: { structure: number } | null;
	seen: Announced | null;
	kept: Kept | null;
	failure: AnswerFailure | null;
	tries: number;
	controller: AbortController | null;
	timer: ReturnType<typeof setTimeout> | null;
	detach: (() => void) | null;
	hasTurn: boolean;
	isEnded: boolean;
	view: AnswerView<LibraryQuestion>;
}

const NOTHING_ANSWERED: AnswerView<LibraryQuestion> = {
	answer: null,
	failure: null,
};

const askers = new Map<string, Asker>();

type Turn = () => void;

const queues = new Map<string, { isOut: boolean; waiting: Turn[] }>();

function takeTurn(origin: string, signal: AbortSignal) {
	let queue = queues.get(origin);
	if (!queue) {
		queue = { isOut: false, waiting: [] };
		queues.set(origin, queue);
	}
	const line = queue;
	if (!line.isOut) {
		line.isOut = true;
		return Promise.resolve();
	}
	return new Promise<void>((resolve, reject) => {
		const turn: Turn = resolve;
		line.waiting.push(turn);
		signal.addEventListener(
			"abort",
			() => {
				const at = line.waiting.indexOf(turn);
				if (at < 0) return;
				line.waiting.splice(at, 1);
				reject(signal.reason);
			},
			{ once: true },
		);
	});
}

function releaseTurn(origin: string) {
	const line = queues.get(origin);
	const next = line?.waiting.pop();
	if (next) next();
	else if (line) line.isOut = false;
}

export async function inTurn<Result>(
	origin: string,
	signal: AbortSignal,
	run: () => Promise<Result>,
): Promise<Result> {
	await takeTurn(origin, signal);
	try {
		return await run();
	} finally {
		releaseTurn(origin);
	}
}

const askerKey = (origin: string, question: LibraryQuestion) =>
	`${origin}\n${JSON.stringify(question)}`;

function cancel(asker: Asker) {
	asker.controller?.abort();
	asker.controller = null;
	if (asker.timer !== null) clearTimeout(asker.timer);
	asker.timer = null;
}

function libraryAt(origin: string) {
	const library = announcedLibraryOf(origin);
	return library && holdsDeclaration(library)
		? { structure: library.structure, trackCount: library.trackCount }
		: { structure: 0, trackCount: 0 };
}

function keyNow(origin: string) {
	const { structure, trackCount } = libraryAt(origin);
	return trackCount > 0 ? { structure } : null;
}

function followLibrary(asker: Asker) {
	const now = keyNow(asker.origin);
	if (asker.at?.structure === now?.structure) return;

	cancel(asker);
	asker.kept = null;
	asker.at = now;
	asker.hold = { kind: "none" };
	asker.pair = null;
	asker.announced = null;
	asker.tries = 0;
	asker.failure = null;
	asker.listeners.notify();
	if (now) void askAgain(asker);
}

async function askAgain(asker: Asker) {
	const at = asker.at;
	if (!at || asker.isEnded) return;

	cancel(asker);
	const controller = new AbortController();
	asker.controller = controller;
	const library = announcedLibraryOf(asker.origin);
	asker.pair = library
		? { structure: library.structure, revision: library.revision }
		: null;
	asker.announced = null;

	const isSearch = asker.question.kind === "search";
	if (isSearch) {
		try {
			await takeTurn(asker.origin, controller.signal);
		} catch {
			return;
		}
		asker.hasTurn = true;
	}

	const result = await fetchLibraryAnswer(
		asker.origin,
		asker.question,
		LIBRARY_ROLES,
		{
			structure: at.structure,
			trackCount: libraryAt(asker.origin).trackCount,
		},
		controller.signal,
	)
		.catch(() => null)
		.finally(() => {
			if (!isSearch) return;
			asker.hasTurn = false;
			releaseTurn(asker.origin);
		});
	if (controller.signal.aborted || !result || asker.isEnded) return;

	asker.controller = null;
	land(asker, result, at.structure);
}

function land(
	asker: Asker,
	result: Awaited<ReturnType<typeof fetchLibraryAnswer>>,
	structure: number,
) {
	if (result.ok) {
		asker.tries = 0;
		asker.failure = null;
		if (result.structure !== structure) {
			asker.hold = { kind: "refused" };
		} else {
			asker.hold = { kind: "none" };
			asker.kept = { structure, value: result.answer };
		}
		return asker.listeners.notify();
	}

	const { reason } = result;
	if (reason === "unreachable" || reason === "failed")
		return retryOnceThenFail(asker, reason);

	asker.tries = 0;
	if (holdAfterResult(asker, result)) return void askAgain(asker);
	if (asker.hold.kind === "tooFast")
		asker.timer = setTimeout(
			() => {
				asker.timer = null;
				if (asker.hold.kind === "tooFast") void askAgain(asker);
			},
			Math.max(0, asker.hold.until - now()),
		);
	asker.listeners.notify();
}

function retryOnceThenFail(asker: Asker, reason: AnswerFailure["reason"]) {
	asker.tries += 1;
	if (asker.tries === 1) {
		asker.timer = setTimeout(() => {
			asker.timer = null;
			void askAgain(asker);
		}, QUESTION_RETRY_MS);
		return;
	}
	asker.hold = { kind: "none" };
	asker.failure = { reason };
	asker.listeners.notify();
}

function followChangeCounts(asker: Asker, library: Announced) {
	const before = asker.seen;
	asker.seen = library;
	if (
		!before ||
		!asker.at ||
		before.structure !== library.structure ||
		!readColumnMoved(before, library)
	)
		return;

	asker.hold = { kind: "none" };
	asker.tries = 0;
	asker.failure = null;
	asker.listeners.notify();
	void askAgain(asker);
}

function startAsking(asker: Asker) {
	asker.seen ??= announcedLibraryOf(asker.origin);
	const stopWatching = watchLibrary(asker.origin, {
		exported: () => {
			if (declaredAgain(asker)) void askAgain(asker);
		},
		announced: (library) => {
			followLibrary(asker);
			followChangeCounts(asker, library);
			if (reportedReady(asker, library)) void askAgain(asker);
		},
		answered: () => {
			if (!asker.controller && isWaitingOnTime(asker) && isDue(asker))
				void askAgain(asker);
		},
	});
	asker.detach = () => {
		stopWatching();
		asker.detach = null;
	};
	followLibrary(asker);
}

// React's StrictMode unmounts and remounts in one task, so a last listener leaving and another
// arriving keeps the question in flight.
export function subscribeLibraryAnswer(
	origin: string,
	question: LibraryQuestion,
	listener: () => void,
) {
	const key = askerKey(origin, question);
	let asker = askers.get(key);
	if (!asker) {
		asker = {
			origin,
			question,
			listeners: subscribers(),
			at: null,
			seen: null,
			kept: null,
			failure: null,
			tries: 0,
			controller: null,
			timer: null,
			detach: null,
			hasTurn: false,
			isEnded: false,
			view: NOTHING_ANSWERED,
			pair: null,
			hold: { kind: "none" },
			announced: null,
		};
		askers.set(key, asker);
	}
	const holding = asker;
	const unsubscribe = holding.listeners.subscribe(listener);
	if (!holding.detach) startAsking(holding);

	return () => {
		unsubscribe();
		if (holding.listeners.size > 0) return;
		queueMicrotask(() => {
			if (holding.listeners.size > 0) return;
			holding.isEnded = true;
			if (!holding.hasTurn) cancel(holding);
			if (holding.timer !== null) clearTimeout(holding.timer);
			holding.timer = null;
			holding.detach?.();
			if (askers.get(key) === holding) askers.delete(key);
		});
	};
}

export function libraryAnswerOf<Question extends LibraryQuestion>(
	origin: string,
	question: Question,
): AnswerView<Question> {
	const asker = askers.get(askerKey(origin, question));
	if (!asker) return NOTHING_ANSWERED as AnswerView<Question>;

	const { structure } = libraryAt(origin);
	const answer = asker.kept?.structure === structure ? asker.kept.value : null;
	const failure = asker.at?.structure === structure ? asker.failure : null;
	if (asker.view.answer !== answer || asker.view.failure !== failure)
		asker.view = { answer, failure } as AnswerView<LibraryQuestion>;
	return asker.view as AnswerView<Question>;
}

export function retryLibraryQuestion(
	origin: string,
	question: LibraryQuestion,
) {
	const asker = askers.get(askerKey(origin, question));
	if (!asker?.failure) return;

	asker.failure = null;
	asker.tries = 0;
	asker.listeners.notify();
	void askAgain(asker);
}
