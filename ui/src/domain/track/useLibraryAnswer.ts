import { useEffect, useState } from "react";
import { overColumns } from "./columnCache";
import { CREDIT_TAGS, TRACK_EXPRESSIONS } from "./fields";
import { INTENSITY_FIELDS } from "./intensity";
import { isLoaded, type LibraryColumns } from "./libraryColumns";
import { librarySearcher } from "./librarySearcher";
import type { AnswerTo, SearchQuestion } from "./searchCore";

const ANSWERED_FROM = TRACK_EXPRESSIONS.map((_, field) => field).filter(
	(field) => !INTENSITY_FIELDS.includes(field),
);

const contentOf = overColumns(ANSWERED_FROM, () => ({}));

interface Held<Question extends SearchQuestion> {
	question: Question;
	asked: string;
	key: string;
	hadCredits: boolean;
	answer: AnswerTo<Question>;
}

export function useLibraryAnswer<Question extends SearchQuestion>(
	question: Question | null,
	library: { key: string | null; columns: LibraryColumns },
	keepsLast: boolean,
) {
	const { key, columns } = library;
	const isAskable = question !== null && key !== null && columns.trackCount > 0;
	const asked = isAskable ? JSON.stringify(question) : null;
	const content = contentOf(columns);
	const hasCredits = isLoaded(columns, CREDIT_TAGS);
	const [held, setHeld] = useState<Held<Question> | null>(null);
	const [replacements, setReplacements] = useState(0);

	// biome-ignore lint/correctness/useExhaustiveDependencies: a column moving, or the worker's library being replaced, fires this rather than being read in it.
	useEffect(() => {
		const searcher = librarySearcher();
		if (asked === null || key === null || searcher === null) return;

		let isCancelled = false;
		const ofQuestion = JSON.parse(asked) as Question;
		const version = searcher.version();
		void searcher.ask(ofQuestion).then((answer) => {
			if (isCancelled) return;
			if (answer !== null)
				return setHeld({
					question: ofQuestion,
					asked,
					key,
					hadCredits: hasCredits,
					answer,
				});
			if (searcher.version() !== version) setReplacements((count) => count + 1);
		});
		return () => {
			isCancelled = true;
		};
	}, [asked, key, content, replacements, hasCredits]);

	const ofThisLibrary = isAskable && held?.key === key ? held : null;
	const isCurrent =
		ofThisLibrary?.asked === asked &&
		(question?.kind === "album" ||
			question?.kind === "genre" ||
			ofThisLibrary.hadCredits === hasCredits);
	const shown = isCurrent || keepsLast ? ofThisLibrary : null;

	return {
		answer: shown?.answer ?? null,
		answered: shown?.question ?? null,
		wasAnsweredWithCredits: shown?.hadCredits ?? null,
		isWaiting: isAskable && !isCurrent,
	};
}
