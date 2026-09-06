import { createAsk } from "@/shared/lib/ask";

export const {
	ask: askToShowQueue,
	answered: queueShown,
	useAsked: useShowQueueAsked,
} = createAsk();
