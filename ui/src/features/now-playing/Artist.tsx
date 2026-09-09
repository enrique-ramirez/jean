import { ExternalLink } from "lucide-react";
import { Trans } from "@/shared/i18n/Trans";
import { useTranslate } from "@/shared/i18n/useTranslate";
import styles from "./Artist.module.css";
import { useArtistInfo, useArtistInfoEnabled } from "./artistInfo";

// The subject is a parameter rather than the playing track, so the artist page and the now-playing
// screen ask about whoever they are each showing through one panel.
export function Artist({ name }: { name: string | null | undefined }) {
	const t = useTranslate();
	const [isEnabled] = useArtistInfoEnabled();
	const { data, isPending, isError } = useArtistInfo(name);

	if (!isEnabled)
		return (
			<div className={styles.notice}>
				<p>{t("artistInfo.off")}</p>
				<p className={styles.hint}>
					<Trans
						phrase="artistInfo.offWhy"
						setting={<b>{t("artistInfo.settingPath")}</b>}
					/>
				</p>
			</div>
		);

	if (isPending)
		return (
			<p className={styles.notice}>
				{name
					? t("artistInfo.lookingUpNamed", { name })
					: t("artistInfo.lookingUp")}
			</p>
		);

	if (isError || !data)
		return (
			<div className={styles.notice}>
				<p>
					{name
						? t("artistInfo.notFoundNamed", { name })
						: t("artistInfo.notFound")}
				</p>
				<p className={styles.hint}>{t("artistInfo.notFoundWhy")}</p>
			</div>
		);

	const facts = [data.kind, data.area, data.years].filter(Boolean);

	return (
		<div className={styles.artist}>
			<h2 className={styles.name}>{data.name}</h2>
			{facts.length > 0 ? (
				<p className={styles.facts}>{facts.join(" · ")}</p>
			) : null}

			{data.summary ? <p className={styles.summary}>{data.summary}</p> : null}

			<a
				className={styles.source}
				href={data.sourceUrl}
				target="_blank"
				rel="noreferrer noopener"
			>
				{t("artistInfo.readMore", { source: data.sourceName })}
				<ExternalLink size={14} strokeWidth={2} aria-hidden="true" />
			</a>
		</div>
	);
}
