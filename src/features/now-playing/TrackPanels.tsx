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

// `binding` is the keymap id that opens the tab. The strip underlines the key that same id registers, read off KEYMAP rather than guessed from the label, so a mismatch between the two shows up as a broken word instead of a silent lie.
const TABS: { id: Tab; label: string; binding: string }[] = [
	{ id: "lyrics", label: "Lyrics", binding: "showLyrics" },
	{ id: "details", label: "Details", binding: "showDetails" },
	{ id: "artist", label: "Artist", binding: "showArtist" },
];

// How many leading characters of the label are the key that opens it, read off the binding rather than assumed. Zero where the two have parted company: a missing underline is a hint that stopped being offered, where a key drawn over the label is a word spelled wrong.
const mnemonicOf = (label: string, bindingId: string) => {
	const key = KEYMAP.find((binding) => binding.id === bindingId)?.keys[0];
	const shown = key === undefined ? "" : formatForDisplay(key);
	return shown && label.toUpperCase().startsWith(shown.toUpperCase())
		? shown.length
		: 0;
};

// Everything that is *about* the track: the three panels and the strip that names them, one component in two hosts.
export function TrackPanels({
	variant,
	lyrics,
	snapshot,
	onSeek,
	trackKey,
	onExpand,
	isExpanded = false,
}: {
	/** Which host: the gatefold's right leaf, or the layer a phone opens from Lyrics. The only real difference is who scrolls. */
	variant: "gatefold" | "screen";
	lyrics: ParsedLyrics;
	snapshot: PlayerSnapshot | null | undefined;
	onSeek: (at: number) => void;
	/** What a remembered offset is keyed on beside the tab: a new song's lyrics are not the old song's, scrolled down. */
	trackKey: string;
	/** Full-screen lyrics, which only the gatefold offers — the phone's layer is already full screen. */
	onExpand?: () => void;
	/** Whether that full-screen copy is up. Two mounted `Lyrics` are two animation-frame loops, and the hidden one still drives this scroller. */
	isExpanded?: boolean;
}) {
	const [tab, setTab] = useState<Tab>("lyrics");
	// Which way the panel slides in from; 0 for the tab that lands with the host itself, not stepped to.
	const [direction, setDirection] = useState(0);
	const panelRef = useRef<HTMLDivElement | null>(null);

	const hasLyrics = lyrics.kind !== "none";

	// Restoring an offset writes `scrollTop`, which the synced-lyric follow reads as a manual scroll and stops following.
	usePanelScroll(panelRef, `${tab}:${trackKey}`, {
		enabled: !(tab === "lyrics" && lyrics.kind === "synced"),
	});

	// The gatefold has no way in but the strip, so it lands on whichever panel has something to say. The layer was opened by pressing Lyrics and lands on lyrics, tag or no tag.
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

	// Live wherever the strip is: the gatefold's leaf, or the layer a phone opens.
	useKeymap(
		SCOPE.nowPlaying,
		Object.fromEntries(
			TABS.map((entry) => [entry.binding, () => select(entry.id)]),
		),
	);

	// Nothing while the full-screen copy is up. See `isExpanded`.
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

				{/* Positioned over the panel but a child of the strip: `.panelBody` carries an edge fade that would dim it on scroll. */}
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

			{/* Keyed on the tab so the entrance animation replays on every change. */}
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
