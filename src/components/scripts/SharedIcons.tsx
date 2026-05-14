import type { ComponentType, SVGProps } from "react";
import {
  Bars3Icon,
  Bars3BottomLeftIcon,
  CalendarIcon,
  ChatBubbleLeftEllipsisIcon,
  ChatBubbleLeftRightIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  ClockIcon as HClockIcon,
  CodeBracketIcon,
  DocumentTextIcon,
  EllipsisVerticalIcon,
  FolderIcon as HFolderIcon,
  H2Icon,
  InformationCircleIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  ShareIcon as HShareIcon,
  Squares2X2Icon,
  StarIcon as HStarIcon,
  TableCellsIcon,
  TagIcon as HTagIcon,
  UserIcon,
  UsersIcon,
} from "@heroicons/react/24/solid";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

/**
 * Wraps a Heroicons component as a `{ size }` -aware glyph. Default 16px
 * matches the legacy stroke() helper this file used to ship before the
 * migration to Heroicons/Solid. Per-call-site sizes (e.g. 9px chevron in
 * tree rows) are preserved via the second arg.
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

// -- Tree / list glyphs -----------------------------------------------------

export const ChevRight = wrap(ChevronRightIcon, 9);
export const StarIcon = wrap(HStarIcon);
export const DocSmall = wrap(DocumentTextIcon);
export const FolderSmall = wrap(HFolderIcon);
export const MenuLines = wrap(Bars3Icon, 14);
export const PlusBold = wrap(PlusIcon, 14);
export const SearchSmall = wrap(MagnifyingGlassIcon, 13);

// -- Card-detail / metadata glyphs ------------------------------------------

export const ClockIcon = wrap(HClockIcon, 13);
export const PersonIcon = wrap(UserIcon, 13);
export const PeopleIcon = wrap(UsersIcon, 13);
export const CalendarSmall = wrap(CalendarIcon, 13);
export const ClockEditedIcon = wrap(HClockIcon, 13);
export const TagIcon = wrap(HTagIcon, 13);
export const ShareIcon = wrap(HShareIcon, 14);
export const FlowIcon = wrap(ChatBubbleLeftRightIcon, 14);
export const MoreVIcon = wrap(EllipsisVerticalIcon, 14);
export const InfoCircle = wrap(InformationCircleIcon, 18);
export const QuoteIcon = wrap(ChatBubbleLeftEllipsisIcon, 18);

// -- Editor gutter glyphs ---------------------------------------------------

export const GutterPlus = wrap(PlusIcon, 12);
export const GutterDrag = wrap(EllipsisVerticalIcon, 12);

// -- Slash menu glyphs ------------------------------------------------------

export const SlashText = wrap(Bars3BottomLeftIcon, 13);
export const SlashH2 = wrap(H2Icon, 13);
export const SlashTodo = wrap(CheckCircleIcon, 13);
export const SlashCode = wrap(CodeBracketIcon, 13);
export const SlashTable = wrap(TableCellsIcon, 13);
export const SlashCallout = wrap(InformationCircleIcon, 13);
// SlashGrid kept for completeness in case other slash menus reach for it.
export const SlashGrid = wrap(Squares2X2Icon, 13);
