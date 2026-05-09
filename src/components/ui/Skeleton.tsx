import type { CSSProperties } from "react";

/**
 * Skeleton placeholder. Visible only after a 100ms delay (CSS animation-delay
 * with `backwards` fill mode), so fast loads (< 100ms) never flash a skeleton.
 *
 * Use composed primitives:
 *   <SkeletonBlock width="60%" height={16} />
 *   <SkeletonRow />
 *   <SkeletonStack count={5} />
 *
 * The parent should control layout (gap, padding); these components only
 * paint the placeholder rectangles.
 */

interface BlockProps {
  width?: number | string;
  height?: number | string;
  rounded?: number | string;
  className?: string;
  style?: CSSProperties;
}

export function SkeletonBlock({
  width = "100%",
  height = 14,
  rounded = 6,
  className,
  style,
}: BlockProps) {
  return (
    <span
      className={"sk-block" + (className ? " " + className : "")}
      style={{
        width,
        height,
        borderRadius: rounded,
        ...style,
      }}
      aria-hidden
    />
  );
}

interface RowProps {
  height?: number | string;
  rounded?: number | string;
  className?: string;
}

/** Single full-width row, e.g. a list item. */
export function SkeletonRow({
  height = 36,
  rounded = 9,
  className,
}: RowProps) {
  return (
    <SkeletonBlock
      width="100%"
      height={height}
      rounded={rounded}
      className={className}
    />
  );
}

interface StackProps {
  count: number;
  height?: number | string;
  rounded?: number | string;
  gap?: number;
  className?: string;
}

/** Vertical stack of N identical rows, useful for list placeholders. */
export function SkeletonStack({
  count,
  height = 36,
  rounded = 9,
  gap = 6,
  className,
}: StackProps) {
  return (
    <div
      className={"sk-stack" + (className ? " " + className : "")}
      style={{ display: "flex", flexDirection: "column", gap }}
      aria-hidden
    >
      {Array.from({ length: count }, (_, i) => (
        <SkeletonRow key={i} height={height} rounded={rounded} />
      ))}
    </div>
  );
}

interface BoxProps {
  className?: string;
  style?: CSSProperties;
  children?: React.ReactNode;
}

/**
 * A delayed-appearance container — apply to whatever skeleton composition you
 * build, so the whole composition shares the 100ms appearance gate.
 * (The individual primitives above have their own gate too; using SkeletonBox
 *  ensures custom compositions inherit it.)
 */
export function SkeletonBox({ className, style, children }: BoxProps) {
  return (
    <div
      className={"sk-box" + (className ? " " + className : "")}
      style={style}
      aria-hidden
      role="status"
    >
      {children}
    </div>
  );
}
