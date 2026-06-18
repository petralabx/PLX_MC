"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

import { AGENTS, domainOf, isPetraEmail, type Actor, type Human } from "@/lib/mc-data";
import { useMcVersion } from "@/lib/mc-data/hooks";
import { actorById, directory, invitePerson, personByEmail } from "@/lib/mc-data/store";

import { Avatar } from "./atoms";

export interface InviteOfferDecision {
  normalizedQuery: string;
  showInvite: boolean;
  blockedExternalDomain: boolean;
}

export function decideInviteOffer(rawQuery: string, knownPerson: boolean): InviteOfferDecision {
  const normalizedQuery = rawQuery.trim().toLowerCase();
  const looksEmail = normalizedQuery.includes("@");
  const validPetra = isPetraEmail(normalizedQuery);
  return {
    normalizedQuery,
    showInvite: looksEmail && validPetra && !knownPerson,
    blockedExternalDomain: looksEmail && !validPetra,
  };
}

function PersonRow({
  actor,
  active,
  onPick,
}: {
  actor: Actor;
  active: boolean;
  onPick: (id: string) => void;
}) {
  const meta =
    actor.kind === "agent" ? `${actor.model} · ${actor.team}` : (domainOf(actor.email ?? "") || actor.role);
  return (
    <button type="button" className={`pi${active ? " on" : ""}`} onClick={() => onPick(actor.id)}>
      <Avatar id={actor.id} size="sm" />
      <span className="pp-name">
        {actor.name}
        {actor.kind === "human" && actor.invited ? <span className="pp-inv">invited</span> : null}
      </span>
      <span className="pp-meta">{meta}</span>
    </button>
  );
}

export function PeoplePicker({
  current,
  onPick,
  onClose,
  allowAgents = true,
  style,
}: {
  current: string | null;
  onPick: (id: string | null) => void;
  onClose: () => void;
  allowAgents?: boolean;
  style?: CSSProperties;
}) {
  useMcVersion();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  const normalizedQuery = query.trim().toLowerCase();
  const humans = useMemo(() => {
    return directory().filter((person) => {
      if (!normalizedQuery) return true;
      return (
        person.name.toLowerCase().includes(normalizedQuery) ||
        (person.email ?? "").toLowerCase().includes(normalizedQuery)
      );
    });
  }, [normalizedQuery]);

  const agents = useMemo(() => {
    if (!allowAgents) return [];
    return Object.values(AGENTS).filter((agent) => {
      if (!normalizedQuery) return true;
      return (
        agent.name.toLowerCase().includes(normalizedQuery) ||
        agent.model.toLowerCase().includes(normalizedQuery) ||
        agent.team.toLowerCase().includes(normalizedQuery)
      );
    });
  }, [allowAgents, normalizedQuery]);

  const decision = decideInviteOffer(normalizedQuery, !!personByEmail(normalizedQuery));

  const pick = (id: string | null) => {
    onPick(id);
    onClose();
  };

  const invite = () => {
    if (!decision.showInvite) return;
    const id = invitePerson(decision.normalizedQuery);
    if (id) pick(id);
  };

  const noMatches =
    humans.length === 0 &&
    agents.length === 0 &&
    !decision.showInvite &&
    !decision.blockedExternalDomain;

  return (
    <div className="picker ppick" style={style} onClick={(event) => event.stopPropagation()}>
      <div className="ppick-search">
        <span className="mag">⌕</span>
        <input
          ref={inputRef}
          value={query}
          placeholder="Name or @petra email..."
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && decision.showInvite) {
              event.preventDefault();
              invite();
            }
          }}
        />
      </div>
      <div className="ppick-list">
        {decision.blockedExternalDomain ? (
          <div className="ppick-block">
            <b>{decision.normalizedQuery.split("@")[1]}</b> can&apos;t be tasked — only{" "}
            <b>@petralabx.com</b> and <b>@petrasoap.com</b> colleagues.
          </div>
        ) : null}

        {decision.showInvite ? (
          <button type="button" className="pi invite" onClick={invite}>
            <span className="pp-plus">+</span>
            <span className="pp-name">Invite {decision.normalizedQuery}</span>
            <span className="pp-meta">{domainOf(decision.normalizedQuery)}</span>
          </button>
        ) : null}

        {current && !normalizedQuery ? (
          <button type="button" className="pi clear" onClick={() => pick(null)}>
            <span className="pp-plus">×</span>
            <span className="pp-name" style={{ color: "var(--p-muted)" }}>
              Unassign
            </span>
          </button>
        ) : null}

        {humans.length > 0 ? <div className="pg">Directory</div> : null}
        {humans.map((person: Human) => (
          <PersonRow key={person.id} actor={person} active={current === person.id} onPick={pick} />
        ))}

        {allowAgents && agents.length > 0 ? <div className="pg">Agents</div> : null}
        {allowAgents &&
          agents.map((agent) => (
            <PersonRow key={agent.id} actor={agent} active={current === agent.id} onPick={pick} />
          ))}

        {noMatches ? <div className="ppick-empty">No matches</div> : null}
      </div>
    </div>
  );
}

export function NotifyTrail({ id }: { id: string | null }) {
  const person = id ? actorById(id) : undefined;
  if (!person || person.kind !== "human") return null;
  return (
    <span
      className="notify-trail"
      title={`Assigned To mirror for ${person.name} deferred to the directory increment`}
    >
      <span className="d" />
      Assigned To mirror deferred to the directory increment
    </span>
  );
}
