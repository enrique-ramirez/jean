import { createAsk } from "@/shared/lib/ask";

const show = createAsk<true>();

export const askToShowQueue = () => show.ask(true);

export const { answered: queueShown, useAsked: useShowQueueAsked } = show;
