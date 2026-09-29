import { createAsk } from "@/shared/lib/ask";

interface Jump {
	animate: boolean;
}

const jump = createAsk<Jump>();

export const askToJump = (asked: Jump = { animate: false }) => jump.ask(asked);

export const { answered: jumpAnswered, useAsked: useJumpAsked } = jump;
