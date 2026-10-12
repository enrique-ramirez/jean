import { useEffect } from "react";

import { useMediaQuery } from "./useMediaQuery";
import { useStoredState } from "./useStoredState";

export type Theme = "light" | "dark";

const FOLLOW_SYSTEM = null;

export const THEME_KEY = "jean.theme";

export function useTheme() {
	const [chosen, choose] = useStoredState<Theme | null>(
		THEME_KEY,
		FOLLOW_SYSTEM,
	);
	const prefersLight = useMediaQuery("(prefers-color-scheme: light)");
	const theme = chosen ?? (prefersLight ? "light" : "dark");

	useEffect(() => {
		document.documentElement.dataset.theme = theme;
	}, [theme]);

	const toggle = () => choose(theme === "dark" ? "light" : "dark");

	return { theme, chosen, choose, toggle };
}
