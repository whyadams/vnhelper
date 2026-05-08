import { useEffect, useRef, type ReactNode } from "react";

export function Popover({
  open,
  onClose,
  anchorRef,
  children,
  align = "left",
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  children: ReactNode;
  align?: "left" | "right";
}) {
  const popRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, anchorRef]);

  if (!open || !anchorRef.current) return null;
  const rect = anchorRef.current.getBoundingClientRect();
  const style: React.CSSProperties = {
    position: "fixed",
    top: rect.bottom + 6,
    left: align === "left" ? rect.left : undefined,
    right: align === "right" ? window.innerWidth - rect.right : undefined,
    zIndex: 100,
  };

  return (
    <div ref={popRef} className="popover" style={style}>
      {children}
    </div>
  );
}
