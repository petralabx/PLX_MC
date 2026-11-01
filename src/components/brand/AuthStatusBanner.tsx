import * as React from "react";

import { cn } from "@/lib/utils/utils";

export type AuthStatusTone = "success" | "info" | "warning" | "danger";

export type AuthStatusBannerProps = React.HTMLAttributes<HTMLDivElement> & {
  tone: AuthStatusTone;
  title?: string;
};

const toneClassName: Record<AuthStatusTone, string> = {
  danger:
    "border-[var(--p-hot)] bg-[var(--p-paper-2)] text-[var(--p-hot-text)]",
  info:
    "border-[var(--p-info)] bg-[var(--p-paper-2)] text-[var(--p-info-text)]",
  success:
    "border-[var(--p-ok)] bg-[var(--p-paper-2)] text-[var(--p-ok-text)]",
  warning:
    "border-[var(--p-warn)] bg-[var(--p-paper-2)] text-[var(--p-warn-text)]",
};

export function AuthStatusBanner({
  children,
  className,
  title,
  tone,
  ...props
}: AuthStatusBannerProps) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "border px-4 py-3 text-sm leading-relaxed",
        "font-sans shadow-none",
        toneClassName[tone],
        className
      )}
      {...props}
    >
      {title ? (
        <div className="p-kicker mb-1 text-current">{title}</div>
      ) : null}
      <div className="text-[var(--p-ink-2)]">{children}</div>
    </div>
  );
}
