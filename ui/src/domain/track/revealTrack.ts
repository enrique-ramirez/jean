import { createAsk } from "@/shared/lib/ask";

// A ref, not a position: the list that answers this is not the one that asked, and only the ref
// means the same thing in both. It stands until a list holding that row arrives -- a route opens
// before its rows do, and a browser that cannot answer yet must not swallow it.
export const {
	ask: askToReveal,
	answered: revealed,
	useAsked: useRevealAsked,
} = createAsk<number>();
