import { useState } from "react";
import type { TagWriterState } from "@/domain/track/tagWriter";
import { labelOfField, useTagWriting } from "@/domain/track/useTagWriter";
import {
	type PairFailure,
	pairWithAgent,
	SUPPORTED_API_VERSION,
} from "@/shared/api/fooJean";
import { useFooJean } from "@/shared/hooks/useFooJean";
import { Button } from "@/shared/ui/Button";
import { HelpHint } from "@/shared/ui/HelpHint";
import { Switch } from "@/shared/ui/Switch";
import styles from "./Settings.module.css";

// The pane, not the file. Both exist, and the file is what the pane writes -- but
// Jean is being read on a phone, by somebody who has to walk to the player
// either way, and a path is a worse instruction than a menu.
const PANE = "File \u2192 Preferences \u2192 Tools \u2192 Jean";

// TODO: link the release once foo_jean is published.
const IS_PUBLISHED = false;

interface Explained {
	// Three tones, but the badge names the state rather than collapsing to
	// on/off: "Not connected" over a component that is answering perfectly and
	// only wants a credential sends somebody to debug their network.
	tone: "ok" | "warn" | "off";
	badge: string;
	summary: string;
	// What to do about it, or null when there is nothing to do and saying so is
	// the point.
	fix: string | null;
}

// **Nothing here goes quiet.** Five of these are a component that is installed
// and running, and in three the user has done everything right.
function explain(state: TagWriterState): Explained {
	switch (state.kind) {
		case "absent":
			return {
				tone: "off",
				badge: "Not installed",
				summary:
					"foo_jean is the companion component that writes tags back to your library. Without it Jean reads everything and changes nothing, which is still a complete app — just not one that can set a rating.",
				fix: IS_PUBLISHED
					? "Install it into foobar2000 and restart the player."
					: "It is not published yet, so there is nothing to do here.",
			};

		case "not-listening":
			return {
				tone: "warn",
				badge: "Not connected",
				summary: `foo_jean is installed but could not start on port ${state.record.port}. ${state.error}`,
				fix: state.portInUse
					? `Another program already has that port. Change the port under ${PANE} in foobar2000, then restart it.`
					: `Check the settings under ${PANE} in foobar2000, then restart it.`,
			};

		case "unreachable":
			return {
				tone: "warn",
				badge: "Not connected",
				summary: `foo_jean says it is listening on port ${state.record.port}, but this device cannot reach it.`,
				fix: `Something on the player is refusing the connection: usually the address under ${PANE} restricted to one machine, otherwise a firewall. 0.0.0.0 accepts connections from your network, which is both the default and what beefweb itself does.`,
			};

		case "impostor":
			return {
				tone: "warn",
				badge: "Not connected",
				summary: `Something is listening on port ${state.record.port} and it is not foo_jean. Your token has not been sent to it.`,
				fix: "That record is writable by anything that can reach the player, so it may simply be stale. Restart foobar2000 to have foo_jean publish it again.",
			};

		case "unsupported":
			return {
				tone: "warn",
				badge: "Not connected",
				summary: `foo_jean is speaking version ${state.apiVersion} of its API and this copy of Jean understands version ${SUPPORTED_API_VERSION}.`,
				fix: "Update whichever of the two is older.",
			};

		case "no-token":
			return {
				tone: "warn",
				badge: "Needs token",
				summary: `foo_jean ${state.status.version} is running on port ${state.record.port}. It needs the token before it will accept anything.`,
				fix: `On the player, open ${PANE} and copy the token. It is deliberately not published with the rest of the component's details, because anything that can reach the player can read those.`,
			};

		case "unauthorized":
			return {
				tone: "warn",
				badge: "Token refused",
				summary: "foo_jean refused that token.",
				fix: `Check it against the token under ${PANE}. Regenerating there locks out every client holding the old one.`,
			};

		case "ready":
			return state.capabilities.canWrite
				? {
						tone: "ok",
						badge: "Connected",
						summary: `Connected to foo_jean ${state.status.version} on port ${state.record.port}.`,
						fix: null,
					}
				: {
						tone: "warn",
						badge: "Connected",
						summary:
							"Connected, and this install permits no fields to be written.",
						fix: `Add the fields you want under ${PANE}, in "Fields they may write", then restart foobar2000.`,
					};
	}
}

// Streaming is the component's other half and fails for its own reasons, so it
// gets its own line rather than being folded into the badge above: an install
// that writes tags perfectly and has no encoder is connected, working, and
// missing one feature, which one word cannot say.
function explainStreaming(state: TagWriterState): string | null {
	if (state.kind !== "ready") return null;
	const { canStream, streamFormats } = state.capabilities;

	// Absent means false, which is what an older component looks like from here.
	if (!canStream)
		return `This copy of foo_jean does not stream audio, so Jean cannot play it on this device. Either it is older than the feature, or no encoder started -- check ${PANE}.`;

	return `Streaming ${(streamFormats ?? []).join(" and ")}. The control is beside the volume in the status bar.`;
}

// What went wrong, in the user's terms. The common one by far is a window nobody has
// opened yet, and that is a button to press rather than an error to debug -- so it names
// the menu path, because somebody reading this on a television is not going to find it
// by hunting.
function explainPairing(failure: PairFailure): string {
	switch (failure.reason) {
		case "not-open":
			return `No pairing window is open. On the player, go to ${PANE} and press “Pair a device”, then press Pair here within two minutes.`;
		case "not-local":
			return "This device is not on the player’s own network, so it cannot pair. Paste the token instead.";
		case "busy":
			return "Too many pairing attempts just now. Wait a few seconds and try again.";
		case "unsupported":
			return "This copy of foo_jean is too old to pair. Paste the token instead, or update the component.";
		case "unreachable":
			return `Could not reach foo_jean. ${failure.message}`;
	}
}

// **The reason this exists**: the token is 64 hex characters, and on a television remote
// that is not a thing anyone will do. One press here and one on the player replaces it.
//
// The paste path stays exactly where it was, underneath. Pairing makes the token cheap
// to get; it does not become the only way to get one, and an install that has turned the
// window off still has a way in.
function PairButton({
	origin,
	onPaired,
}: {
	// Non-null only once `/api/status` has answered as foo_jean at a version this build
	// understands -- which is the same rule as sending the token, and for the same
	// reason: the record naming this port is forgeable.
	origin: string;
	onPaired: (token: string) => void;
}) {
	const [name, setName] = useState("");
	const [isPairing, setIsPairing] = useState(false);
	const [problem, setProblem] = useState<string | null>(null);

	const pair = async () => {
		setIsPairing(true);
		setProblem(null);

		const result = await pairWithAgent(origin, name.trim());
		setIsPairing(false);

		if (result.ok) onPaired(result.token);
		else setProblem(explainPairing(result));
	};

	return (
		<div className={styles.pairing}>
			<div className={styles.tokenRow}>
				<label className={styles.field}>
					<span className={styles.label}>Name</span>
					<input
						className={styles.input}
						value={name}
						spellCheck={false}
						autoComplete="off"
						// Optional, and it has to stay optional: asking for a name before
						// pairing would put back the typing this removes.
						placeholder="This device (optional)"
						maxLength={64}
						onChange={(event) => setName(event.target.value)}
					/>
				</label>

				<Button variant="primary" disabled={isPairing} onClick={pair}>
					{isPairing ? "Pairing…" : "Pair"}
				</Button>
			</div>

			<p className={styles.fix}>
				{problem ??
					`Press “Pair a device” under ${PANE} on the player, then press Pair here. No typing on this device.`}
			</p>
		</div>
	);
}

// Masked because it is a credential, revealable because it is pasted from a file
// and one wrong character is otherwise unexplainable.
function TokenField({
	token,
	onSave,
	onCancel,
}: {
	token: string;
	onSave: (token: string) => void;
	// Absent while there is nothing to go back to: an unconfigured component has
	// no earlier state for Cancel to mean.
	onCancel?: () => void;
}) {
	const [draft, setDraft] = useState(token);
	const [isVisible, setIsVisible] = useState(false);

	// Committed rather than bound: the token keys the discovery query, so binding
	// it would re-probe the component once per keystroke.
	return (
		<form
			className={styles.tokenRow}
			onSubmit={(event) => {
				event.preventDefault();
				onSave(draft.trim());
			}}
		>
			<label className={styles.field}>
				<span className={styles.label}>Token</span>
				<input
					className={styles.input}
					type={isVisible ? "text" : "password"}
					value={draft}
					spellCheck={false}
					autoComplete="off"
					placeholder="Paste the token from foobar2000"
					onChange={(event) => setDraft(event.target.value)}
				/>
			</label>

			<Button
				aria-pressed={isVisible}
				onClick={() => setIsVisible((current) => !current)}
			>
				{isVisible ? "Hide" : "Show"}
			</Button>
			{onCancel ? <Button onClick={onCancel}>Cancel</Button> : null}
			<Button variant="primary" type="submit" disabled={draft.trim() === token}>
				Save
			</Button>
		</form>
	);
}

// Named for the component rather than for what it enables, because
// troubleshooting is component-shaped: when a rating will not save, the question
// is "is foo_jean running".
export function TagWriting() {
	// Discovery comes from the shared hook rather than through the tag-writing context:
	// this pane is about the *component*, and pairing in particular has nothing to do
	// with tracks. The context still owns the allowlist switches, which genuinely are
	// about writing.
	const { discovery, isChecking, token, setToken, recheck } = useFooJean();
	const { allowedFields, isFieldEnabled, setFieldEnabled } = useTagWriting();
	const { state, origin } = discovery;

	const explained = explain(state);
	const streaming = explainStreaming(state);
	const [isEditingToken, setIsEditingToken] = useState(false);

	// A stored token that works is a setting nobody touches again, so it collapses
	// to a button rather than sitting there as a filled field with a Save nothing
	// needs pressing. It stays open where it is the panel's whole point: not yet
	// pasted, or pasted and refused.
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

			{/* Narrowing only: a field missing here is permitted over there, not
          switched on here. */}
			{allowedFields.length > 0 ? (
				<div className={styles.fields}>
					<div className={styles.fieldsHead}>
						<span>What Jean may write</span>
						<HelpHint label="About the write allowlist">
							<p>
								This foobar2000 permits these fields and no others. That list
								lives under <code>{PANE}</code>.
							</p>
							<p>
								Turning one off here narrows what Jean offers. It cannot widen
								the list.
							</p>
						</HelpHint>
					</div>
					{allowedFields.map((field) => (
						<Switch
							key={field}
							label={labelOfField(field)}
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
							Change token
						</button>
					) : null}
				</div>
			) : null}

			{/* Both of these are for getting *to* working: one retries after you have
          fixed something, the other is a setup step. Neither has anything to
          offer a panel that is already connected, so a working component shows
          its state and its switches and nothing else. A reload re-runs
          discovery if it is ever needed. */}
			{isWorking ? null : (
				<div className={styles.panelFoot}>
					<Button onClick={recheck} disabled={isChecking}>
						{isChecking ? "Checking..." : "Check again"}
					</Button>
				</div>
			)}
		</section>
	);
}
