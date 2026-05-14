import type { ComponentType, SVGProps } from "react";
import {
  BellIcon,
  CalendarIcon,
  Cog6ToothIcon,
  DocumentTextIcon,
  EnvelopeIcon,
  PhotoIcon,
  ShareIcon,
  Squares2X2Icon,
  UsersIcon,
} from "@heroicons/react/24/solid";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

/**
 * Wraps a Heroicons component as a `{ size }` -aware glyph so we can drop
 * it into existing call sites without touching prop shapes. Default 16px
 * matches the legacy `filled()` helper this file used to ship before the
 * migration to Heroicons/Solid.
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

export const CategoryFilledIcon = wrap(Squares2X2Icon);
export const CalendarFilledIcon = wrap(CalendarIcon);
export const DocumentFilledIcon = wrap(DocumentTextIcon);
export const ImageFilledIcon = wrap(PhotoIcon);
export const UsersFilledIcon = wrap(UsersIcon);
export const MailFilledIcon = wrap(EnvelopeIcon);
export const BellFilledIcon = wrap(BellIcon);
export const ShareFilledIcon = wrap(ShareIcon);
export const SettingsFilledIcon = wrap(Cog6ToothIcon, 22);
