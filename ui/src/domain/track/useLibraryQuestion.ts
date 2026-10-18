import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import type {
	LibraryQuestion,
	QuestionAnswerTo,
} from "@/shared/api/libraryQuestions";
import {
	libraryAnswerOf,
	retryLibraryQuestion,
	subscribeLibraryAnswer,
} from "./libraryAsker";
import type { LibraryColumns } from "./libraryColumns";

const NO_UNSUBSCRIBE = () => {};

const NOTHING = { answer: null, failure: null } as const;

export function useLibraryQuestion<Question extends LibraryQuestion>(
	question: Question | null,
	{
		origin,
		key,
		columns,
	}: { origin: string | null; key: string | null; columns: LibraryColumns },
	keepsLast = false,
) {
	const asked = question === null ? null : JSON.stringify(question);
	const parsed = useMemo(
		() => (asked === null ? null : (JSON.parse(asked) as Question)),
		[asked],
	);
	const subscribe = useCallback(
		(listener: () => void) =>
			origin && parsed
				? subscribeLibraryAnswer(origin, parsed, listener)
				: NO_UNSUBSCRIBE,
		[origin, parsed],
	);
	const read = useCallback(
		() => (origin && parsed ? libraryAnswerOf(origin, parsed) : NOTHING),
		[origin, parsed],
	);
	const { answer, failure } = useSyncExternalStore(subscribe, read);
	const retry = useCallback(() => {
		if (origin && parsed) retryLibraryQuestion(origin, parsed);
	}, [origin, parsed]);

	const [last, setLast] = useState<{
		question: Question;
		key: string | null;
		answer: QuestionAnswerTo<Question>;
	} | null>(null);
	if (keepsLast && parsed && answer !== null && last?.answer !== answer)
		setLast({ question: parsed, key, answer });
	const kept = keepsLast && answer === null && last?.key === key ? last : null;

	const isAskable = parsed !== null && key !== null && columns.trackCount > 0;
	return {
		answer: answer ?? kept?.answer ?? null,
		answered: answer === null ? (kept?.question ?? null) : parsed,
		failure,
		retry,
		isWaiting: isAskable && answer === null && failure === null,
	};
}
