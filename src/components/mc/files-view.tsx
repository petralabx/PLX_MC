"use client";

import { Fragment, useMemo, useState } from "react";

import { useMcVersion } from "@/lib/mc-data/hooks";
import { allFiles, bucketById, fileById, filesIn, markAllSynced } from "@/lib/mc-data/store";

import { Avatar, SyncTick } from "./atoms";
import { buildBreadcrumbPath, sortFileEntries } from "./record-logic";

const FILE_KIND_LABEL: Record<string, string> = {
  folder: "DIR",
  doc: "DOC",
  pdf: "PDF",
  sheet: "XLS",
  img: "IMG",
  zip: "ZIP",
  md: "MD",
};

export function FilesView() {
  useMcVersion();
  const [folderId, setFolderId] = useState<string | null>(null);
  const pendingCount = allFiles().filter((entry) => entry.sync?.state === "pending").length;
  const items = useMemo(() => sortFileEntries(filesIn(folderId)), [folderId]);
  const breadcrumbs = useMemo(() => buildBreadcrumbPath(folderId, fileById), [folderId]);

  return (
    <div className="mc-main">
      <div className="ph">
        <div>
          <span className="kk">System of record · Project Documents</span>
          <h1>Files</h1>
          <p className="sub">
            The shared document library — PRDs, evidence bundles, sealed deeds, and reports.
            Mirrors two-way with the SharePoint Project Documents library.
          </p>
        </div>
        <div className="r">
          <a className="splink" href="#" onClick={(event) => event.preventDefault()}>
            Open in SharePoint ↗
          </a>
          <button
            type="button"
            className="btn acc"
            disabled={pendingCount === 0}
            onClick={() => markAllSynced()}
          >
            {pendingCount > 0 ? `Sync now ↻ · ${pendingCount}` : "Synced ✓"}
          </button>
        </div>
      </div>

      <div className="files">
        <div className="fcrumbs">
          <button type="button" className={`cb${folderId === null ? " on" : ""}`} onClick={() => setFolderId(null)}>
            Project Documents
          </button>
          {breadcrumbs.map((crumb) => (
            <Fragment key={crumb.id}>
              <span className="sep">/</span>
              <button
                type="button"
                className={`cb${crumb.id === folderId ? " on" : ""}`}
                onClick={() => setFolderId(crumb.id)}
              >
                {crumb.name}
              </button>
            </Fragment>
          ))}
          <span className="fcount">
            {items.length} item{items.length === 1 ? "" : "s"}
          </span>
        </div>

        <div className="ftable">
          <div className="frow head">
            <span className="h">Name</span>
            <span className="h">Type</span>
            <span className="h">Modified</span>
            <span className="h">Modified By</span>
            <span className="h">Sync</span>
          </div>
          {items.length === 0 && <div className="colempty">Empty folder</div>}
          {items.map((entry) => {
            const health = entry.bucket ? bucketById(entry.bucket)?.health : undefined;
            const childCount = entry.kind === "folder" ? filesIn(entry.id).length : 0;
            // Folders are <button>s (keyboard-accessible drill-down); files are static rows.
            const Row = entry.kind === "folder" ? "button" : "div";
            return (
              <Row
                {...(entry.kind === "folder" ? { type: "button" as const } : {})}
                className={`frow${entry.kind === "folder" ? " isfolder" : ""}`}
                key={entry.id}
                onClick={() => entry.kind === "folder" && setFolderId(entry.id)}
              >
                <span className="nm">
                  <span className={`fk k-${entry.kind}`}>{FILE_KIND_LABEL[entry.kind] ?? "FILE"}</span>
                  <span className="t">{entry.name}</span>
                  {entry.kind === "folder" && health && <span className={`binit ${health}`} />}
                </span>
                <span className="ty">{entry.kind === "folder" ? "Folder" : (entry.docType ?? "—")}</span>
                <span className="md">{entry.modified ?? "—"}</span>
                <span className="by">
                  {entry.modifiedBy ? (
                    <Avatar id={entry.modifiedBy} size="sm" />
                  ) : (
                    <span className="fmuted">—</span>
                  )}
                </span>
                <span className="sy">
                  {entry.sync ? (
                    <SyncTick sync={entry.sync} showTs={false} />
                  ) : (
                    entry.kind === "folder" && <span className="folderdir">{childCount} items</span>
                  )}
                </span>
              </Row>
            );
          })}
        </div>
      </div>
    </div>
  );
}
