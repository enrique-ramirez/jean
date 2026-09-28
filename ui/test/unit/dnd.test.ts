import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { type DragPayload, useDragSource } from "../../src/shared/ui/dnd.ts";

// A drop target is a string its owner writes into `data-drop-target`, and what
// it means is the owner's business: a playlist id, a queue slot, whatever comes
// next. The drag layer hit-tests it and hands it back. There is no DOM under
// `node`, so the hook is rendered once on the server for its handlers and the
// few browser calls it makes are answered by hand.

const PAYLOAD: DragPayload<number[]> = { items: [1], label: "One", count: 1 };

const IDS = [
	"45837d74-fa4f-415c-bba9-bf2db8f0dc04",
	"queue:3",
	" padded ",
	"Álbum/Ñandú?#x",
];

type Listener = (event: { clientX: number; clientY: number }) => void;

const define = (name: string, value: unknown) =>
	Object.defineProperty(globalThis, name, {
		value,
		configurable: true,
		writable: true,
	});

const browser = (target: string) => {
	const listeners = new Map<string, Listener>();
	let frames: FrameRequestCallback[] = [];
	const element = {
		dataset: { dropTarget: target } as Record<string, string>,
	};

	const names = [
		"window",
		"document",
		"requestAnimationFrame",
		"cancelAnimationFrame",
	];
	const was = names.map(
		(name) =>
			[name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
	);

	define("window", {
		addEventListener: (type: string, listener: Listener) =>
			listeners.set(type, listener),
		removeEventListener: (type: string) => listeners.delete(type),
	});
	define("document", {
		body: { style: {} },
		elementFromPoint: () => ({
			closest: (selector: string) =>
				selector === "[data-drop-target]" ? element : null,
		}),
	});
	define("requestAnimationFrame", (callback: FrameRequestCallback) => {
		frames.push(callback);
		return frames.length;
	});
	define("cancelAnimationFrame", () => {});

	return {
		close: () => {
			for (const [name, descriptor] of was) {
				if (descriptor) Object.defineProperty(globalThis, name, descriptor);
				else delete (globalThis as Record<string, unknown>)[name];
			}
		},
		fire: (type: string, clientX = 0) =>
			listeners.get(type)?.({ clientX, clientY: 0 }),
		frame: () => {
			const due = frames;
			frames = [];
			for (const callback of due) callback(0);
		},
	};
};

const dragOnto = (target: string) => {
	const asked: string[] = [];
	const dropped: string[] = [];
	let handlers: ReturnType<typeof useDragSource> | null = null;

	function Source() {
		handlers = useDragSource({
			getPayload: () => PAYLOAD,
			canDrop: (id) => {
				asked.push(id);
				return true;
			},
			onDrop: (over) => dropped.push(over),
		});
		return null;
	}
	renderToString(createElement(Source));

	assert.ok(handlers);
	const page = browser(target);
	try {
		(handlers as ReturnType<typeof useDragSource>).dragProps.onPointerDown({
			pointerType: "mouse",
			button: 0,
			clientX: 0,
			clientY: 0,
		} as Parameters<
			ReturnType<typeof useDragSource>["dragProps"]["onPointerDown"]
		>[0]);
		page.fire("pointermove", 40);
		page.frame();
		page.fire("pointerup", 40);
	} finally {
		page.close();
	}

	return { asked, dropped };
};

test("a drop target's id comes back to its owner exactly as the owner wrote it", () => {
	for (const id of IDS) {
		const { asked, dropped } = dragOnto(id);

		assert.deepEqual(asked, [id], "canDrop was asked about another id");
		assert.deepEqual(dropped, [id], "onDrop was handed another id");
	}
});
