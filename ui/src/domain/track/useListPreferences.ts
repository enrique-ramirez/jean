import { useStoredState } from "@/shared/hooks/useStoredState";
import { DEFAULT_COLUMN_IDS } from "./columns";

export type Layout = "compact" | "album";

export function useListPreferences() {
	const [layout, setLayout] = useStoredState<Layout>("jean.layout", "compact");
	const [showHeat, setShowHeat] = useStoredState("jean.heat", true);
	const [showArtwork, setShowArtwork] = useStoredState("jean.artwork", true);
	const [enabledIds, setEnabledIds] = useStoredState<string[]>(
		"jean.columns",
		DEFAULT_COLUMN_IDS,
	);

	return {
		layout,
		setLayout,
		toggleLayout: () =>
			setLayout((current) => (current === "compact" ? "album" : "compact")),
		showHeat,
		toggleHeat: () => setShowHeat((current) => !current),
		showArtwork,
		toggleArtwork: () => setShowArtwork((current) => !current),
		enabledIds,
		toggleColumn: (id: string) =>
			setEnabledIds((current) =>
				current.includes(id)
					? current.filter((entry) => entry !== id)
					: [...current, id],
			),
	};
}

export type ListPreferences = ReturnType<typeof useListPreferences>;
