// Project Documents library sync increment (TASK-628) — pure driveItem →
// FileEntry mapping. Inbound-only mirror: SharePoint is authoritative for the
// document library; MC never pushes files. Deletions are audited and skipped
// (no destructive mirror deletes in this increment).

import type { FileEntry, FileKind } from "@/lib/mc-data/types";

export interface DriveItem {
  id: string;
  name?: string;
  folder?: object;
  file?: { mimeType?: string };
  deleted?: { state?: string };
  size?: number;
  webUrl?: string;
  lastModifiedDateTime?: string;
  lastModifiedBy?: { user?: { displayName?: string } };
  parentReference?: { id?: string; path?: string };
}

export function fileEntryIdForDriveItem(driveItemId: string): string {
  return `file-sp-${driveItemId}`;
}

export function fileKindFor(name: string, isFolder: boolean): FileKind {
  if (isFolder) return "folder";
  const ext = name.includes(".") ? name.toLowerCase().split(".").pop()! : "";
  switch (ext) {
    case "pdf":
      return "pdf";
    case "xlsx":
    case "xls":
    case "csv":
      return "sheet";
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "svg":
      return "img";
    case "zip":
    case "7z":
    case "gz":
      return "zip";
    case "md":
      return "md";
    default:
      return "doc";
  }
}

export function humanFileSize(bytes: number | undefined): string | undefined {
  if (bytes == null || !Number.isFinite(bytes)) return undefined;
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/**
 * Map a Graph driveItem to the FileEntry mirror shape. Returns null for
 * deleted items (the caller audits + skips) and items without a usable name.
 */
export function fileEntryFromDriveItem(item: DriveItem): FileEntry | null {
  if (item.deleted) return null;
  const name = item.name?.trim();
  if (!name) return null;
  const isFolder = !!item.folder;
  const parentId = item.parentReference?.id;
  return {
    id: fileEntryIdForDriveItem(item.id),
    name,
    kind: fileKindFor(name, isFolder),
    parent: parentId ? fileEntryIdForDriveItem(parentId) : null,
    modified: item.lastModifiedDateTime,
    modifiedBy: item.lastModifiedBy?.user?.displayName,
    size: isFolder ? undefined : humanFileSize(item.size),
    sync: {
      state: "synced",
      ts: item.lastModifiedDateTime ?? new Date().toISOString(),
      sp: "Project Documents",
    },
  };
}
