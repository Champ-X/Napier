import { useRef, type KeyboardEvent, type PointerEvent } from "react";

export interface WorkspaceResizeHandleProps {
  side: "navigation" | "evidence";
  label: string;
  value: number;
  min: number;
  max: number;
  onChange(value: number): void;
  onReset(): void;
}

const KEYBOARD_STEP = 16;

export function WorkspaceResizeHandle({
  side,
  label,
  value,
  min,
  max,
  onChange,
  onReset,
}: WorkspaceResizeHandleProps) {
  const drag = useRef<
    { pointerId: number; x: number; width: number } | undefined
  >(undefined);
  const direction = side === "navigation" ? 1 : -1;

  const beginResize = (event: PointerEvent<HTMLDivElement>) => {
    drag.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      width: value,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.classList.add("is-resizing-workspace");
  };

  const resize = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    onChange(drag.current.width + (event.clientX - drag.current.x) * direction);
  };

  const endResize = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    drag.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    document.body.classList.remove("is-resizing-workspace");
  };

  const resizeWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Home") {
      event.preventDefault();
      onChange(min);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      onChange(max);
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const movement =
      event.key === "ArrowRight" ? KEYBOARD_STEP : -KEYBOARD_STEP;
    onChange(value + movement * direction);
  };

  return (
    <div
      className={`workspace-resize-handle is-${side}`}
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      onDoubleClick={onReset}
      onKeyDown={resizeWithKeyboard}
      onPointerDown={beginResize}
      onPointerMove={resize}
      onPointerUp={endResize}
      onPointerCancel={endResize}
    />
  );
}
