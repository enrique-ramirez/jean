import type { TagWriterState } from "@/domain/track/tagWriter";
import { labelOfField, useTagWriting } from "@/domain/track/useTagWriter";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { Trans } from "@/shared/i18n/Trans";
import type { Translate } from "@/shared/i18n/useTranslate";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { Button } from "@/shared/ui/Button";
import { HelpHint } from "@/shared/ui/HelpHint";
import { Switch } from "@/shared/ui/Switch";
import styles from "./Settings.module.css";

const PANE = "File → Preferences → Tools → Jean → Permissions";

interface Explained {
	tone: "ok" | "warn" | "off";
	badge: string;
	summary: string | null;
	fix: string | null;
}

function explain(state: TagWriterState, t: Translate): Explained {
	switch (state.kind) {
		case "unreachable":
			return {
				tone: "warn",
				badge: t("fooJean.badge.disconnected"),
				summary: t("fooJean.unreachable.summary"),
				fix: t("fooJean.unreachable.fix"),
			};

		case "ready":
			return state.capabilities.canWrite
				? {
						tone: "ok",
						badge: t("fooJean.badge.connected"),
						summary: t("fooJean.ready.summary"),
						fix: null,
					}
				: {
						tone: "warn",
						badge: t("fooJean.badge.connected"),
						summary: t("fooJean.ready.noFields"),
						fix: t("fooJean.ready.addFields", { pane: PANE }),
					};
	}
}

function explainChecking(t: Translate): Explained {
	return {
		tone: "off",
		badge: t("fooJean.checking"),
		summary: null,
		fix: null,
	};
}

// Only the refusal. That it *can* stream is said by the control appearing in the status bar.
function explainStreaming(state: TagWriterState, t: Translate): string | null {
	if (state.kind !== "ready" || state.capabilities.canStream) return null;
	return t("fooJean.stream.none", { pane: PANE });
}

// Every transport and queue control already says why it does nothing; this is the one place that
// says where to change it. One paragraph, so the switch and the page it lives on read together.
function explainPlaybackControl(
	state: TagWriterState,
	t: Translate,
): string | null {
	if (state.kind !== "ready" || state.capabilities.canControlPlayback)
		return null;
	return t("fooJean.playback.none", { pane: PANE });
}

export function TagWriting() {
	const t = useTranslate();
	const { discovery, isDiscovered, isChecking, recheck } = useFooJean();
	const { allowedFields, isFieldEnabled, setFieldEnabled } = useTagWriting();
	const { state } = discovery;

	const explained = isDiscovered ? explain(state, t) : explainChecking(t);
	const streaming = explainStreaming(state, t);
	const playbackControl = explainPlaybackControl(state, t);

	return (
		<section className={styles.panel} aria-labelledby="foo-jean">
			<div className={styles.panelHead}>
				<h2 className={styles.panelTitle} id="foo-jean">
					{/* biome-ignore lint/style/noJsxLiterals: the component's name, which no language respells */}
					foo_jean
				</h2>
				<span className={styles.status} data-tone={explained.tone}>
					{explained.badge}
				</span>
			</div>

			{explained.summary ? (
				<p className={styles.summary}>{explained.summary}</p>
			) : null}
			{explained.fix ? <p className={styles.fix}>{explained.fix}</p> : null}
			{playbackControl ? <p className={styles.fix}>{playbackControl}</p> : null}
			{streaming ? <p className={styles.fix}>{streaming}</p> : null}

			{allowedFields.length > 0 ? (
				<div className={styles.fields}>
					<div className={styles.fieldsHead}>
						<span>{t("fooJean.fields.title")}</span>
						<HelpHint label={t("fooJean.fields.help")}>
							<p>
								<Trans
									phrase="fooJean.fields.allowlist"
									pane={<code>{PANE}</code>}
								/>
							</p>
							<p>{t("fooJean.fields.narrowOnly")}</p>
						</HelpHint>
					</div>
					{allowedFields.map((field) => (
						<Switch
							key={field}
							label={labelOfField(field, t)}
							checked={isFieldEnabled(field)}
							onChange={(enabled) => setFieldEnabled(field, enabled)}
						/>
					))}
				</div>
			) : null}

			{state.kind === "ready" ? null : (
				<div className={styles.panelFoot}>
					<Button onClick={recheck} disabled={isChecking}>
						{t(isChecking ? "fooJean.checking" : "fooJean.checkAgain")}
					</Button>
				</div>
			)}
		</section>
	);
}
