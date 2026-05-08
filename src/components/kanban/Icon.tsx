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

export function HomeIcon(p: IconProps) {
  return (
    <svg {...stroke(p.size)} {...p}>
      <path d="M3 11l9-8 9 8v9a2 2 0 0 1-2 2h-4v-7h-6v7H5a2 2 0 0 1-2-2v-9z" />
    </svg>
  );
}

export function TaskIcon(p: IconProps) {
  return (
    <svg {...stroke(p.size)} {...p}>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="14" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  );
}

export function CalendarIcon(p: IconProps) {
  return (
    <svg {...stroke(p.size)} {...p}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 9h18M8 3v4M16 3v4" />
    </svg>
  );
}

export function NotesIcon(p: IconProps) {
  return (
    <svg {...stroke(p.size)} {...p}>
      <path d="M5 4h11l3 3v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
      <path d="M14 4v4h4" />
    </svg>
  );
}

export function GitForkIcon(p: IconProps) {
  return (
    <svg {...stroke(p.size)} {...p}>
      <circle cx="12" cy="18" r="3" />
      <circle cx="6" cy="6" r="3" />
      <circle cx="18" cy="6" r="3" />
      <path d="M18 9v1a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9" />
      <path d="M12 12v3" />
    </svg>
  );
}

export function ScriptIcon(p: IconProps) {
  return (
    <svg {...stroke(p.size)} {...p}>
      <path d="M5 4h11l3 3v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
      <path d="M14 4v4h4" />
      <path d="M8 12h8M8 16h6" />
    </svg>
  );
}

export function DocsIcon(p: IconProps) {
  return (
    <svg {...stroke(p.size)} {...p}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M9 13h6M9 17h6" />
    </svg>
  );
}

export function ReportsIcon(p: IconProps) {
  return (
    <svg {...stroke(p.size)} {...p}>
      <path d="M3 21V8m6 13V3m6 18v-9m6 9v-5" />
    </svg>
  );
}

export function PaymentsIcon(p: IconProps) {
  return (
    <svg {...stroke(p.size)} {...p}>
      <rect x="2" y="6" width="20" height="13" rx="2" />
      <path d="M2 11h20M6 16h4" />
    </svg>
  );
}

export function UsersIcon(p: IconProps) {
  return (
    <svg {...stroke(p.size)} {...p}>
      <circle cx="9" cy="8" r="3.5" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M3 19c.5-3 3-5 6-5s5.5 2 6 5M14 19c0-2 1.5-3.5 3-3.5s3 1.5 3 3.5" />
    </svg>
  );
}

export function AutomationsIcon(p: IconProps) {
  return (
    <svg {...stroke(p.size)} {...p}>
      <path d="M12 2v6M12 16v6M4 12H2M22 12h-2M5 5l1.5 1.5M19 19l-1.5-1.5M5 19l1.5-1.5M19 5l-1.5 1.5" />
      <circle cx="12" cy="12" r="4" />
    </svg>
  );
}

export function SalesIcon(p: IconProps) {
  return (
    <svg {...stroke(p.size)} {...p}>
      <path d="M2 12c2-1 4-1 6 0M2 17c2-1 4-1 6 0M2 7c2-1 4-1 6 0" />
      <circle cx="18" cy="12" r="3" />
      <path d="M21 21l-1.5-1.5" />
    </svg>
  );
}

export function RecruitingIcon(p: IconProps) {
  return (
    <svg {...stroke(p.size)} {...p}>
      <path d="M16 11V7a4 4 0 1 0-8 0v4M5 11h14v10H5z" />
    </svg>
  );
}

export function HRIcon(p: IconProps) {
  return (
    <svg {...stroke(p.size)} {...p}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
    </svg>
  );
}

export function SearchIcon(p: IconProps) {
  return (
    <svg {...stroke(p.size ?? 14, 2)} {...p}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}

export function PlusIcon(p: IconProps) {
  return (
    <svg {...stroke(p.size ?? 14, 2)} {...p}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function ChevronDownIcon(p: IconProps) {
  return (
    <svg {...stroke(p.size ?? 10, 2.5)} {...p}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function FilterIcon(p: IconProps) {
  return (
    <svg {...stroke(p.size ?? 14)} {...p}>
      <path d="M3 6h18M6 12h12M10 18h4" />
    </svg>
  );
}

export function SortIcon(p: IconProps) {
  return (
    <svg {...stroke(p.size ?? 14)} {...p}>
      <path d="M3 7h18M7 12h10M11 17h2" />
    </svg>
  );
}

export function BoltIcon(p: IconProps) {
  return (
    <svg {...stroke(p.size ?? 14)} {...p}>
      <path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" />
    </svg>
  );
}

export function MoreHIcon(p: IconProps) {
  return (
    <svg
      width={p.size ?? 14}
      height={p.size ?? 14}
      viewBox="0 0 24 24"
      fill="currentColor"
      {...p}
    >
      <circle cx="5" cy="12" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="19" cy="12" r="1.5" />
    </svg>
  );
}

export function FolderIcon(p: IconProps) {
  return (
    <svg {...stroke(p.size ?? 13)} {...p}>
      <path d="M3 7l2-3h4l2 3h10v13H3V7z" />
    </svg>
  );
}

export function LinkIcon(p: IconProps) {
  return (
    <svg {...stroke(p.size ?? 13)} {...p}>
      <path d="M10 14a4 4 0 0 0 4 4l3-3M14 10a4 4 0 0 0-4-4L7 9M8 16l8-8" />
    </svg>
  );
}

export function CommentIcon(p: IconProps) {
  return (
    <svg {...stroke(p.size ?? 13)} {...p}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

/* Rail / brand glyphs */

export function ZapierGlyph(p: IconProps) {
  return (
    <svg
      width={p.size ?? 18}
      height={p.size ?? 18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      {...p}
    >
      <path d="M12 2v6m0 8v6M2 12h6m8 0h6M5.6 5.6l4.2 4.2m4.4 4.4l4.2 4.2M5.6 18.4l4.2-4.2m4.4-4.4l4.2-4.2" />
    </svg>
  );
}

export function NotionGlyph(p: IconProps) {
  return (
    <svg
      width={p.size ?? 18}
      height={p.size ?? 18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      {...p}
    >
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M9 7v10M9 7l6 10M15 7v10" />
    </svg>
  );
}

export function SlackGlyph(p: IconProps) {
  return (
    <svg
      width={p.size ?? 18}
      height={p.size ?? 18}
      viewBox="0 0 24 24"
      fill="currentColor"
      {...p}
    >
      <circle cx="9" cy="9" r="2" />
      <circle cx="15" cy="15" r="2" />
      <circle cx="15" cy="9" r="2" />
      <circle cx="9" cy="15" r="2" />
    </svg>
  );
}

export function StripeGlyph(p: IconProps) {
  return (
    <svg
      width={p.size ?? 18}
      height={p.size ?? 18}
      viewBox="0 0 24 24"
      fill="currentColor"
      {...p}
    >
      <path d="M13 8c0-1 1-1.5 2.5-1.5S19 7.5 19 9h3c0-2.5-2-4.5-6.5-4.5S9 6.5 9 9c0 4 9 3.5 9 5.5 0 1.2-1 1.7-2.7 1.7-2 0-3.3-1-3.3-2.5H9c0 3 2.7 5 6.5 5S22 16.7 22 14c0-4-9-3.5-9-6Z" />
    </svg>
  );
}

export function SpotifyGlyph(p: IconProps) {
  return (
    <svg
      width={p.size ?? 18}
      height={p.size ?? 18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      {...p}
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M7 9c4-1 8-1 12 1M8 13c3-1 7-1 10 1M9 17c2-1 5-1 7 0" />
    </svg>
  );
}

/* Card brand mini-glyphs */

export function ZendeskMini(p: IconProps) {
  return (
    <svg
      width={p.size ?? 13}
      height={p.size ?? 13}
      viewBox="0 0 24 24"
      fill="currentColor"
      {...p}
    >
      <path d="M3 6h18l-9 12L3 6z" />
    </svg>
  );
}

export function DropboxMini(p: IconProps) {
  return (
    <svg
      width={p.size ?? 13}
      height={p.size ?? 13}
      viewBox="0 0 24 24"
      fill="currentColor"
      {...p}
    >
      <path d="M6 4l6 4-6 4-6-4 6-4zm12 0l6 4-6 4-6-4 6-4zM6 12l6 4-6 4-6-4 6-4zm12 0l6 4-6 4-6-4 6-4z" />
    </svg>
  );
}

export function LoomMini(p: IconProps) {
  return (
    <svg
      width={p.size ?? 13}
      height={p.size ?? 13}
      viewBox="0 0 24 24"
      fill="currentColor"
      {...p}
    >
      <circle cx="12" cy="12" r="3" />
      <path
        d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l3 3M16 16l3 3M5 19l3-3M16 8l3-3"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

export function PhotosIcon(p: IconProps) {
  return (
    <svg {...stroke(p.size)} {...p}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="2" />
      <path d="M3 17l5-5 4 4 3-3 6 6" />
    </svg>
  );
}

export function UploadIcon(p: IconProps) {
  return (
    <svg {...stroke(p.size ?? 14, 2)} {...p}>
      <path d="M12 16V4M6 10l6-6 6 6M4 20h16" />
    </svg>
  );
}

export function TrashIcon(p: IconProps) {
  return (
    <svg {...stroke(p.size ?? 14, 1.8)} {...p}>
      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14M10 11v6M14 11v6" />
    </svg>
  );
}

export function DownloadIcon(p: IconProps) {
  return (
    <svg {...stroke(p.size ?? 14, 1.8)} {...p}>
      <path d="M12 4v12M6 10l6 6 6-6M4 20h16" />
    </svg>
  );
}

export function ChevronLeftIcon(p: IconProps) {
  return (
    <svg {...stroke(p.size ?? 16, 2)} {...p}>
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

export function ChevronRightIcon(p: IconProps) {
  return (
    <svg {...stroke(p.size ?? 16, 2)} {...p}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function CloseIcon(p: IconProps) {
  return (
    <svg {...stroke(p.size ?? 14, 2)} {...p}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function NotionMini(p: IconProps) {
  return (
    <svg
      width={p.size ?? 13}
      height={p.size ?? 13}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      {...p}
    >
      <path d="M5 3h12l4 4v14H5z" />
      <path d="M9 8v8M9 8l5 8M14 8v8" />
    </svg>
  );
}
