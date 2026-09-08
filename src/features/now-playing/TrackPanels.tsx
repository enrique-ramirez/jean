import { Maximize2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { PlayerSnapshot } from "@/shared/api/types";
import { useSwipe } from "@/shared/hooks/useSwipe";
import type { Phrase } from "@/shared/i18n/en";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { SCOPE } from "@/shared/keyboard/keymap";
import { mnemonicOf } from "@/shared/keyboard/mnemonic";
import { useKeymap } from "@/shared/keyboard/useKeymap";
import { Tabs } from "@/shared/ui/Tabs";
import { Artist } from "./Artist";
import { Details } from "./Details";
import { Lyrics } from "./Lyrics";
import type { Lyrics as ParsedLyrics } from "./lyricsFormat";
import styles from "./TrackPanels.module.css";
import { useLyricsRecheck } from "./useLyricsRecheck";
import { useNowPlayingTrack } from "./useNowPlayingTrack";
import { usePanelScroll } from "./usePanelScroll";

type Tab = "lyrics" | "details" | "artist";

type PanelPhrase = Extract<Phrase, `panel.${string}`>;

const TABS: { id: Tab; label: PanelPhrase; binding: string }[] = [
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
}: {
	variant: "gatefold" | "screen";
	lyrics: ParsedLyrics;
	snapshot: PlayerSnapshot | null | undefined;
	onSeek: (at: number) => void;
	trackKey: string;
	onExpand?: () => void;
	isExpanded?: boolean;
}) {
	const t = useTranslate();
	const { track } = useNowPlayingTrack();
	useLyricsRecheck();
	const [tab, setTab] = useState<Tab>("lyrics");
	const [direction, setDirection] = useState(0);
	const panelRef = useRef<HTMLDivElement | null>(null);

	const hasLyrics = lyrics.kind !== "none";

	usePanelScroll(panelRef, `${tab}:${trackKey}`, {
		enabled: !(tab === "lyrics" && lyrics.kind === "synced"),
	});

	// biome-ignore lint/correctness/useExhaustiveDependencies: the track settling fires this, hasLyrics is only read
	useEffect(() => {
		if (variant !== "gatefold" || !trackKey) return;
		setTab(hasLyrics ? "lyrics" : "details");
	}, [variant, trackKey]);

	const select = (next: Tab) => {
		const from = TABS.findIndex((entry) => entry.id === tab);
		const to = TABS.findIndex((entry) => entry.id === next);
		setDirection(to > from ? 1 : -1);
		setTab(next);
	};

	const step = (by: number) => {
		const at = TABS.findIndex((entry) => entry.id === tab);
		const next = TABS[at + by];
		if (next) select(next.id);
	};

	const swipe = useSwipe({ onLeft: () => step(1), onRight: () => step(-1) });

	useKeymap(
		SCOPE.nowPlaying,
		Object.fromEntries(
			TABS.map((entry) => [entry.binding, () => select(entry.id)]),
		),
	);

	const panel =
		tab === "lyrics" ? (
			isExpanded ? null : (
				<Lyrics lyrics={lyrics} snapshot={snapshot} onSeek={onSeek} />
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
				{onExpand && tab === "lyrics" && hasLyrics ? (
					<button
						type="button"
						className={styles.expand}
						aria-label={t("lyrics.fullScreen")}
						onClick={onExpand}
					>
						<Maximize2 size={16} strokeWidth={2} />
					</button>
				) : null}
			</Tabs>

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
