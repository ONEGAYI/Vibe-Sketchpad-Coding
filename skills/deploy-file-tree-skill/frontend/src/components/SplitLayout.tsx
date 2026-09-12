import { Children, useLayoutEffect, useRef, useState, type ReactNode } from "react";

const DIVIDER = 9;

/** containerWidth 含分隔条；首选宽度不随窗口缩小而丢失。 */
export function sidebarGeometry(containerWidth: number, preferred: number) {
  const available = Math.max(0, containerWidth - DIVIDER);
  const stacked = available <= 600;
  const min = 240;
  const max = Math.max(min, Math.min(440, available * 0.46));
  return { available, stacked, min, max, width: Math.min(max, Math.max(min, preferred)) };
}

/** 普通浏览双栏；内部只保存本次页面会话的普通侧栏首选宽度。 */
export function SplitLayout({ children, expanded = false }: { children: ReactNode; expanded?: boolean }) {
  const root = useRef<HTMLElement>(null);
  const divider = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointer: number; x: number; width: number } | null>(null);
  const [containerWidth, setContainerWidth] = useState(1024);
  const [preferred, setPreferred] = useState(310);
  const [dragging, setDragging] = useState(false);
  const geometry = sidebarGeometry(containerWidth, preferred);
  const disabled = geometry.stacked || expanded;
  const shownWidth = expanded ? geometry.available * 0.8 : geometry.width;
  const panels = Children.toArray(children);

  const finishDrag = () => {
    const active = drag.current;
    drag.current = null;
    setDragging(false);
    if (active && divider.current?.hasPointerCapture(active.pointer)) {
      divider.current.releasePointerCapture(active.pointer);
    }
  };

  useLayoutEffect(() => {
    const element = root.current!;
    const measure = () => setContainerWidth(element.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (disabled) finishDrag();
  }, [disabled]);

  return (
    <main ref={root} className={`columns${dragging ? " resizing" : ""}${expanded ? " hierarchy-expanded" : ""}`} data-stacked={geometry.stacked}
      style={{ "--sidebar-width": `${shownWidth}px` } as React.CSSProperties}>
      {panels[0]}
      <div ref={divider} className="sidebar-divider" role="separator" aria-label="调整目录栏宽度"
        aria-orientation="vertical" aria-valuemin={expanded ? shownWidth : geometry.min} aria-valuemax={expanded ? shownWidth : geometry.max}
        aria-valuenow={shownWidth} aria-disabled={disabled} tabIndex={disabled ? -1 : 0}
        onPointerDown={(event) => {
          if (disabled || event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { pointer: event.pointerId, x: event.clientX, width: geometry.width };
          setDragging(true);
        }}
        onPointerMove={(event) => {
          const active = drag.current;
          if (!active || active.pointer !== event.pointerId || disabled) return;
          setPreferred(sidebarGeometry(containerWidth, active.width + event.clientX - active.x).width);
        }}
        onPointerUp={finishDrag} onPointerCancel={finishDrag} onLostPointerCapture={finishDrag}
        onKeyDown={(event) => {
          if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
          if (disabled || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
          event.preventDefault();
          setPreferred(sidebarGeometry(containerWidth, geometry.width + (event.key === "ArrowRight" ? 10 : -10)).width);
        }} />
      {panels[1]}
    </main>
  );
}
