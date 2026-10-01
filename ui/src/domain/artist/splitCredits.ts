import { useStoredState } from "@/shared/hooks/useStoredState";

export const SPLIT_CREDITS_KEY = "jean.splitCredits";

export const useSplitCredits = () =>
	useStoredState<boolean>(SPLIT_CREDITS_KEY, true);
