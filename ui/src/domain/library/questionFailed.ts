import type { AnswerFailure } from "@/domain/track/libraryAsker";

export interface QuestionFailed extends AnswerFailure {
	retry: () => void;
}

export const questionFailed = (
	failure: AnswerFailure | null,
	retry: () => void,
): QuestionFailed | null => failure && { reason: failure.reason, retry };
