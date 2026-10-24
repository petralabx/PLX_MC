"use client";

// Projects (TASK-3841): every open project with its initiatives, the viewer's
// own first, then the initiatives that belong to no open project under No
// project. The zoned sidebar's Projects row and "View all N projects" land
// here. Closed and archived projects stay off it, as they stay out of the
// sidebar; the Dashboard's Closed scope and deep links still reach them.
import type { ReactNode } from "react";

import type { Bucket } from "@/lib/mc-data";
import { useMcVersion, useViewer } from "@/lib/mc-data/hooks";
import { navBuckets, navProjects } from "@/lib/mc-data/store";

import { isPlainLeftClick, isViewerProject, navHref, projectTree, unfiledInitiatives } from "./nav-model";
import type { Nav, Route, ScreenProps } from "./route";

function NavLink({ nav, target, className, children }: { nav: Nav; target: Route; className: string; children: ReactNode }) {
  return (
    <a
      href={navHref(target)}
      className={className}
      onClick={(event) => {
        if (!isPlainLeftClick(event)) return;
        event.preventDefault();
        const { screen, ...extra } = target;
        nav(screen, extra);
      }}
    >
      {children}
    </a>
  );
}

function Initiatives({ nav, initiatives }: { nav: Nav; initiatives: readonly Bucket[] }) {
  if (initiatives.length === 0) return <p className="pj-none">No open initiatives</p>;
  return (
    <ul className="pj-inits">
      {initiatives.map((b) => (
        <li key={b.id}>
          <NavLink nav={nav} target={{ screen: "bucket", bucketId: b.id }} className="pj-init">
            <span className={`hl ${b.health}`} aria-hidden="true" />
            {b.name}
          </NavLink>
        </li>
      ))}
    </ul>
  );
}

export function ProjectsView({ nav }: ScreenProps) {
  useMcVersion();
  const viewer = useViewer();
  const projects = navProjects();
  const initiatives = navBuckets();
  const { nodes } = projectTree(projects, initiatives, viewer, null, Infinity);
  const mine = nodes.filter((n) => isViewerProject(n.project, viewer));
  const others = nodes.filter((n) => !isViewerProject(n.project, viewer));
  const unfiled = unfiledInitiatives(projects, initiatives);
  const sections = [
    { id: "mine", title: "Your projects", nodes: mine },
    { id: "others", title: mine.length > 0 ? "Other projects" : "All projects", nodes: others },
  ].filter((section) => section.nodes.length > 0);

  return (
    <div className="mc-main pj" data-testid="projects-screen">
      <div className="ph">
        <div>
          <span className="kk">Plan</span>
          <h1>Projects</h1>
          <p className="sub">Every open project and its initiatives. Closed projects are on the Dashboard.</p>
        </div>
        <div className="r">
          <span className="count">
            <b>{projects.length}</b> {projects.length === 1 ? "project" : "projects"}
          </span>
        </div>
      </div>
      {sections.map((section) => (
        <section className="pj-sec" aria-labelledby={`pj-h-${section.id}`} key={section.id}>
          <h2 className="pj-h" id={`pj-h-${section.id}`}>
            {section.title}
          </h2>
          <ul className="pj-list">
            {section.nodes.map(({ project, initiatives: own }) => (
              <li className="pj-row" key={project.id}>
                <NavLink nav={nav} target={{ screen: "project", projectId: project.id }} className="pj-name">
                  <span className={`hl ${project.health}`} aria-hidden="true" />
                  {project.name}
                </NavLink>
                <Initiatives nav={nav} initiatives={own} />
              </li>
            ))}
          </ul>
        </section>
      ))}
      {unfiled.length > 0 ? (
        <section className="pj-sec" aria-labelledby="pj-h-none">
          <h2 className="pj-h" id="pj-h-none">
            No project
          </h2>
          <Initiatives nav={nav} initiatives={unfiled} />
        </section>
      ) : null}
    </div>
  );
}
