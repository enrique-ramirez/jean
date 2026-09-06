import { createAsk } from "@/shared/lib/ask";

export const {
	ask: askToJump,
	answered: jumpAnswered,
	useAsked: useJumpAsked,
} = createAsk();
