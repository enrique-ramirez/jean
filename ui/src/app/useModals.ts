import { useCallback, useState } from "react";
import { type Modal, SURFACES } from "./surfaces";

const ALL_CLOSED = Object.fromEntries(
	Object.entries(SURFACES)
		.filter(([, surface]) => surface.kind === "modal")
		.map(([name]) => [name, false]),
) as Record<Modal, boolean>;

export function useModals() {
	const [isOpen, setIsOpen] = useState(ALL_CLOSED);

	const set = useCallback(
		(modal: Modal, open: boolean | ((current: boolean) => boolean)) =>
			setIsOpen((current) => ({
				...current,
				[modal]: typeof open === "function" ? open(current[modal]) : open,
			})),
		[],
	);

	return {
		isOpen,
		open: useCallback((modal: Modal) => set(modal, true), [set]),
		close: useCallback((modal: Modal) => set(modal, false), [set]),
		toggle: useCallback(
			(modal: Modal) => set(modal, (current) => !current),
			[set],
		),
	};
}
