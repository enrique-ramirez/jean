import { useTranslate } from "@/shared/i18n/useTranslate";
import { type BindingId, KEYMAP } from "@/shared/keyboard/keymap";
import { KeyCap } from "@/shared/ui/KeyCap";
import styles from "./LyricKeys.module.css";

type LegendPhrase =
	| "lyrics.legendSelect"
	| "lyrics.legendSeek"
	| "lyrics.legendTenth"
	| "lyrics.legendSecond";

interface Keys {
	keys: BindingId[];
	label: LegendPhrase | "binding";
	needsPlayback?: true;
	needsSong?: true;
}

type Row = Keys | "separator";

const ROWS: Row[] = [
	{
		keys: ["lyricLinePrevious", "lyricLineNext"],
		label: "lyrics.legendSelect",
	},
	{ keys: ["lyricStamp"], label: "binding", needsSong: true },
	{ keys: ["playPause"], label: "binding", needsPlayback: true },
	{
		keys: ["lyricPlayFrom"],
		label: "binding",
		needsPlayback: true,
		needsSong: true,
	},
	{
		keys: ["seekBack", "seekForward"],
		label: "lyrics.legendSeek",
		needsPlayback: true,
		needsSong: true,
	},
	"separator",
	{
		keys: ["lyricEarlierTenth", "lyricLaterTenth"],
		label: "lyrics.legendTenth",
	},
	{
		keys: ["lyricEarlierSecond", "lyricLaterSecond"],
		label: "lyrics.legendSecond",
	},
	{ keys: ["lyricSelectAll"], label: "binding" },
	"separator",
	{ keys: ["lyricEditWords"], label: "binding" },
	{ keys: ["lyricLineBelow"], label: "binding" },
	{ keys: ["lyricRemoveLine"], label: "binding" },
	{ keys: ["lyricUndo"], label: "binding" },
	{ keys: ["lyricSave"], label: "binding" },
];

export function LyricKeys({
	canControlPlayback,
	isSongPlaying,
}: {
	canControlPlayback: boolean;
	isSongPlaying: boolean;
}) {
	const t = useTranslate();
	const rows = ROWS.filter(
		(row) => row === "separator" || canControlPlayback || !row.needsPlayback,
	);

	return (
		<aside className={styles.legend} aria-label={t("lyrics.keys")}>
			<h3 className={styles.heading}>{t("lyrics.keys")}</h3>
			<dl className={styles.list}>
				{rows.map((row, at) => {
					if (row === "separator")
						// biome-ignore lint/suspicious/noArrayIndexKey: a fixed list
						return <div key={at} className={styles.separator} />;
					const [first] = row.keys;
					const name = KEYMAP.find((binding) => binding.id === first)?.name;
					return (
						// biome-ignore lint/suspicious/noArrayIndexKey: a fixed list
						<div key={at} className={styles.row}>
							<dt>
								{row.keys.map((id) => (
									<KeyCap key={id} binding={id} />
								))}
							</dt>
							<dd data-off={row.needsSong && !isSongPlaying ? "" : undefined}>
								{row.label === "binding" ? name && t(name) : t(row.label)}
							</dd>
						</div>
					);
				})}
				<div className={styles.row}>
					<dt>
						<KeyCap label="Esc" />
					</dt>
					<dd>{t("lyrics.editorClose")}</dd>
				</div>
			</dl>
		</aside>
	);
}
