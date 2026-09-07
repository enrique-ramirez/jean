import { useCallback, useEffect, useState } from "react";
import { Trans } from "@/shared/i18n/Trans";
import { useTranslate } from "@/shared/i18n/useTranslate";
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
	const t = useTranslate();
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
				<h2 className={styles.panelTitle}>{t("artwork.title")}</h2>
				<HelpHint label={t("artwork.help")}>
					<p>{t("artwork.why")}</p>
					<p>
						<Trans
							phrase="artwork.budget"
							budget={asMB(held?.budget ?? 0)}
							no={<strong>{t("artwork.no")}</strong>}
						/>
					</p>
					<p>
						<Trans
							phrase="artwork.clearWhen"
							replaced={<strong>{t("artwork.replaced")}</strong>}
						/>
					</p>
				</HelpHint>
			</div>

			<div className={styles.panelActions}>
				<p className={styles.note}>
					{held === null
						? t("artwork.counting")
						: held.count === 0
							? t("artwork.nothingKept")
							: t("artwork.held", {
									covers: t("artwork.covers", { count: held.count }),
									used: asMB(held.bytes),
									budget: asMB(held.budget),
								})}
				</p>

				<Button
					variant="danger"
					onClick={clear}
					disabled={isClearing || held === null || held.count === 0}
				>
					{t(isClearing ? "artwork.clearing" : "artwork.clear")}
				</Button>
			</div>
		</section>
	);
}
