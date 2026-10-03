import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";

import { type LeaveGuard, useLeaveGuard } from "@/shared/hooks/useLeaveGuard";
import { Trans } from "@/shared/i18n/Trans";
import { useTranslate } from "@/shared/i18n/useTranslate";
import { AlertDialog } from "@/shared/ui/AlertDialog";

interface Asking {
	discard: () => void;
	keep: () => void;
}

export function useDiscardGuard({
	isDirty,
	title,
	changes,
}: {
	isDirty: boolean;
	title: string;
	changes?: number;
}): {
	isAsking: boolean;
	prompt: ReactNode;
	leave: (leave: () => void) => void;
} {
	const t = useTranslate();
	const [asking, setAsking] = useState<Asking | null>(null);
	const dirty = useRef(isDirty);
	dirty.current = isDirty;
	const isOpen = useRef(false);

	const guard = useMemo<LeaveGuard>(
		() => ({
			isDirty: () => dirty.current,
			ask: (discard, keep) => {
				if (isOpen.current) {
					keep();
					return;
				}
				isOpen.current = true;
				setAsking({ discard, keep });
			},
		}),
		[],
	);
	useLeaveGuard(guard);

	useEffect(() => {
		if (!asking || isDirty) return;
		isOpen.current = false;
		setAsking(null);
		asking.discard();
	}, [asking, isDirty]);

	const leave = useCallback(
		(leaving: () => void) => {
			if (dirty.current) guard.ask(leaving, () => {});
			else leaving();
		},
		[guard],
	);

	const answer = useCallback(
		(choice: keyof Asking) => {
			isOpen.current = false;
			setAsking(null);
			asking?.[choice]();
		},
		[asking],
	);

	if (!asking) return { isAsking: false, prompt: null, leave };

	const named = <b>{title}</b>;
	return {
		isAsking: true,
		leave,
		prompt: (
			<AlertDialog
				title={t("lyrics.discardTitle")}
				body={
					changes === undefined || changes === 0 ? (
						<Trans phrase="lyrics.discardChanged" title={named} />
					) : (
						<Trans
							phrase="lyrics.discardCounted"
							count={changes}
							title={named}
						/>
					)
				}
				actions={[
					{
						label: t("lyrics.discard"),
						onSelect: () => answer("discard"),
						isDestructive: true,
					},
					{
						label: t("lyrics.keepEditing"),
						onSelect: () => answer("keep"),
						keyHint: "Enter",
						isDefault: true,
					},
				]}
			/>
		),
	};
}
