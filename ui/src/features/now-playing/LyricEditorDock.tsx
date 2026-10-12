import type { ReactNode } from "react";

import type { PlayerSnapshot } from "@/shared/api/types";
import styles from "./LyricEditor.module.css";
import { type Scope, ScopeSwitch } from "./LyricStepper";
import { EditorClock, EditorTransport, StampButton } from "./LyricTransport";
import type { AudibleClock } from "./useAudibleClock";

export function LyricEditorDock({
	isPhone,
	clock,
	snapshot,
	notPlaying,
	canControlPlayback,
	canStamp,
	scope,
	canChooseLine,
	lineStepper,
	allStepper,
	onScope,
	onStamp,
}: {
	isPhone: boolean;
	clock: AudibleClock;
	snapshot: PlayerSnapshot | null | undefined;
	notPlaying: string | null;
	canControlPlayback: boolean;
	canStamp: boolean;
	scope: Scope;
	canChooseLine: boolean;
	lineStepper: ReactNode;
	allStepper: ReactNode;
	onScope: (scope: Scope) => void;
	onStamp: () => void;
}) {
	return isPhone ? (
		<div className={styles.dock}>
			<div className={styles.dockRow}>
				<ScopeSwitch
					scope={scope}
					canChooseLine={canChooseLine}
					onChange={onScope}
				/>
				<EditorClock
					clock={clock}
					snapshot={snapshot}
					showsBar={false}
					notPlaying={notPlaying}
				/>
			</div>
			{scope === "line" ? lineStepper : allStepper}
			<div className={styles.transport}>
				<EditorTransport
					snapshot={snapshot}
					canControlPlayback={canControlPlayback}
					notPlaying={notPlaying}
				/>
				<StampButton
					size="large"
					disabled={!canStamp}
					notPlaying={notPlaying}
					onStamp={onStamp}
				/>
			</div>
		</div>
	) : (
		<div className={styles.foot}>
			<EditorClock
				clock={clock}
				snapshot={snapshot}
				showsBar
				notPlaying={notPlaying}
			/>
			<div className={styles.transport}>
				<EditorTransport
					snapshot={snapshot}
					canControlPlayback={canControlPlayback}
					notPlaying={notPlaying}
				/>
				<StampButton
					size="inline"
					disabled={!canStamp}
					notPlaying={notPlaying}
					onStamp={onStamp}
				/>
			</div>
			<div className={styles.whole}>{allStepper}</div>
		</div>
	);
}
