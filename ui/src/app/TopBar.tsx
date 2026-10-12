import {
	ChevronUp,
	Keyboard,
	Moon,
	PanelLeft,
	Search,
	Settings,
	Sun,
} from "lucide-react";
import type { Library } from "@/domain/library/useLibrary";
import type {
	LibrarySearch,
	Suggestion,
} from "@/domain/library/useLibrarySearch";
import { href, ROUTE } from "@/domain/track/routes";
import { LibrarySearchField } from "@/features/search/LibrarySearchField";
import { useIsCompactViewport } from "@/shared/hooks/useMediaQuery";
import { useTheme } from "@/shared/hooks/useTheme";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { Button } from "@/shared/ui/Button";
import styles from "./App.module.css";

interface TopBarProps {
	isSidebarShown: boolean;
	onToggleSidebar: () => void;
	place: string;
	isAtTop: boolean;
	onBackToTop: () => void;
	search: LibrarySearch;
	library: Library;
	isSearchOpen: boolean;
	onRevealSearch: () => void;
	onCloseSearch: () => void;
	onSubmitSearch: () => void;
	onSelectSuggestion: (suggestion: Suggestion) => void;
	onDismissSearch: () => void;
	isSettingsOpen: boolean;
	onOpenSettings: () => void;
	onOpenShortcuts: () => void;
}

export function TopBar({
	isSidebarShown,
	onToggleSidebar,
	place,
	isAtTop,
	onBackToTop,
	search,
	library,
	isSearchOpen,
	onRevealSearch,
	onCloseSearch,
	onSubmitSearch,
	onSelectSuggestion,
	onDismissSearch,
	isSettingsOpen,
	onOpenSettings,
	onOpenShortcuts,
}: TopBarProps) {
	const t = useTranslate();
	const { theme, toggle: toggleTheme } = useTheme();
	const isCompactViewport = useIsCompactViewport();
	const isCompactBarShut = isCompactViewport && !isSearchOpen;
	const isBrandShown = !isCompactViewport || isCompactBarShut;

	return (
		<header className={styles.topbar}>
			<Button
				variant="ghost"
				icon={PanelLeft}
				aria-label={isSidebarShown ? t("sidebar.hide") : t("sidebar.show")}
				aria-expanded={isSidebarShown}
				onClick={onToggleSidebar}
			/>

			{isBrandShown ? (
				<a className={styles.brand} href={href(ROUTE.home)}>
					{/* biome-ignore-start lint/style/noJsxLiterals: the product's name, which no language respells */}
					je<span>a</span>n
					{/* biome-ignore-end lint/style/noJsxLiterals: the product's name, which no language respells */}
				</a>
			) : null}

			{isCompactBarShut && place ? (
				<button
					type="button"
					className={styles.place}
					data-at-top={isAtTop || undefined}
					onClick={onBackToTop}
					// Omitted at the top: an unlabelled control's accessible name falls back to its
					// visible text, and there is nowhere left for the label to promise going.
					aria-label={isAtTop ? undefined : t("view.backToTop", { place })}
				>
					<span className={styles.placeName}>{place}</span>
					{isAtTop ? null : (
						<ChevronUp size={14} strokeWidth={2.5} aria-hidden="true" />
					)}
				</button>
			) : null}

			{isCompactBarShut ? null : (
				<LibrarySearchField
					search={search}
					library={library}
					onChange={search.type}
					onSubmit={onSubmitSearch}
					onSelect={onSelectSuggestion}
					onLeave={() => {
						if (!search.hasDraft) onCloseSearch();
					}}
					onDismiss={onDismissSearch}
				/>
			)}

			<div className={styles.actions}>
				{isCompactBarShut ? (
					<Button
						variant="ghost"
						icon={Search}
						aria-label={t("search.yourLibrary")}
						aria-expanded={false}
						onClick={onRevealSearch}
					/>
				) : null}
				<Button
					variant="ghost"
					className={styles.shortcuts}
					icon={Keyboard}
					aria-label={t("shortcuts.title")}
					onClick={onOpenShortcuts}
				/>
				<Button
					variant="ghost"
					icon={Settings}
					aria-label={t("settings.title")}
					aria-expanded={isSettingsOpen}
					onClick={onOpenSettings}
				/>
				{isCompactViewport ? null : (
					<Button
						variant="ghost"
						icon={theme === "dark" ? Sun : Moon}
						aria-label={
							theme === "dark" ? t("theme.toLight") : t("theme.toDark")
						}
						onClick={toggleTheme}
					/>
				)}
			</div>
		</header>
	);
}
