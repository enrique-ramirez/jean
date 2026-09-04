import { createAsk } from "@/shared/lib/ask";

// Somebody outside a list asked to be taken to the playing track: the now-playing screen's "Playing from" line, which
// opens the set's route and then wants the row. Answered by whichever list the route lands on, once it holds that row.
export const {
	ask: askToJump,
	answered: jumpAnswered,
	useAsked: useJumpAsked,
} = createAsk();
