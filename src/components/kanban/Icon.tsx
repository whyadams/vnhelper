import type { ComponentType, SVGProps } from "react";
import {
  ArrowDownTrayIcon,
  ArrowsUpDownIcon,
  ArrowUpTrayIcon,
  BoltIcon as HBoltIcon,
  BriefcaseIcon,
  CalendarIcon as HCalendarIcon,
  ChartBarIcon,
  ChatBubbleLeftIcon,
  ChevronDownIcon as HChevronDownIcon,
  ChevronLeftIcon as HChevronLeftIcon,
  ChevronRightIcon as HChevronRightIcon,
  ClipboardDocumentCheckIcon,
  CreditCardIcon,
  CurrencyDollarIcon,
  DocumentDuplicateIcon,
  DocumentIcon,
  DocumentTextIcon,
  EllipsisHorizontalIcon,
  FolderIcon as HFolderIcon,
  FunnelIcon,
  HomeIcon as HHomeIcon,
  LinkIcon as HLinkIcon,
  MagnifyingGlassIcon,
  PhotoIcon,
  PlusIcon as HPlusIcon,
  ShareIcon,
  TrashIcon as HTrashIcon,
  UserPlusIcon,
  UsersIcon as HUsersIcon,
  XMarkIcon,
} from "@heroicons/react/24/solid";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

/**
 * Wraps a Heroicons component as a `{ size }` -aware glyph so call sites
 * that pass `size={14}` keep working without churn. Default 16px matches
 * the legacy stroke() helper this file used to ship before the migration.
 */
function wrap(
  Icon: ComponentType<SVGProps<SVGSVGElement>>,
  defaultSize = 16,
) {
  return function WrappedIcon(p: IconProps) {
    const { size = defaultSize, style, ...rest } = p;
    return (
      <Icon
        style={{ width: size, height: size, ...style }}
        {...rest}
      />
    );
  };
}

// -- Navigation glyphs ------------------------------------------------------

export const HomeIcon = wrap(HHomeIcon);
export const TaskIcon = wrap(ClipboardDocumentCheckIcon);
export const CalendarIcon = wrap(HCalendarIcon);
export const NotesIcon = wrap(DocumentTextIcon);
export const GitForkIcon = wrap(ShareIcon);
export const ScriptIcon = wrap(DocumentIcon);
export const DocsIcon = wrap(DocumentDuplicateIcon);
export const ReportsIcon = wrap(ChartBarIcon);
export const PaymentsIcon = wrap(CreditCardIcon);
export const UsersIcon = wrap(HUsersIcon);
export const AutomationsIcon = wrap(HBoltIcon);
export const SalesIcon = wrap(CurrencyDollarIcon);
export const RecruitingIcon = wrap(UserPlusIcon);
export const HRIcon = wrap(BriefcaseIcon);
export const PhotosIcon = wrap(PhotoIcon);

// -- Generic UI glyphs ------------------------------------------------------

export const SearchIcon = wrap(MagnifyingGlassIcon);
export const PlusIcon = wrap(HPlusIcon);
export const ChevronDownIcon = wrap(HChevronDownIcon);
export const ChevronLeftIcon = wrap(HChevronLeftIcon);
export const ChevronRightIcon = wrap(HChevronRightIcon);
export const FilterIcon = wrap(FunnelIcon);
export const SortIcon = wrap(ArrowsUpDownIcon);
export const BoltIcon = wrap(HBoltIcon);
export const MoreHIcon = wrap(EllipsisHorizontalIcon);
export const FolderIcon = wrap(HFolderIcon);
export const LinkIcon = wrap(HLinkIcon);
export const CommentIcon = wrap(ChatBubbleLeftIcon);
export const UploadIcon = wrap(ArrowUpTrayIcon, 14);
export const TrashIcon = wrap(HTrashIcon, 14);
export const DownloadIcon = wrap(ArrowDownTrayIcon, 14);
export const CloseIcon = wrap(XMarkIcon, 14);

// -- Brand glyphs -----------------------------------------------------------
// Heroicons doesn't ship brand logos, so these stay as custom SVG. Kept
// here so the existing call sites continue to compile; visually distinct
// from the Heroicons set on purpose (brands carry their own identity).

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
