import { Play, Trash2 } from "lucide-react";
import type { ReactNode } from "react";

import { useSpoken, useTranslate } from "@/shared/i18n/useTranslate";
import { Button } from "@/shared/ui/Button";
import styles from "./LyricEditor.module.css";
import { clockOf } from "./lyricDraft";

export function LyricLineTools({
	isPhone,
	title,
	isSongPlaying,
	playFromAt,
	stepper,
	lineBelowButton,
	onPlayFrom,
	onRemove,
}: {
	isPhone: boolean;
	title: string;
	isSongPlaying: boolean;
	playFromAt: number | null;
	stepper: ReactNode;
	lineBelowButton: ReactNode;
	onPlayFrom: () => void;
	onRemove: () => void;
}) {
	const t = useTranslate();
	const say = useSpoken();

	return (
		<div className={styles.tools} data-tools="">
			{stepper}
			{playFromAt === null ? null : (
				<Button
					icon={Play}
					aria-disabled={isSongPlaying ? undefined : "true"}
					aria-label={
						isSongPlaying
							? say("lyrics.playFrom", { time: clockOf(playFromAt) })
							: say("lyrics.inertName", {
									control: say("lyrics.playFrom", {
										time: clockOf(playFromAt),
									}),
									title,
								})
					}
					onClick={isSongPlaying ? onPlayFrom : undefined}
				>
					{t(isPhone ? "lyrics.playFromShort" : "lyrics.playFrom", {
						time: clockOf(playFromAt),
					})}
				</Button>
			)}
			<span className={styles.spacer} />
			{lineBelowButton}
			<Button
				variant="ghost"
				icon={Trash2}
				className={styles.remove}
				aria-label={isPhone ? t("lyrics.removeLine") : undefined}
				onClick={onRemove}
			>
				{isPhone ? null : t("lyrics.removeLine")}
			</Button>
		</div>
	);
}
