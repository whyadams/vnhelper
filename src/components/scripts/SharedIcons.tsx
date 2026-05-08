import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

const stroke = (size = 16, sw = 1.8): SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: sw,
  strokeLinecap: "round",
  strokeLinejoin: "round",
});

export function ChevRight(p: IconProps) {
  return (
    <svg {...stroke(p.size ?? 9, 2.5)} {...p}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function StarIcon(p: IconProps) {
  return (
    <svg {...stroke(p.size ?? 16, 1.6)} {...p}>
      <path d="M12 2l2.4 6.3L21 9l-5 4.4L17.5 20 12 16.6 6.5 20 8 13.4 3 9l6.6-.7z" />
    </svg>
  );
}

export function DocSmall(p: IconProps) {
  return (
    <svg {...stroke(p.size ?? 16, 1.6)} {...p}>
      <path d="M5 4h11l3 3v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
      <path d="M14 4v4h4" />
    </svg>
  );
}

export function FolderSmall(p: IconProps) {
  return (
    <svg {...stroke(p.size ?? 16, 1.6)} {...p}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}

export function MenuLines(p: IconProps) {
  return (
    <svg {...stroke(p.size ?? 14)} {...p}>
      <path d="M3 6h18M6 12h12M10 18h4" />
    </svg>
  );
}

export function PlusBold(p: IconProps) {
  return (
    <svg {...stroke(p.size ?? 14, 2.2)} {...p}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function SearchSmall(p: IconProps) {
  return (
    <svg {...stroke(p.size ?? 13, 2)} {...p}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}

export function ClockIcon(p: IconProps) {
  return (
    <svg {...stroke(p.size ?? 13)} {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

export function PersonIcon(p: IconProps) {
  return (
    <svg {...stroke(p.size ?? 13)} {...p}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
    </svg>
  );
}

export function PeopleIcon(p: IconProps) {
  return (
    <svg {...stroke(p.size ?? 13)} {...p}>
      <circle cx="9" cy="8" r="3.5" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M3 19c.5-3 3-5 6-5s5.5 2 6 5M14 19c0-2 1.5-3.5 3-3.5s3 1.5 3 3.5" />
    </svg>
  );
}

export function CalendarSmall(p: IconProps) {
  return (
    <svg {...stroke(p.size ?? 13)} {...p}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 9h18M8 3v4M16 3v4" />
    </svg>
  );
}

export function ClockEditedIcon(p: IconProps) {
  return (
    <svg {...stroke(p.size ?? 13)} {...p}>
      <path d="M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0z" />
      <path d="M12 8v4l3 2" />
    </svg>
  );
}

export function TagIcon(p: IconProps) {
  return (
    <svg {...stroke(p.size ?? 13)} {...p}>
      <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0l-7.2-7.2a2 2 0 0 1 0-2.8l7.2-7.2a2 2 0 0 1 1.4-.6h5.6a2 2 0 0 1 2 2v5.6a2 2 0 0 1-.6 1.4z" />
      <circle cx="16" cy="8" r="1" />
    </svg>
  );
}

export function ShareIcon(p: IconProps) {
  return (
    <svg {...stroke(p.size ?? 14)} {...p}>
      <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v14" />
    </svg>
  );
}

export function FlowIcon(p: IconProps) {
  return (
    <svg {...stroke(p.size ?? 14)} {...p}>
      <circle cx="12" cy="12" r="3" />
      <circle cx="5" cy="6" r="2" />
      <circle cx="19" cy="18" r="2" />
      <path d="M7 6h10M7 18h10" />
    </svg>
  );
}

export function MoreVIcon(p: IconProps) {
  return (
    <svg
      width={p.size ?? 14}
      height={p.size ?? 14}
      viewBox="0 0 24 24"
      fill="currentColor"
      {...p}
    >
      <circle cx="12" cy="5" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="12" cy="19" r="1.5" />
    </svg>
  );
}

export function InfoCircle(p: IconProps) {
  return (
    <svg {...stroke(p.size ?? 18)} {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4M12 16h.01" />
    </svg>
  );
}

export function QuoteIcon(p: IconProps) {
  return (
    <svg {...stroke(p.size ?? 18)} {...p}>
      <path d="M7 7h4v4H7zM13 7h4v4h-4zM7 13c0 2 1 4 4 4M13 13c0 2 1 4 4 4" />
    </svg>
  );
}

export function GutterPlus(p: IconProps) {
  return (
    <svg {...stroke(p.size ?? 12, 2.4)} {...p}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function GutterDrag(p: IconProps) {
  return (
    <svg
      width={p.size ?? 12}
      height={p.size ?? 12}
      viewBox="0 0 24 24"
      fill="currentColor"
      {...p}
    >
      <circle cx="9" cy="6" r="1.5" />
      <circle cx="15" cy="6" r="1.5" />
      <circle cx="9" cy="12" r="1.5" />
      <circle cx="15" cy="12" r="1.5" />
      <circle cx="9" cy="18" r="1.5" />
      <circle cx="15" cy="18" r="1.5" />
    </svg>
  );
}

/* Slash menu icons */

export function SlashText(p: IconProps) {
  return (
    <svg {...stroke(p.size ?? 13, 2)} {...p}>
      <path d="M5 6h14M5 12h14M5 18h10" />
    </svg>
  );
}

export function SlashH2(p: IconProps) {
  return (
    <svg {...stroke(p.size ?? 13, 2)} {...p}>
      <path d="M6 4v16M14 4v16M6 12h8M22 8l-2-2v12l2-2" />
    </svg>
  );
}

export function SlashTodo(p: IconProps) {
  return (
    <svg {...stroke(p.size ?? 13, 2)} {...p}>
      <rect x="4" y="5" width="3" height="3" rx="0.5" />
      <rect x="4" y="11" width="3" height="3" rx="0.5" />
      <rect x="4" y="17" width="3" height="3" rx="0.5" />
      <path d="M10 6.5h10M10 12.5h10M10 18.5h10" />
    </svg>
  );
}

export function SlashCode(p: IconProps) {
  return (
    <svg {...stroke(p.size ?? 13, 2)} {...p}>
      <path d="M8 6l-4 6 4 6M16 6l4 6-4 6" />
    </svg>
  );
}

export function SlashTable(p: IconProps) {
  return (
    <svg {...stroke(p.size ?? 13, 2)} {...p}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 10h18M9 4v16" />
    </svg>
  );
}

export function SlashCallout(p: IconProps) {
  return (
    <svg {...stroke(p.size ?? 13, 2)} {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4M12 16h.01" />
    </svg>
  );
}
