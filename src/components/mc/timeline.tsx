"use client";

// Unified timeline (EN-001 / WS-3): ONE newest-first stream that interleaves
// human/agent comments with system activity events, with a clear visual
// distinction between the two (aligned decision). Includes a comment composer
// with @mention autocomplete against the real directory, and edit/delete for
// the viewer's OWN comments. Used on both the task and the bucket detail.
//
// The store owns persistence + mention parsing; this component is presentational
// and controlled — it passes the raw body (with @id tokens) up through onAdd /
// onEdit and lets the store parse mentions + fire the notify path.

import { Fragment, useMemo, useRef, useState } from "react";

import { ACTORS, mergeTimeline, type Actor, type ActivityEntry, type Comment } from "@/lib/mc-data";

import { Avatar } from "./atoms";

interface TimelineProps {
  comments: Comment[];
  activity?: ActivityEntry[];
  people: Actor[];
  currentUser: string;
  onAdd: (body: string) => void;
  onEdit: (commentId: string, body: string) => void;
  onDelete: (commentId: string) => void;
}

const MENTION_SPLIT = /(@[a-z0-9][a-z0-9._-]*)/gi;

// Render a comment body, swapping resolvable `@id` tokens for `@Name` chips.
function renderBody(body: string) {
  return body.split(MENTION_SPLIT).map((part, index) => {
    if (part.startsWith("@")) {
      const actor = ACTORS[part.slice(1).toLowerCase()];
      if (actor) {
        return (
          <span className="tl-mention" key={index}>
            @{actor.name}
          </span>
        );
      }
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
}

function MentionComposer({
  people,
  placeholder,
  initial = "",
  submitLabel,
  autoFocus = false,
  onSubmit,
  onCancel,
}: {
  people: Actor[];
  placeholder: string;
  initial?: string;
  submitLabel: string;
  autoFocus?: boolean;
  onSubmit: (body: string) => void;
  onCancel?: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLTextAreaElement | null>(null);

  const matches = useMemo(() => {
    if (query === null) return [];
    const q = query.toLowerCase();
    return people
      .filter((p) => !q || p.id.toLowerCase().includes(q) || p.name.toLowerCase().includes(q))
      .slice(0, 6);
  }, [people, query]);

  const syncQuery = (value: string, caret: number) => {
    const before = value.slice(0, caret);
    const m = /(?:^|\s)@([a-z0-9._-]*)$/i.exec(before);
    setQuery(m ? m[1] : null);
    setActive(0);
  };

  const onChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setDraft(event.target.value);
    syncQuery(event.target.value, event.target.selectionStart ?? event.target.value.length);
  };

  const insertMention = (actor: Actor) => {
    const el = ref.current;
    const caret = el?.selectionStart ?? draft.length;
    const before = draft.slice(0, caret).replace(/@([a-z0-9._-]*)$/i, `@${actor.id} `);
    const next = before + draft.slice(caret);
    setDraft(next);
    setQuery(null);
    requestAnimationFrame(() => {
      el?.focus();
      const pos = before.length;
      el?.setSelectionRange(pos, pos);
    });
  };

  const submit = () => {
    const body = draft.trim();
    if (!body) return;
    onSubmit(body);
    setDraft("");
    setQuery(null);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (query !== null && matches.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActive((i) => (i + 1) % matches.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActive((i) => (i - 1 + matches.length) % matches.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        insertMention(matches[active]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setQuery(null);
        return;
      }
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
    }
    if (event.key === "Escape" && onCancel) {
      event.preventDefault();
      onCancel();
    }
  };

  return (
    <div className="tl-composer">
      <div className="tl-input-wrap">
        <textarea
          ref={(node) => {
            ref.current = node;
            if (node && autoFocus && document.activeElement !== node) node.focus();
          }}
          className="tl-input"
          value={draft}
          onChange={onChange}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          aria-label={placeholder}
          rows={3}
        />
        {query !== null && matches.length > 0 && (
          <div className="tl-mentions" role="listbox">
            {matches.map((person, index) => (
              <button
                type="button"
                key={person.id}
                className={`tl-mention-opt${index === active ? " on" : ""}`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  insertMention(person);
                }}
              >
                <Avatar id={person.id} size="sm" />
                <span className="nm">{person.name}</span>
                <span className="hd">@{person.id}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="tl-composer-foot">
        <span className="tl-hint">@ to mention · ⌘↵ to post</span>
        <span className="tl-composer-acts">
          {onCancel && (
            <button type="button" className="btn ghost sm" onClick={onCancel}>
              Cancel
            </button>
          )}
          <button type="button" className="btn sm" onClick={submit} disabled={!draft.trim()}>
            {submitLabel}
          </button>
        </span>
      </div>
    </div>
  );
}

export function Timeline({
  comments,
  activity = [],
  people,
  currentUser,
  onAdd,
  onEdit,
  onDelete,
}: TimelineProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const items = useMemo(() => mergeTimeline(comments, activity), [comments, activity]);

  return (
    <div className="tl">
      <MentionComposer
        people={people}
        placeholder="Write a comment… @mention a colleague or agent"
        submitLabel="Comment"
        onSubmit={onAdd}
      />
      <div className="tl-stream">
        {items.length === 0 ? (
          <div className="logempty">No comments or activity yet.</div>
        ) : (
          items.map((item) => {
            if (item.kind === "event") {
              const actor = ACTORS[item.event.who];
              return (
                <div className="tl-row event" key={`ev-${item.event.what}-${item.event.age}`}>
                  <span className="tl-gut">
                    {actor ? <Avatar id={item.event.who} size="sm" /> : <span className="fallback" />}
                  </span>
                  <span className="tl-body">
                    <b>{actor?.name ?? item.event.who}</b> {item.event.what}
                  </span>
                  <span className="tl-age">{item.event.age}</span>
                </div>
              );
            }
            const c = item.comment;
            const author = ACTORS[c.author];
            const mine = c.author === currentUser;
            return (
              <div className="tl-row comment" key={c.id}>
                <span className="tl-gut">
                  {author ? <Avatar id={c.author} size="sm" /> : <span className="fallback" />}
                </span>
                <div className="tl-card">
                  <div className="tl-meta">
                    <b>{author?.name ?? c.author}</b>
                    <span className="tl-age">
                      {c.ts}
                      {c.editedTs ? " · edited" : ""}
                    </span>
                    {mine && editing !== c.id && (
                      <span className="tl-acts">
                        <button type="button" className="tl-link" onClick={() => setEditing(c.id)}>
                          Edit
                        </button>
                        <button type="button" className="tl-link danger" onClick={() => onDelete(c.id)}>
                          Delete
                        </button>
                      </span>
                    )}
                  </div>
                  {editing === c.id ? (
                    <MentionComposer
                      people={people}
                      placeholder="Edit comment…"
                      initial={c.body}
                      submitLabel="Save"
                      autoFocus
                      onSubmit={(body) => {
                        onEdit(c.id, body);
                        setEditing(null);
                      }}
                      onCancel={() => setEditing(null)}
                    />
                  ) : (
                    <div className="tl-text">{renderBody(c.body)}</div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
