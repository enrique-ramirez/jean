import { formatForDisplay } from "@tanstack/react-hotkeys";
import { Maximize2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { PlayerSnapshot } from "@/shared/api/types";
import { useSwipe } from "@/shared/hooks/useSwipe";
import { KEYMAP, SCOPE } from "@/shared/keyboard/keymap";
import { useKeymap } from "@/shared/keyboard/useKeymap";
import { Artist } from "./Artist";
import { Details } from "./Details";
import { Lyrics } from "./Lyrics";
import type { Lyrics as ParsedLyrics } from "./lyricsFormat";
import styles from "./TrackPanels.module.css";
import { usePanelScroll } from "./usePanelScroll";

type Tab = "lyrics" | "details" | "artist";

const TABS: { id: Tab; label: string; binding: string }[] = [
	{ id: "lyrics", label: "Lyrics", binding: "showLyrics" },
	{ id: "details", label: "Details", binding: "showDetails" },
	{ id: "artist", label: "Artist", binding: "showArtist" },
];

const mnemonicOf = (label: string, bindingId: string) => {
	const key = KEYMAP.find((binding) => binding.id === bindingId)?.keys[0];
	const shown = key === undefined ? "" : formatForDisplay(key);
	return shown && label.toUpperCase().startsWith(shown.toUpperCase())
		? shown.length
		: 0;
};

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
	const [tab, setTab] = useState<Tab>("lyrics");
	const [direction, setDirection] = useState(0);
	const panelRef = useRef<HTMLDivElement | null>(null);

	const hasLyrics = lyrics.kind !== "none";

	// Restoring an offset writes `scrollTop`, which the synced-lyric follow reads as a manual scroll and gives up on.
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
			<Artist />
		);

	return (
		<div className={styles.panel} data-variant={variant} {...swipe}>
			<nav className={styles.tabs} aria-label="Track views">
				{TABS.map((entry) => {
					const marked = mnemonicOf(entry.label, entry.binding);
					return (
						<button
							key={entry.id}
							type="button"
							className={styles.tab}
							aria-current={tab === entry.id}
							data-active={tab === entry.id}
							onClick={() => select(entry.id)}
						>
							{marked ? (
								<span className={styles.key}>
									{entry.label.slice(0, marked)}
								</span>
							) : null}
							{entry.label.slice(marked)}
						</button>
					);
				})}

				{onExpand && tab === "lyrics" && hasLyrics ? (
					<button
						type="button"
						className={styles.expand}
						aria-label="Full-screen lyrics"
						onClick={onExpand}
					>
						<Maximize2 size={16} strokeWidth={2} />
					</button>
				) : null}
			</nav>

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
