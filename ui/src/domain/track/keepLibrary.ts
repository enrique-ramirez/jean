import { readStoredState, useStoredState } from "@/shared/hooks/useStoredState";
import { librarySearcher } from "./librarySearcher";

const KEEP_LIBRARY_KEY = "jean.keepLibrary";

export const useKeepLibrary = () =>
	useStoredState<boolean>(KEEP_LIBRARY_KEY, true);

export const readKeepLibrary = (): boolean =>
	readStoredState<boolean>(KEEP_LIBRARY_KEY, true);

export const forgetStoredLibrary = () => librarySearcher()?.forget();
