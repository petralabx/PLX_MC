// Lucide icons for the nav surfaces (design system: Lucide at small size,
// currentColor). Named imports only, so the bundle carries these icons and not
// the whole set. nav-model.ts names them; this file is the one place that maps
// a name to a component. Icons are decorative: the label beside (or the
// visually hidden .nm inside) the control carries the accessible name.
import {
  Activity,
  BookOpen,
  CalendarRange,
  ChartPie,
  CircleDollarSign,
  CircleHelp,
  CircleUser,
  ClipboardList,
  Ellipsis,
  File,
  FileText,
  GitBranch,
  Grid3x3,
  House,
  Inbox,
  List,
  Network,
  Radio,
  RefreshCw,
  Route,
  SquareCheck,
  SquareKanban,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import type { NavIconName } from "./nav-model";

const NAV_ICONS: Record<NavIconName, LucideIcon> = {
  Activity,
  BookOpen,
  CalendarRange,
  ChartPie,
  CircleDollarSign,
  CircleHelp,
  CircleUser,
  ClipboardList,
  Ellipsis,
  File,
  FileText,
  GitBranch,
  Grid3x3,
  House,
  Inbox,
  List,
  Network,
  Radio,
  RefreshCw,
  Route,
  SquareCheck,
  SquareKanban,
  Wrench,
};

export function NavIcon({ name }: { name: NavIconName }) {
  const Icon = NAV_ICONS[name];
  return <Icon className="ic" aria-hidden="true" focusable="false" strokeWidth={1.5} />;
}
