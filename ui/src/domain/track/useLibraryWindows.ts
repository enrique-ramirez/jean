import { useMemo } from "react";
import { libraryOrigin } from "@/shared/api/discovery";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { useStoreOr } from "@/shared/hooks/useStoreOr";
import {
	EMPTY_WINDOWED_STATE,
	type WindowedLibrary,
	type WindowedState,
	windowedLibraryOf,
} from "./libraryWindows";

export function useLibraryWindows(isNeeded: boolean): {
	windowed: WindowedLibrary | null;
	state: WindowedState;
} {
	const { discovery } = useFooJean();
	const origin = libraryOrigin(discovery);

	const windowed = useMemo(
		() => (isNeeded && origin ? windowedLibraryOf(origin) : null),
		[isNeeded, origin],
	);

	const state = useStoreOr(windowed, EMPTY_WINDOWED_STATE);

	return { windowed, state };
}
