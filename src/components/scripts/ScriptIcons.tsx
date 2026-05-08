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

export function ScriptIcon(p: IconProps) {
  return (
    <svg {...stroke(p.size)} {...p}>
      <path d="M5 4h11l3 3v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
      <path d="M14 4v4h4" />
      <path d="M8 12h8M8 16h6" />
    </svg>
  );
}

export function MaskIcon(p: IconProps) {
  return (
    <svg {...stroke(p.size ?? 14, 1.6)} {...p}>
      <path d="M4 5c4-1 12-1 16 0v8a8 8 0 0 1-16 0z" />
      <circle cx="9" cy="10" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="10" r="1" fill="currentColor" stroke="none" />
      <path d="M9 14c1 1 5 1 6 0" />
    </svg>
  );
}

export function BookOpenIcon(p: IconProps) {
  return (
    <svg {...stroke(p.size ?? 14, 1.6)} {...p}>
      <path d="M3 5h7a3 3 0 0 1 3 3v11a2 2 0 0 0-2-2H3z" />
      <path d="M21 5h-7a3 3 0 0 0-3 3v11a2 2 0 0 1 2-2h8z" />
    </svg>
  );
}

export function FilmIcon(p: IconProps) {
  return (
    <svg {...stroke(p.size ?? 14, 1.6)} {...p}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h4M3 15h4M17 9h4M17 15h4M8 4v16M16 4v16" />
    </svg>
  );
}

export function MapPinIcon(p: IconProps) {
  return (
    <svg {...stroke(p.size ?? 14, 1.6)} {...p}>
      <path d="M12 21s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12z" />
      <circle cx="12" cy="9" r="2.5" />
    </svg>
  );
}

export function BranchIcon(p: IconProps) {
  return (
    <svg {...stroke(p.size ?? 14, 1.6)} {...p}>
      <circle cx="6" cy="5" r="2" />
      <circle cx="6" cy="19" r="2" />
      <circle cx="18" cy="12" r="2" />
      <path d="M6 7v10M8 12h8" />
    </svg>
  );
}

export function PlayIcon(p: IconProps) {
  return (
    <svg
      width={p.size ?? 13}
      height={p.size ?? 13}
      viewBox="0 0 24 24"
      fill="currentColor"
      {...p}
    >
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

export function ChapterIcon(p: IconProps) {
  return (
    <svg {...stroke(p.size ?? 14, 1.6)} {...p}>
      <path d="M4 4h12a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4z" />
      <path d="M8 8h8M8 12h6" />
    </svg>
  );
}

export function SceneIcon(p: IconProps) {
  return (
    <svg {...stroke(p.size ?? 14, 1.6)} {...p}>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18" />
    </svg>
  );
}

export function BlockIcon(p: IconProps) {
  return (
    <svg {...stroke(p.size ?? 14, 1.6)} {...p}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M9 9h6v6H9z" />
    </svg>
  );
}

export function PaletteIcon(p: IconProps) {
  return (
    <svg {...stroke(p.size ?? 14, 1.6)} {...p}>
      <path d="M12 3a9 9 0 1 0 0 18c1.5 0 2-1 2-2s-1-1-1-2 1-1 2-1h2a4 4 0 0 0 4-4c0-5-4-9-9-9z" />
      <circle cx="7.5" cy="10.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="11" cy="7" r="1" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="8.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function StatsIcon(p: IconProps) {
  return (
    <svg {...stroke(p.size ?? 13, 1.8)} {...p}>
      <path d="M4 20V10M10 20V4M16 20v-8M22 20H2" />
    </svg>
  );
}

export function ExportIcon(p: IconProps) {
  return (
    <svg {...stroke(p.size ?? 13, 1.8)} {...p}>
      <path d="M12 3v12M7 8l5-5 5 5" />
      <path d="M5 21h14a2 2 0 0 0 2-2v-4H3v4a2 2 0 0 0 2 2z" />
    </svg>
  );
}
