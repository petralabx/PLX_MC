// Project Documents library sync increment (TASK-628) — pure driveItem →
// FileEntry mapping. Inbound-only mirror: SharePoint is authoritative for the
// document library; MC never pushes files. Deletions are audited and skipped
// (no destructive mirror deletes in this increment).

import type { Bucket, DocType, FileEntry, FileKind } from "@/lib/mc-data/types";

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

// Library layout (SHAREPOINT_INTEGRATION §3.6): /{Initiative}/{PRD|Evidence|
// Deeds|Reports}/…, plus a top-level /Shared. The link is derived from the
// folder path + file name only — no new column or SharePoint metadata.
const DOC_TYPE_FOLDERS: Record<string, DocType> = {
  prd: "PRD",
  evidence: "Evidence",
  deeds: "Deed",
  deed: "Deed",
  reports: "Report",
  report: "Report",
};

const TASK_ID_RE = /\bTASK-\d+\b/i;

export interface DocumentLink {
  bucket?: string;
  docType?: DocType;
  task?: string;
}

export interface FolderRef {
  name: string;
  parent: string | null; // parent driveItem id
}

/**
 * Folder segments of the item's parent, relative to the drive root. Graph's
 * drive *delta* omits `parentReference.path`, so ancestry is resolved by
 * walking `parentReference.id` through known folders (the mirrored folder
 * rows plus this delta batch). A path, when present, wins. Returns null when
 * the chain cannot be resolved to the drive root — callers then leave the
 * file unlinked rather than guess an initiative.
 */
export function parentSegments(
  item: DriveItem,
  folders: ReadonlyMap<string, FolderRef> = new Map(),
  rootId?: string | null
): string[] | null {
  const path = item.parentReference?.path;
  if (path && path.includes("root:")) {
    return path
      .slice(path.indexOf("root:") + 5)
      .split("/")
      .map((s) => decodeURIComponent(s).trim())
      .filter(Boolean);
  }
  const segments: string[] = [];
  let id = item.parentReference?.id;
  for (let depth = 0; id && depth < 32; depth += 1) {
    if (id === rootId) return segments;
    const folder = folders.get(id);
    if (!folder) return null;
    segments.unshift(folder.name);
    id = folder.parent ?? undefined;
  }
  return null;
}

/**
 * Derive the initiative (bucket), document type, and task a library file
 * belongs to. Initiative = first folder segment matching a bucket id (or a
 * `BKT-*` token inside it) or bucket name; type = second segment; task = a
 * `TASK-n` token in the file name or any folder segment. Folders and files
 * outside an initiative folder (e.g. /Shared) carry no link.
 */
export function documentLinkFor(
  item: DriveItem,
  buckets: Pick<Bucket, "id" | "name">[],
  segments: string[] | null = parentSegments(item)
): DocumentLink {
  if (item.folder || !segments) return {};
  const [initiative, typeFolder, ...rest] = segments;
  const link: DocumentLink = {};
  if (initiative) {
    const needle = initiative.toLowerCase();
    const hit = buckets.find(
      (b) => needle === b.id.toLowerCase() || needle.split(/[^a-z0-9-]+/).includes(b.id.toLowerCase()) || needle === b.name.trim().toLowerCase()
    );
    if (hit) {
      link.bucket = hit.id;
      const docType = typeFolder ? DOC_TYPE_FOLDERS[typeFolder.toLowerCase()] : undefined;
      if (docType) link.docType = docType;
      const task = [item.name ?? "", ...rest, typeFolder ?? ""].map((s) => TASK_ID_RE.exec(s)?.[0]).find(Boolean);
      if (task) link.task = task.toUpperCase();
    }
  }
  return link;
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
export function fileEntryFromDriveItem(
  item: DriveItem,
  buckets: Pick<Bucket, "id" | "name">[] = [],
  segments?: string[] | null
): FileEntry | null {
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
    ...(segments === undefined ? documentLinkFor(item, buckets) : documentLinkFor(item, buckets, segments)),
    ...(item.webUrl ? { webUrl: item.webUrl } : {}),
    sync: {
      state: "synced",
      ts: item.lastModifiedDateTime ?? new Date().toISOString(),
      sp: "Project Documents",
    },
  };
}
