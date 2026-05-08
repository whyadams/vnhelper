import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type HTMLAttributes,
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
  Children,
  cloneElement,
  isValidElement,
} from "react";
import { Popover } from "../kanban/Popover";

/* ============================================================
   M3 Menu — material-feel dropdown built on our Popover.
   - ripple + hover overlay
   - sweep-in clip-path
   - drill-down pages (multi-level menus)
   - stagger animation per item
   No Tailwind, no shadcn — uses .mmenu CSS classes.
   ============================================================ */

interface DrilldownCtx {
  activePage: string;
  history: string[];
  navigate: (id: string) => void;
  goBack: () => void;
  contentHeight: number | null;
  setContentHeight: (h: number) => void;
  closeMenu: () => void;
}

const Ctx = createContext<DrilldownCtx | null>(null);

function useDrilldown() {
  const v = useContext(Ctx);
  if (!v) throw new Error("MMenu component must be used inside <MMenu>");
  return v;
}

/* ---------- Root ---------- */

interface MMenuProps {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  align?: "left" | "right";
  className?: string;
  style?: CSSProperties;
  minWidth?: number;
  children: ReactNode;
}

export function MMenu({
  open,
  onClose,
  anchorRef,
  align = "left",
  className,
  style,
  minWidth = 220,
  children,
}: MMenuProps) {
  const [history, setHistory] = useState<string[]>(["main"]);
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  const activePage = history[history.length - 1] || "main";

  const navigate = useCallback((id: string) => {
    setHistory((prev) => {
      if (prev[prev.length - 1] === id) return prev;
      return [...prev, id].slice(-10);
    });
  }, []);

  const goBack = useCallback(() => {
    setHistory((prev) => (prev.length <= 1 ? prev : prev.slice(0, -1)));
  }, []);

  // Reset state on each open.
  useEffect(() => {
    if (open) {
      setHistory(["main"]);
      setContentHeight(null);
    }
  }, [open]);

  return (
    <Popover open={open} onClose={onClose} anchorRef={anchorRef} align={align}>
      <Ctx.Provider
        value={{
          activePage,
          history,
          navigate,
          goBack,
          contentHeight,
          setContentHeight,
          closeMenu: onClose,
        }}
      >
        <div
          className={"mmenu" + (className ? " " + className : "")}
          style={{
            minWidth,
            height:
              contentHeight !== null ? `${contentHeight}px` : undefined,
            ...style,
          }}
          data-mmenu-state="open"
        >
          {children}
        </div>
      </Ctx.Provider>
    </Popover>
  );
}

/* ---------- Page ---------- */

interface MMenuPageProps {
  id: string;
  children: ReactNode;
  className?: string;
}

export function MMenuPage({ id, children, className }: MMenuPageProps) {
  const { activePage, history, setContentHeight, goBack } = useDrilldown();
  const isActive = activePage === id;
  const isLeft = history.includes(id) && !isActive;
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isActive || !ref.current) return;
    const el = ref.current;
    const obs = new ResizeObserver((entries) => {
      const h =
        entries[0].borderBoxSize?.[0]?.blockSize ??
        entries[0].contentRect.height;
      setContentHeight(h);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [isActive, setContentHeight]);

  const stateClass = isActive
    ? "is-active"
    : isLeft
      ? "is-left"
      : "is-right";

  // Wrap children with stagger index
  const staggered = Children.map(children, (child, idx) => {
    if (isValidElement(child)) {
      const baseIdx = id === "main" ? idx : idx + 1;
      const childWithStyle = child as ReactElement<{
        style?: CSSProperties;
      }>;
      return cloneElement(childWithStyle, {
        style: {
          ...(childWithStyle.props.style ?? {}),
          ["--mm-stagger" as never]: baseIdx,
        } as CSSProperties,
      });
    }
    return child;
  });

  return (
    <div
      ref={ref}
      className={`mmenu-page ${stateClass}${className ? " " + className : ""}`}
    >
      {id !== "main" && (
        <MMenuItem
          onClick={goBack}
          className="mmenu-back"
          style={{ ["--mm-stagger" as never]: 0 } as CSSProperties}
        >
          <ChevronLeft />
          <span>Back</span>
        </MMenuItem>
      )}
      {staggered}
    </div>
  );
}

/* ---------- Item (with ripple) ---------- */

interface MMenuItemProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  variant?: "default" | "danger";
  inset?: boolean;
  children: ReactNode;
}

export const MMenuItem = forwardRef<HTMLButtonElement, MMenuItemProps>(
  ({ className, variant, inset, onClick, children, ...rest }, ref) => {
    const surfRef = useRef<HTMLSpanElement | null>(null);
    const rippleRef = useRef<HTMLSpanElement | null>(null);
    const animRef = useRef<Animation | null>(null);
    const [pressed, setPressed] = useState(false);
    const mounted = useRef(true);

    useEffect(() => {
      mounted.current = true;
      return () => {
        mounted.current = false;
      };
    }, []);

    const startRipple = (
      e?: PointerEvent<HTMLButtonElement> | KeyboardEvent<HTMLButtonElement>,
    ) => {
      const surf = surfRef.current;
      const ripple = rippleRef.current;
      if (!surf || !ripple) return;
      const rect = surf.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      animRef.current?.cancel();

      let cx = rect.width / 2;
      let cy = rect.height / 2;
      if (e && "clientX" in e) {
        cx = e.clientX - rect.left;
        cy = e.clientY - rect.top;
      }

      const maxDim = Math.max(rect.width, rect.height);
      const initial = Math.max(2, Math.floor(maxDim * 0.2));
      const hypot = Math.sqrt(rect.width ** 2 + rect.height ** 2);
      const maxR = hypot + 10;
      const soft = Math.max(0.35 * maxDim, 75);
      const scale = (maxR + soft) / initial;
      const duration = Math.min(Math.max(360, hypot * 1.4), 900);

      ripple.style.width = `${initial}px`;
      ripple.style.height = `${initial}px`;
      const sx = cx - initial / 2;
      const sy = cy - initial / 2;
      const ex = (rect.width - initial) / 2;
      const ey = (rect.height - initial) / 2;

      animRef.current = ripple.animate(
        [
          { transform: `translate(${sx}px, ${sy}px) scale(1)` },
          { transform: `translate(${ex}px, ${ey}px) scale(${scale})` },
        ],
        {
          duration,
          easing: "cubic-bezier(0.2, 0, 0, 1)",
          fill: "forwards",
        },
      );
      setPressed(true);
    };

    const endRipple = async () => {
      const a = animRef.current;
      const min = 280;
      if (a && typeof a.currentTime === "number" && a.currentTime < min) {
        await new Promise((r) => setTimeout(r, min - (a.currentTime as number)));
      }
      if (mounted.current) setPressed(false);
    };

    return (
      <button
        ref={ref}
        type="button"
        onClick={onClick}
        onPointerDown={(e) => {
          if (e.button === 0) startRipple(e);
          rest.onPointerDown?.(e);
        }}
        onPointerUp={(e) => {
          void endRipple();
          rest.onPointerUp?.(e);
        }}
        onPointerLeave={(e) => {
          void endRipple();
          rest.onPointerLeave?.(e);
        }}
        onPointerCancel={(e) => {
          void endRipple();
          rest.onPointerCancel?.(e);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            startRipple(e);
            setTimeout(() => {
              void endRipple();
            }, 280);
          }
          rest.onKeyDown?.(e);
        }}
        className={
          "mmenu-item mmenu-anim" +
          (variant === "danger" ? " is-danger" : "") +
          (inset ? " is-inset" : "") +
          (className ? " " + className : "")
        }
        {...rest}
      >
        <span className="mmenu-surface" ref={surfRef}>
          <span className="mmenu-hover" />
          <span
            ref={rippleRef}
            className="mmenu-ripple"
            data-pressed={pressed ? "true" : "false"}
          />
        </span>
        <span className="mmenu-content">{children}</span>
      </button>
    );
  },
);
MMenuItem.displayName = "MMenuItem";

/* ---------- Page Trigger (drill into submenu) ---------- */

interface MMenuPageTriggerProps extends MMenuItemProps {
  targetId: string;
}

export function MMenuPageTrigger({
  targetId,
  children,
  ...rest
}: MMenuPageTriggerProps) {
  const { navigate } = useDrilldown();
  return (
    <MMenuItem
      {...rest}
      onClick={(e) => {
        rest.onClick?.(e);
        navigate(targetId);
      }}
    >
      <span className="mmenu-row">{children}</span>
      <ChevronRight className="mmenu-chev" />
    </MMenuItem>
  );
}

/* ---------- Label & Separator ---------- */

export function MMenuLabel({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      className={"mmenu-label mmenu-anim" + (className ? " " + className : "")}
    >
      {children}
    </div>
  );
}

export function MMenuSeparator({
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      className={"mmenu-sep mmenu-anim" + (className ? " " + className : "")}
    />
  );
}

/* ---------- Checkbox / Radio variants ---------- */

interface MMenuCheckProps extends Omit<MMenuItemProps, "children"> {
  checked: boolean;
  children: ReactNode;
}

export function MMenuCheck({
  checked,
  children,
  ...rest
}: MMenuCheckProps) {
  return (
    <MMenuItem {...rest} aria-checked={checked} role="menuitemcheckbox">
      <span className="mmenu-indicator">
        {checked && <CheckIcon />}
      </span>
      {children}
    </MMenuItem>
  );
}

/* ---------- Icons (inline, no extra deps) ---------- */

function ChevronRight(props: { className?: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={props.className}
      aria-hidden
    >
      <polyline points="9 6 15 12 9 18" />
    </svg>
  );
}

function ChevronLeft() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
