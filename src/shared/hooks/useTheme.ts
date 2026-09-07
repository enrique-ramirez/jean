import { useEffect } from "react";

import { useMediaQuery } from "./useMediaQuery";
import { useStoredState } from "./useStoredState";

export type Theme = "light" | "dark";

const FOLLOW_SYSTEM = null;

export function useTheme() {
	const [chosen, choose] = useStoredState<Theme | null>(
		"jean.theme",
		FOLLOW_SYSTEM,
	);
	const prefersLight = useMediaQuery("(prefers-color-scheme: light)");
	const theme = chosen ?? (prefersLight ? "light" : "dark");

	useEffect(() => {
		document.documentElement.dataset.theme = theme;
	}, [theme]);

	// Always an explicit theme: clearing chosen back to null would do nothing when the system already
	// matches it.
	const toggle = () => choose(theme === "dark" ? "light" : "dark");

	return { theme, chosen, choose, toggle };
}
