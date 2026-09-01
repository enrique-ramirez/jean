import { useEffect } from "react";

import { useStoredState } from "@/shared/hooks/useStoredState";

const systemPreference = (): "light" | "dark" =>
	typeof window !== "undefined" &&
	window.matchMedia("(prefers-color-scheme: light)").matches
		? "light"
		: "dark";

export function useTheme() {
	const [theme, setTheme] = useStoredState<"light" | "dark">(
		"jean.theme",
		systemPreference,
	);

	useEffect(() => {
		document.documentElement.dataset.theme = theme;
	}, [theme]);

	const toggle = () =>
		setTheme((current) => (current === "dark" ? "light" : "dark"));

	return { theme, toggle };
}
