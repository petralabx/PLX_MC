"use client";

// Mission Control text (TASK-4390): a description, status note or approval
// summary written as plain text with a little markdown, shown with its
// structure and its references as links. The formatting reference:
//   - a blank line starts a paragraph; a single line break stays one
//   - a bold start names the paragraph's topic; a line that is only bold is a section heading
//   - dashes, numbers and [ ] boxes make lists and checklists
//   - TASK, PRJ, BKT and DRF ids and gate ids open inside Mission Control (a
//     full Mission Control URL collapses to its chip); owner/repo#N and GitHub
//     pull-request URLs show their short name; other URLs show host and path end
//   - backticks mark code
// Parsing is src/lib/mc-text (a token tree); React escapes every string, and
// a link renders only for http(s) or mailto, so no source can inject markup.

import { useMemo, type ReactNode } from "react";

import { parseMcText, splitRefs, type McRef, type MdInline, type MdNode } from "@/lib/mc-text";

import { isPlainLeftClick, navHref } from "./nav-model";
import { urlToRoute, type Nav, type Route } from "./route";

type InApp = Exclude<McRef, { kind: "text" } | { kind: "pr" } | { kind: "url" }>;

/** Where an in-app reference opens. */
function refRoute(ref: InApp): Route {
  switch (ref.kind) {
    case "task":
      return { screen: "task", taskId: ref.id };
    case "project":
      return { screen: "project", projectId: ref.id };
    case "bucket":
      return { screen: "bucket", bucketId: ref.id };
    case "draft":
      return { screen: "drafts", draftId: ref.id };
    case "gate":
      return { screen: "approvals", gate: ref.id };
  }
}

/** Only these schemes render as links; anything else (javascript:, data:) stays text. */
function safeHref(href: string): string | null {
  try {
    const url = new URL(href);
    return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function Ref({ refItem, nav }: { refItem: McRef; nav: Nav }) {
  switch (refItem.kind) {
    case "text":
      return <>{refItem.value}</>;
    case "pr":
      return (
        <a className="mct-link" href={refItem.href} target="_blank" rel="noopener noreferrer" title={`${refItem.repo}#${refItem.number}`}>
          {refItem.label}
        </a>
      );
    case "url":
      return (
        <a className="mct-link" href={refItem.href} target="_blank" rel="noopener noreferrer" title={refItem.href}>
          {refItem.label}
        </a>
      );
    default: {
      const route = refRoute(refItem);
      const { screen, ...extra } = route;
      return (
        <a
          className="mct-chip"
          href={navHref(route)}
          title={refItem.kind === "gate" ? refItem.id : undefined}
          onClick={(event) => {
            if (!isPlainLeftClick(event)) return;
            event.preventDefault();
            nav(screen, extra);
          }}
        >
          {refItem.kind === "gate" ? refItem.label : refItem.id}
        </a>
      );
    }
  }
}

/** A relative Mission Control link ("/?screen=task&taskId=TASK-1"): its route, else null. */
function inAppRoute(href: string): Route | null {
  return href.startsWith("/") && !href.startsWith("//") ? urlToRoute(href) : null;
}

/** `inLink`: inside a markdown link's label, where text stays text (a reference there would nest a link in a link). */
function Inline({ nodes, nav, inLink = false }: { nodes: MdInline[]; nav: Nav; inLink?: boolean }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.type) {
          case "text":
            return inLink ? n.value : splitRefs(n.value).map((r, j) => <Ref key={`${i}-${j}`} refItem={r} nav={nav} />);
          case "strong":
            return (
              <strong key={i}>
                <Inline nodes={n.children} nav={nav} inLink={inLink} />
              </strong>
            );
          case "em":
            return (
              <em key={i}>
                <Inline nodes={n.children} nav={nav} inLink={inLink} />
              </em>
            );
          case "code":
            return <code key={i}>{n.value}</code>;
          case "link": {
            if (inLink) return <Inline key={i} nodes={n.children} nav={nav} inLink />;
            const route = inAppRoute(n.href);
            if (route) {
              const { screen, ...extra } = route;
              return (
                <a
                  key={i}
                  className="mct-link"
                  href={navHref(route)}
                  onClick={(event) => {
                    if (!isPlainLeftClick(event)) return;
                    event.preventDefault();
                    nav(screen, extra);
                  }}
                >
                  <Inline nodes={n.children} nav={nav} inLink />
                </a>
              );
            }
            const href = safeHref(n.href);
            return href ? (
              <a key={i} className="mct-link" href={href} target="_blank" rel="noopener noreferrer">
                <Inline nodes={n.children} nav={nav} inLink />
              </a>
            ) : (
              <Inline key={i} nodes={n.children} nav={nav} inLink />
            );
          }
        }
      })}
    </>
  );
}

/** A paragraph that is only bold text: a section heading in the writer's own words. */
const boldOnly = (text: MdInline[]) => text.length === 1 && text[0].type === "strong";

function Block({ node, nav }: { node: MdNode; nav: Nav }): ReactNode {
  switch (node.type) {
    case "heading":
      return (
        <p className="mct-h">
          <Inline nodes={node.text} nav={nav} />
        </p>
      );
    case "paragraph":
      return boldOnly(node.text) ? (
        <p className="mct-h">
          <Inline nodes={node.text} nav={nav} />
        </p>
      ) : (
        <p>
          <Inline nodes={node.text} nav={nav} />
        </p>
      );
    case "list": {
      const items = node.items.map((item, i) => (
        <li key={i} className={item.checked === null ? undefined : "mct-check"}>
          {item.checked === null ? null : (
            <>
              <span className={item.checked ? "mct-box on" : "mct-box"} aria-hidden="true" />
              <span className="vh">{item.checked ? "Done: " : "To do: "}</span>
            </>
          )}
          <span>
            <Inline nodes={item.lead} nav={nav} />
          </span>
          {item.children.map((child, j) => (
            <Block key={j} node={child} nav={nav} />
          ))}
        </li>
      ));
      return node.ordered ? <ol>{items}</ol> : <ul>{items}</ul>;
    }
    case "code":
      return (
        <pre>
          <code>{node.value}</code>
        </pre>
      );
    case "blockquote":
      return (
        <blockquote>
          {node.children.map((child, i) => (
            <Block key={i} node={child} nav={nav} />
          ))}
        </blockquote>
      );
    case "table":
      return (
        <div className="mct-table">
          <table>
            <thead>
              <tr>
                {node.headers.map((h, i) => (
                  <th key={i} scope="col">
                    <Inline nodes={h} nav={nav} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {node.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j}>
                      <Inline nodes={cell} nav={nav} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "hr":
      return <hr />;
  }
}

/** Plain text with a little markdown, as Mission Control shows it. Renders nothing for empty text. */
export function McText({ text, nav, className, testId }: { text: string; nav: Nav; className?: string; testId?: string }) {
  // The screens re-render on every store change; the text rarely changes.
  const nodes = useMemo(() => parseMcText(text), [text]);
  if (!text.trim()) return null;
  return (
    <div className={className ? `mct ${className}` : "mct"} data-testid={testId}>
      {nodes.map((node, i) => (
        <Block key={i} node={node} nav={nav} />
      ))}
    </div>
  );
}
