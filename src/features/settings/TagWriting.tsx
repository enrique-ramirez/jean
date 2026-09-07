import { useState } from "react";
import type { TagWriterState } from "@/domain/track/tagWriter";
import { labelOfField, useTagWriting } from "@/domain/track/useTagWriter";
import {
	type PairFailure,
	pairWithAgent,
	SUPPORTED_API_VERSION,
} from "@/shared/api/fooJean";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { Trans } from "@/shared/i18n/Trans";
import type { Translate } from "@/shared/i18n/useTranslate";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { Button } from "@/shared/ui/Button";
import { HelpHint } from "@/shared/ui/HelpHint";
import { Input } from "@/shared/ui/Input";
import { Switch } from "@/shared/ui/Switch";
import styles from "./Settings.module.css";

const PANE = "File \u2192 Preferences \u2192 Tools \u2192 Jean";

// TODO: link the release once foo_jean is published.
const IS_PUBLISHED = false;

interface Explained {
	tone: "ok" | "warn" | "off";
	badge: string;
	summary: string;
	fix: string | null;
}

function explain(state: TagWriterState, t: Translate): Explained {
	switch (state.kind) {
		case "absent":
			return {
				tone: "off",
				badge: t("fooJean.badge.absent"),
				summary: t("fooJean.absent.summary"),
				fix: t(IS_PUBLISHED ? "fooJean.absent.install" : "fooJean.absent.soon"),
			};

		case "not-listening":
			return {
				tone: "warn",
				badge: t("fooJean.badge.disconnected"),
				summary: t("fooJean.notListening.summary", {
					port: state.record.port,
					error: state.error,
				}),
				fix: t(
					state.portInUse
						? "fooJean.notListening.portTaken"
						: "fooJean.notListening.check",
					{ pane: PANE },
				),
			};

		case "unreachable":
			return {
				tone: "warn",
				badge: t("fooJean.badge.disconnected"),
				summary: t("fooJean.unreachable.summary", { port: state.record.port }),
				fix: t("fooJean.unreachable.fix", { pane: PANE }),
			};

		case "impostor":
			return {
				tone: "warn",
				badge: t("fooJean.badge.disconnected"),
				summary: t("fooJean.impostor.summary", { port: state.record.port }),
				fix: t("fooJean.impostor.fix"),
			};

		case "unsupported":
			return {
				tone: "warn",
				badge: t("fooJean.badge.disconnected"),
				summary: t("fooJean.unsupported.summary", {
					theirs: state.apiVersion,
					ours: SUPPORTED_API_VERSION,
				}),
				fix: t("fooJean.unsupported.fix"),
			};

		case "no-token":
			return {
				tone: "warn",
				badge: t("fooJean.badge.needsToken"),
				summary: t("fooJean.noToken.summary", {
					version: state.status.version,
					port: state.record.port,
				}),
				fix: t("fooJean.noToken.fix", { pane: PANE }),
			};

		case "unauthorized":
			return {
				tone: "warn",
				badge: t("fooJean.badge.tokenRefused"),
				summary: t("fooJean.unauthorized.summary"),
				fix: t("fooJean.unauthorized.fix", { pane: PANE }),
			};

		case "ready":
			return state.capabilities.canWrite
				? {
						tone: "ok",
						badge: t("fooJean.badge.connected"),
						summary: t("fooJean.ready.summary", {
							version: state.status.version,
							port: state.record.port,
						}),
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

function explainStreaming(state: TagWriterState, t: Translate): string | null {
	if (state.kind !== "ready") return null;
	const { canStream, streamFormats } = state.capabilities;

	if (!canStream) return t("fooJean.stream.none", { pane: PANE });

	return t("fooJean.stream.formats", {
		formats: (streamFormats ?? []).join(" and "),
	});
}

function explainPairing(failure: PairFailure, t: Translate): string {
	switch (failure.reason) {
		case "not-open":
			return t("fooJean.pair.notOpen", { pane: PANE });
		case "not-local":
			return t("fooJean.pair.notLocal");
		case "busy":
			return t("fooJean.pair.busy");
		case "unsupported":
			return t("fooJean.pair.unsupported");
		case "unreachable":
			return t("fooJean.pair.unreachable", { message: failure.message });
	}
}

function PairButton({
	origin,
	onPaired,
}: {
	// Non-null only once `/api/status` has answered as foo_jean: the discovery record naming the port is forgeable, so a probed origin is what makes it safe to send the token to.
	origin: string;
	onPaired: (token: string) => void;
}) {
	const t = useTranslate();
	const [name, setName] = useState("");
	const [isPairing, setIsPairing] = useState(false);
	const [problem, setProblem] = useState<string | null>(null);

	const pair = async () => {
		setIsPairing(true);
		setProblem(null);

		const result = await pairWithAgent(origin, name.trim());
		setIsPairing(false);

		if (result.ok) onPaired(result.token);
		else setProblem(explainPairing(result, t));
	};

	return (
		<div className={styles.pairing}>
			<div className={styles.tokenRow}>
				<label className={styles.field} htmlFor="foo-jean-device-name">
					<span className={styles.label}>{t("label.name")}</span>
					<Input
						size="md"
						id="foo-jean-device-name"
						className={styles.input}
						value={name}
						spellCheck={false}
						autoComplete="off"
						placeholder={t("fooJean.pair.namePlaceholder")}
						maxLength={64}
						onChange={(event) => setName(event.target.value)}
					/>
				</label>

				<Button variant="primary" disabled={isPairing} onClick={pair}>
					{t(isPairing ? "fooJean.pair.pairing" : "fooJean.pair.pair")}
				</Button>
			</div>

			<p className={styles.fix}>
				{problem ?? t("fooJean.pair.how", { pane: PANE })}
			</p>
		</div>
	);
}

function TokenField({
	token,
	onSave,
	onCancel,
}: {
	token: string;
	onSave: (token: string) => void;
	onCancel?: () => void;
}) {
	const t = useTranslate();
	const [draft, setDraft] = useState(token);
	const [isVisible, setIsVisible] = useState(false);

	return (
		<form
			className={styles.tokenRow}
			onSubmit={(event) => {
				event.preventDefault();
				onSave(draft.trim());
			}}
		>
			<label className={styles.field} htmlFor="foo-jean-token">
				<span className={styles.label}>{t("fooJean.token.label")}</span>
				<Input
					size="md"
					id="foo-jean-token"
					className={styles.input}
					type={isVisible ? "text" : "password"}
					value={draft}
					spellCheck={false}
					autoComplete="off"
					placeholder={t("fooJean.token.placeholder")}
					onChange={(event) => setDraft(event.target.value)}
				/>
			</label>

			<Button
				aria-pressed={isVisible}
				onClick={() => setIsVisible((current) => !current)}
			>
				{t(isVisible ? "action.hide" : "action.show")}
			</Button>
			{onCancel ? (
				<Button onClick={onCancel}>{t("action.cancel")}</Button>
			) : null}
			<Button variant="primary" type="submit" disabled={draft.trim() === token}>
				{t("action.save")}
			</Button>
		</form>
	);
}

export function TagWriting() {
	const t = useTranslate();
	const { discovery, isChecking, token, setToken, recheck } = useFooJean();
	const { allowedFields, isFieldEnabled, setFieldEnabled } = useTagWriting();
	const { state, origin } = discovery;

	const explained = explain(state, t);
	const streaming = explainStreaming(state, t);
	const [isEditingToken, setIsEditingToken] = useState(false);

	const needsToken = state.kind === "no-token" || state.kind === "unauthorized";
	const wantsToken = needsToken || isEditingToken;
	const isWorking = state.kind === "ready" && !wantsToken;

	return (
		<section className={styles.panel} aria-labelledby="foo-jean">
			<div className={styles.panelHead}>
				<h2 className={styles.panelTitle} id="foo-jean">
					foo_jean
				</h2>
				<span className={styles.status} data-tone={explained.tone}>
					{explained.badge}
				</span>
			</div>

			<p className={styles.summary}>{explained.summary}</p>
			{explained.fix ? <p className={styles.fix}>{explained.fix}</p> : null}
			{streaming ? <p className={styles.fix}>{streaming}</p> : null}

			{wantsToken && origin ? (
				<PairButton origin={origin} onPaired={setToken} />
			) : null}

			{wantsToken ? (
				<TokenField
					token={token}
					onSave={(next) => {
						setToken(next);
						setIsEditingToken(false);
					}}
					onCancel={needsToken ? undefined : () => setIsEditingToken(false)}
				/>
			) : null}

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
					{isWorking ? (
						<button
							type="button"
							className={styles.quiet}
							onClick={() => setIsEditingToken(true)}
						>
							{t("fooJean.token.change")}
						</button>
					) : null}
				</div>
			) : null}

			{isWorking ? null : (
				<div className={styles.panelFoot}>
					<Button onClick={recheck} disabled={isChecking}>
						{t(isChecking ? "fooJean.checking" : "fooJean.checkAgain")}
					</Button>
				</div>
			)}
		</section>
	);
}
