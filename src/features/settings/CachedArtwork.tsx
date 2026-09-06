import { useCallback, useEffect, useState } from "react";
import { plural } from "@/shared/lib/text";
import {
	artworkHeld,
	canCacheArtwork,
	forgetArtwork,
} from "@/shared/ui/artworkCache";
import { Button } from "@/shared/ui/Button";
import { HelpHint } from "@/shared/ui/HelpHint";
import styles from "./Settings.module.css";

const asMB = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function CachedArtwork() {
	const [held, setHeld] = useState<{
		count: number;
		bytes: number;
		budget: number;
	} | null>(null);
	const [isClearing, setIsClearing] = useState(false);

	const read = useCallback(() => {
		artworkHeld().then(setHeld);
	}, []);

	useEffect(read, [read]);

	if (!canCacheArtwork()) return null;

	const clear = async () => {
		setIsClearing(true);
		await forgetArtwork();
		read();
		setIsClearing(false);
	};

	return (
		<section className={styles.panel}>
			<div className={styles.panelHead}>
				<h2 className={styles.panelTitle}>Cached artwork</h2>
				<HelpHint label="About cached artwork">
					<p>
						The player asks browsers not to keep artwork for more than a few
						seconds, so every visit re-downloads every cover. Jean keeps its own
						copy instead — the covers you have already seen cost nothing to see
						again.
					</p>
					<p>
						Covers are kept until the {asMB(held?.budget ?? 0)} here is full,
						and then the oldest go first. A track with <strong>no</strong>{" "}
						artwork is never kept, so adding one shows up straight away.
					</p>
					<p>
						Clear this if you have <strong>replaced</strong> artwork on a track
						and Jean is still showing the old picture.
					</p>
				</HelpHint>
			</div>

			<div className={styles.panelActions}>
				<p className={styles.note}>
					{held === null
						? "Counting…"
						: held.count === 0
							? "Nothing kept yet."
							: `${plural(held.count, "cover")}, ${asMB(held.bytes)} of ${asMB(held.budget)}.`}
				</p>

				<Button
					variant="danger"
					onClick={clear}
					disabled={isClearing || held === null || held.count === 0}
				>
					{isClearing ? "Clearing…" : "Clear cached artwork"}
				</Button>
			</div>
		</section>
	);
}
