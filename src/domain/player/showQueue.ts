import { createAsk } from "@/shared/lib/ask";

// Queueing a track opens the queue, and that is the whole of what it says about it: the panel is the confirmation, so
// there is nothing to toast about and the undo is the row you can now see and remove. Raised where the write is made
// and answered by the shell, which is what knows whether the panel is a drawer or a dock at this width.
export const {
	ask: askToShowQueue,
	answered: queueShown,
	useAsked: useShowQueueAsked,
} = createAsk();
