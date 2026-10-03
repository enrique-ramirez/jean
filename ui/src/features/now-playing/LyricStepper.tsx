import type { Phrase } from "@/shared/i18n/en";
import {
	type Formats,
	useFormats,
	useTranslate,
} from "@/shared/i18n/useTranslate";
import styles from "./LyricStepper.module.css";

const STEPS = [
	{ ms: -1000, label: "lyrics.stepBackSecond" },
	{ ms: -100, label: "lyrics.stepBackTenth" },
	{ ms: 100, label: "lyrics.stepForwardTenth" },
	{ ms: 1000, label: "lyrics.stepForwardSecond" },
] as const satisfies { ms: number; label: Phrase }[];

export type Scope = "line" | "all";

const SIGN = { positive: "+", negative: "−", none: "±" };

function amountOf(ms: number, formats: Formats): string {
	const sign = ms > 0 ? SIGN.positive : ms < 0 ? SIGN.negative : SIGN.none;
	return (
		sign +
		formats.number(Math.abs(ms) / 1000, {
			minimumFractionDigits: 2,
			maximumFractionDigits: 2,
		})
	);
}

export function useAmountReadout() {
	const t = useTranslate();
	const formats = useFormats();

	return (ms: number) =>
		t("lyrics.amountSeconds", { amount: amountOf(ms, formats) });
}

export function Stepper({
	label,
	showsLabel,
	readout,
	isReadoutQuiet = false,
	size = "inline",
	disabled = false,
	onStep,
}: {
	label: string;
	showsLabel: boolean;
	readout?: string;
	isReadoutQuiet?: boolean;
	size?: "inline" | "touch";
	disabled?: boolean;
	onStep: (ms: number) => void;
}) {
	const t = useTranslate();

	const stepButton = (step: (typeof STEPS)[number]) => (
		<button
			key={step.ms}
			type="button"
			className={styles.step}
			onClick={() => onStep(step.ms)}
		>
			{t(step.label)}
		</button>
	);

	return (
		<fieldset
			className={styles.steps}
			aria-label={label}
			data-size={size}
			disabled={disabled}
		>
			{showsLabel ? <span className={styles.stepsLabel}>{label}</span> : null}
			{STEPS.slice(0, 2).map(stepButton)}
			{readout === undefined ? null : (
				<span className={styles.amount} data-quiet={isReadoutQuiet}>
					{readout}
				</span>
			)}
			{STEPS.slice(2).map(stepButton)}
		</fieldset>
	);
}

export function ScopeSwitch({
	scope,
	canChooseLine,
	onChange,
}: {
	scope: Scope;
	canChooseLine: boolean;
	onChange: (scope: Scope) => void;
}) {
	const t = useTranslate();

	return (
		<div className={styles.scope}>
			<button
				type="button"
				aria-pressed={scope === "line"}
				disabled={!canChooseLine}
				onClick={() => onChange("line")}
			>
				{t("lyrics.thisLine")}
			</button>
			<button
				type="button"
				aria-pressed={scope === "all"}
				onClick={() => onChange("all")}
			>
				{t("lyrics.allLines")}
			</button>
		</div>
	);
}
