import { useQueryClient } from "@tanstack/react-query";
import { Maximize2 } from "lucide-react";
import { useRef, useState } from "react";
import { Artist } from "@/domain/artist/Artist";
import { PANEL_TABS, type PanelTab } from "@/domain/track/routes";
import type { PlayerSnapshot } from "@/shared/api/types";
import { useSwipe } from "@/shared/hooks/useSwipe";
import type { Phrase } from "@/shared/i18n/en";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { type BindingId, SCOPE } from "@/shared/keyboard/keymap";
import { mnemonicOf } from "@/shared/keyboard/mnemonic";
import { useKeymap } from "@/shared/keyboard/useKeymap";
import { Tabs } from "@/shared/ui/Tabs";
import { Details } from "./Details";
import type { EditorOpening } from "./LyricEditor";
import { LyricSearch, type SearchMemory } from "./LyricSearch";
import { LyricActions, Lyrics, type PanelVariant } from "./Lyrics";
import { draftFromText } from "./lyricDraft";
import type { Lyrics as ParsedLyrics } from "./lyricsFormat";
import styles from "./TrackPanels.module.css";
import { useLyricsRecheck } from "./useLyricsRecheck";
import { type LyricTarget, useNowPlayingLyric } from "./useNowPlayingLyric";
import { cachedLyrics, useNowPlayingTrack } from "./useNowPlayingTrack";
import { usePanelScroll } from "./usePanelScroll";

type PanelPhrase = Extract<Phrase, `panel.${string}`>;

const TABS: { id: PanelTab; label: PanelPhrase; binding: BindingId }[] = [
	{ id: "lyrics", label: "panel.lyrics", binding: "showLyrics" },
	{ id: "details", label: "panel.details", binding: "showDetails" },
	{ id: "artist", label: "panel.artist", binding: "showArtist" },
];

export function TrackPanels({
	variant,
	lyrics,
	snapshot,
	onSeek,
	trackKey,
	onExpand,
	isExpanded = false,
	tab: chosen,
	onSelectTab,
	onEdit,
}: {
	variant: PanelVariant;
	lyrics: ParsedLyrics;
	snapshot: PlayerSnapshot | null | undefined;
	onSeek: (at: number) => void;
	trackKey: string;
	onExpand?: () => void;
	isExpanded?: boolean;
	tab: PanelTab | null;
	onSelectTab: (tab: PanelTab) => void;
	onEdit: (opening: EditorOpening) => void;
}) {
	const t = useTranslate();
	const { track } = useNowPlayingTrack();
	const queryClient = useQueryClient();
	const { canSave, target } = useNowPlayingLyric();
	const [search, setSearch] = useState<LyricTarget | null>(null);
	useLyricsRecheck();
	const tab = chosen ?? PANEL_TABS[0];
	const [direction, setDirection] = useState(0);
	const panelRef = useRef<HTMLDivElement | null>(null);

	const hasLyrics = lyrics.kind !== "none";

	usePanelScroll(panelRef, `${tab}:${trackKey}`, {
		enabled: !(tab === "lyrics" && lyrics.kind === "synced"),
	});

	const select = (next: PanelTab) => {
		const from = TABS.findIndex((entry) => entry.id === tab);
		const to = TABS.findIndex((entry) => entry.id === next);
		setDirection(to > from ? 1 : -1);
		onSelectTab(next);
	};

	const step = (by: number) => {
		const at = TABS.findIndex((entry) => entry.id === tab);
		const next = TABS[at + by];
		if (next) select(next.id);
	};

	const swipe = useSwipe({ onLeft: () => step(1), onRight: () => step(-1) });

	const searched =
		search !== null && tab === "lyrics" && !isExpanded ? search : null;
	const isSearching = searched !== null;
	const searchMemory = useRef<SearchMemory | null>(null);
	const openSearch = () => {
		searchMemory.current = null;
		if (target) setSearch(target);
	};
	const closeSearch = () => {
		searchMemory.current = null;
		setSearch(null);
	};

	const heldBy = (of: LyricTarget) =>
		cachedLyrics(queryClient, of.path, of.subsong);
	const editPanelLyric = target
		? () => {
				const held = heldBy(target);
				onEdit({ target, draft: draftFromText(held), held });
			}
		: undefined;

	const hasActions =
		canSave && tab === "lyrics" && hasLyrics && !isExpanded && !isSearching;
	const actions = hasActions ? (
		<LyricActions
			variant={variant === "gatefold" ? "ghost" : "default"}
			isIconOnly={variant === "screen"}
			onSearch={openSearch}
			onEdit={editPanelLyric}
		/>
	) : null;

	const canExpand =
		Boolean(onExpand) && tab === "lyrics" && hasLyrics && !isSearching;

	useKeymap(
		SCOPE.nowPlaying,
		Object.fromEntries(
			TABS.map((entry) => [entry.binding, () => select(entry.id)]),
		),
	);

	useKeymap(
		SCOPE.nowPlaying,
		{ fullScreen: () => onExpand?.() },
		{ enabled: canExpand },
	);

	const panel =
		tab === "lyrics" ? (
			isExpanded ? null : searched ? (
				<LyricSearch
					target={searched}
					variant={variant}
					snapshot={snapshot}
					onBack={closeSearch}
					onOpenEditor={(draft) =>
						onEdit({
							target: searched,
							draft,
							held: heldBy(searched),
							onSaved: closeSearch,
						})
					}
					memory={searchMemory}
					className={styles.search}
				/>
			) : (
				<Lyrics
					lyrics={lyrics}
					snapshot={snapshot}
					onSeek={onSeek}
					onSearch={openSearch}
					onEdit={editPanelLyric}
					variant={variant}
				/>
			)
		) : tab === "details" ? (
			<Details />
		) : (
			<Artist name={track?.artist} />
		);

	return (
		<div className={styles.panel} data-variant={variant} {...swipe}>
			<Tabs
				className={styles.tabs}
				value={tab}
				label={t("panel.trackViews")}
				options={TABS.map((entry) => ({
					value: entry.id,
					label: t(entry.label),
					mnemonic: mnemonicOf(t(entry.label), entry.binding),
				}))}
				onChange={select}
			>
				{canExpand || (variant === "gatefold" && actions) ? (
					<div className={styles.tabActions}>
						{variant === "gatefold" ? actions : null}
						{canExpand ? (
							<button
								type="button"
								className={styles.expand}
								aria-label={t("lyrics.fullScreen")}
								onClick={onExpand}
							>
								<Maximize2 size={16} strokeWidth={2} />
							</button>
						) : null}
					</div>
				) : null}
			</Tabs>

			{variant === "screen" && actions ? (
				<div className={styles.actionRow}>{actions}</div>
			) : null}

			<div
				key={tab}
				ref={panelRef}
				className={styles.panelBody}
				data-tab={tab}
				data-direction={direction}
			>
				{panel}
			</div>
		</div>
	);
}
