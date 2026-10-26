"use client";

// Projects (TASK-3841): every open project with its initiatives, the viewer's
// own first, then the initiatives that belong to no open project under No
// project. The zoned sidebar's Projects row and "View all N projects" land
// here. Closed and archived projects stay off it, as they stay out of the
// sidebar; the Dashboard's Closed scope and deep links still reach them.
// In the zoned shell each row has a star toggle (TASK-3842).
import type { ReactNode } from "react";

import type { Bucket } from "@/lib/mc-data";
import { useMcVersion, useViewer } from "@/lib/mc-data/hooks";
import { allTasks, navBuckets, navProjects } from "@/lib/mc-data/store";

import { isPlainLeftClick, navHref, projectTree, unfiledInitiatives, viewerProjectIds } from "./nav-model";
import { useNavZones } from "./nav-zones";
import type { Nav, Route, ScreenProps } from "./route";
import { StarToggle } from "./star-toggle";
import { useStars, type Stars } from "./use-stars";

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

function Initiatives({ nav, initiatives, stars }: { nav: Nav; initiatives: readonly Bucket[]; stars: Stars }) {
  if (initiatives.length === 0) return <p className="pj-none">No open initiatives</p>;
  return (
    <ul className="pj-inits">
      {initiatives.map((b) => (
        <li key={b.id}>
          <NavLink nav={nav} target={{ screen: "bucket", bucketId: b.id }} className="pj-init">
            <span className={`hl ${b.health}`} aria-hidden="true" />
            {b.name}
          </NavLink>
          {stars.off ? null : <StarToggle stars={stars} starKey={`bucket:${b.id}`} label={b.name} className="pj-star" />}
        </li>
      ))}
    </ul>
  );
}

export function ProjectsView({ nav }: ScreenProps) {
  useMcVersion();
  const viewer = useViewer();
  const zoned = useNavZones();
  const stars = useStars(zoned);
  const projects = navProjects();
  const initiatives = navBuckets();
  const viewers = viewerProjectIds(projects, initiatives, allTasks(), viewer);
  const nodes = projectTree(projects, initiatives, viewers);
  const mine = nodes.filter((n) => viewers.has(n.project.id));
  const others = nodes.filter((n) => !viewers.has(n.project.id));
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
                <div className="pj-head">
                  <NavLink nav={nav} target={{ screen: "project", projectId: project.id }} className="pj-name">
                    <span className={`hl ${project.health}`} aria-hidden="true" />
                    {project.name}
                  </NavLink>
                  {stars.off ? null : (
                    <StarToggle stars={stars} starKey={`project:${project.id}`} label={project.name} className="pj-star" />
                  )}
                </div>
                <Initiatives nav={nav} initiatives={own} stars={stars} />
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
          <Initiatives nav={nav} initiatives={unfiled} stars={stars} />
        </section>
      ) : null}
    </div>
  );
}
