import { z } from "zod";

const NonEmptyString = z.string().trim().min(1);
const ArchitectureViewIdSchema = z.enum([
  "context",
  "containers",
  "task-lifecycle",
]);

export const ArchitectureSourceLinkSchema = z
  .object({
    path: NonEmptyString,
    href: z.string().url(),
    authorityClass: NonEmptyString,
    commit: NonEmptyString,
    startLine: z.number().int().positive().nullable(),
    endLine: z.number().int().positive().nullable(),
  })
  .superRefine((source, ctx) => {
    if (
      source.startLine !== null &&
      source.endLine !== null &&
      source.endLine < source.startLine
    ) {
      ctx.addIssue({
        code: "custom",
        message: `Source "${source.path}" ends before it starts.`,
      });
    }
  });

export const ArchitectureClaimSchema = z.object({
  factId: NonEmptyString,
  claim: NonEmptyString,
  summary: NonEmptyString.nullable(),
  sources: z.array(ArchitectureSourceLinkSchema),
});

export const ArchitectureCategorySchema = z.object({
  id: NonEmptyString,
  label: NonEmptyString,
  colorToken: z.string().regex(/^--p-[a-z0-9-]+$/),
  accent: z.enum(["top", "left", "bottom", "ring"]),
  dashed: z.boolean(),
});

export const ArchitectureLevelSchema = z.object({
  id: ArchitectureViewIdSchema,
  label: NonEmptyString,
  title: NonEmptyString,
});

const ArchitectureBadgeSchema = z.object({
  label: NonEmptyString,
  tone: z.enum(["ok", "warn", "info"]),
});

const ArchitectureGroupSchema = z.object({
  id: NonEmptyString,
  label: NonEmptyString,
  band: z.number().int().nonnegative(),
  tone: z.enum(["warm", "cool", "plain"]),
  nodeIds: z.array(NonEmptyString),
  summary: z
    .object({
      kicker: NonEmptyString.optional(),
      title: NonEmptyString,
      description: NonEmptyString,
      width: z.number().positive().optional(),
    })
    .optional(),
});

const ArchitectureNodeSchema = z.object({
  id: NonEmptyString,
  label: NonEmptyString,
  category: NonEmptyString,
  group: NonEmptyString,
  band: z.number().int().nonnegative(),
  layer: z.number().int().nonnegative(),
  kicker: NonEmptyString.optional(),
  tagline: NonEmptyString.optional(),
  description: NonEmptyString,
  note: NonEmptyString.optional(),
  width: z.number().positive().optional(),
  emphasis: z.boolean().optional(),
  badges: z.array(ArchitectureBadgeSchema).optional(),
  claims: z.array(ArchitectureClaimSchema),
});

const ArchitectureEdgeSchema = z.object({
  id: NonEmptyString,
  from: NonEmptyString,
  to: NonEmptyString,
  label: NonEmptyString,
  category: NonEmptyString,
  bidirectional: z.boolean().optional(),
  note: NonEmptyString.optional(),
  route: z
    .object({
      aShift: z.number().min(-0.5).max(0.5).optional(),
      bShift: z.number().min(-0.5).max(0.5).optional(),
      lx: z.number().optional(),
      ly: z.number().optional(),
    })
    .optional(),
  claims: z.array(ArchitectureClaimSchema),
});

const ArchitectureViewSchema = z.object({
  id: ArchitectureViewIdSchema,
  groups: z.array(ArchitectureGroupSchema),
  nodes: z.array(ArchitectureNodeSchema),
  edges: z.array(ArchitectureEdgeSchema),
});

function duplicateIds(items: Array<{ id: string }>): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) duplicates.add(item.id);
    seen.add(item.id);
  }
  return [...duplicates].sort();
}

export const ArchitectureModelSchema = z
  .object({
    schemaVersion: z.literal("plx-architecture-model/v1"),
    meta: z.object({
      title: NonEmptyString,
      kicker: NonEmptyString,
      subtitle: NonEmptyString,
      source: z.object({
        path: z.literal("docs/architecture/source-map.json"),
        schemaVersion: NonEmptyString,
        commit: NonEmptyString,
        notice: NonEmptyString,
        repositoryUrl: z.string().url(),
      }),
      footer: z.object({
        left: z.array(NonEmptyString).min(1),
        right: z.array(NonEmptyString).min(1),
      }),
    }),
    levels: z.array(ArchitectureLevelSchema).min(1),
    categories: z.array(ArchitectureCategorySchema).min(1),
    views: z.array(ArchitectureViewSchema).min(1),
  })
  .superRefine((model, ctx) => {
    for (const id of duplicateIds(model.levels)) {
      ctx.addIssue({ code: "custom", message: `Duplicate level id "${id}".` });
    }
    for (const id of duplicateIds(model.categories)) {
      ctx.addIssue({ code: "custom", message: `Duplicate category id "${id}".` });
    }
    for (const id of duplicateIds(model.views)) {
      ctx.addIssue({ code: "custom", message: `Duplicate view id "${id}".` });
    }

    const categoryIds = new Set(model.categories.map((category) => category.id));
    const levelIds = new Set(model.levels.map((level) => level.id));

    for (const view of model.views) {
      if (!levelIds.has(view.id)) {
        ctx.addIssue({
          code: "custom",
          message: `View "${view.id}" has no matching level metadata.`,
        });
      }
      if (view.nodes.length > 30) {
        ctx.addIssue({
          code: "custom",
          message: `View "${view.id}" has ${view.nodes.length} nodes; the maximum is 30.`,
        });
      }

      for (const id of duplicateIds(view.groups)) {
        ctx.addIssue({
          code: "custom",
          message: `Duplicate group id "${id}" in view "${view.id}".`,
        });
      }
      for (const id of duplicateIds(view.nodes)) {
        ctx.addIssue({
          code: "custom",
          message: `Duplicate node id "${id}" in view "${view.id}".`,
        });
      }
      for (const id of duplicateIds(view.edges)) {
        ctx.addIssue({
          code: "custom",
          message: `Duplicate edge id "${id}" in view "${view.id}".`,
        });
      }

      const nodeIds = new Set(view.nodes.map((node) => node.id));
      const groupIds = new Set(view.groups.map((group) => group.id));
      const membership = new Map<string, number>();

      for (const group of view.groups) {
        for (const nodeId of group.nodeIds) {
          if (!nodeIds.has(nodeId)) {
            ctx.addIssue({
              code: "custom",
              message: `Group "${group.id}" in view "${view.id}" references unknown node "${nodeId}".`,
            });
          }
          membership.set(nodeId, (membership.get(nodeId) ?? 0) + 1);
        }
      }

      for (const node of view.nodes) {
        if (!categoryIds.has(node.category)) {
          ctx.addIssue({
            code: "custom",
            message: `Node "${node.id}" in view "${view.id}" references unknown category "${node.category}".`,
          });
        }
        if (!groupIds.has(node.group)) {
          ctx.addIssue({
            code: "custom",
            message: `Node "${node.id}" in view "${view.id}" references unknown group "${node.group}".`,
          });
        }
        const memberCount = membership.get(node.id) ?? 0;
        if (memberCount === 0) {
          ctx.addIssue({
            code: "custom",
            message: `Node "${node.id}" in view "${view.id}" is outside every group boundary.`,
          });
        } else if (memberCount > 1) {
          ctx.addIssue({
            code: "custom",
            message: `Node "${node.id}" in view "${view.id}" belongs to multiple groups.`,
          });
        }
        const group = view.groups.find((candidate) => candidate.id === node.group);
        if (group && !group.nodeIds.includes(node.id)) {
          ctx.addIssue({
            code: "custom",
            message: `Node "${node.id}" in view "${view.id}" does not belong to declared group "${node.group}".`,
          });
        }
        if (node.claims.length === 0) {
          ctx.addIssue({
            code: "custom",
            message: `Node "${node.id}" in view "${view.id}" has no provenance claims.`,
          });
        }
        for (const claim of node.claims) {
          if (claim.sources.length === 0) {
            ctx.addIssue({
              code: "custom",
              message: `Claim "${claim.factId}" on node "${node.id}" in view "${view.id}" has no source links.`,
            });
          }
          for (const source of claim.sources) {
            if (source.commit !== model.meta.source.commit) {
              ctx.addIssue({
                code: "custom",
                message: `Source "${source.path}" on node "${node.id}" does not match model commit "${model.meta.source.commit}".`,
              });
            }
          }
        }
      }

      for (const edge of view.edges) {
        if (!nodeIds.has(edge.from)) {
          ctx.addIssue({
            code: "custom",
            message: `Edge "${edge.id}" in view "${view.id}" references unknown source node "${edge.from}".`,
          });
        }
        if (!nodeIds.has(edge.to)) {
          ctx.addIssue({
            code: "custom",
            message: `Edge "${edge.id}" in view "${view.id}" references unknown target node "${edge.to}".`,
          });
        }
        if (!categoryIds.has(edge.category)) {
          ctx.addIssue({
            code: "custom",
            message: `Edge "${edge.id}" in view "${view.id}" references unknown category "${edge.category}".`,
          });
        }
        if (edge.claims.length === 0) {
          ctx.addIssue({
            code: "custom",
            message: `Edge "${edge.id}" in view "${view.id}" has no provenance claims.`,
          });
        }
        for (const claim of edge.claims) {
          if (claim.sources.length === 0) {
            ctx.addIssue({
              code: "custom",
              message: `Claim "${claim.factId}" on edge "${edge.id}" in view "${view.id}" has no source links.`,
            });
          }
          for (const source of claim.sources) {
            if (source.commit !== model.meta.source.commit) {
              ctx.addIssue({
                code: "custom",
                message: `Source "${source.path}" on edge "${edge.id}" does not match model commit "${model.meta.source.commit}".`,
              });
            }
          }
        }
      }
    }
  });

export type ArchitectureModel = z.infer<typeof ArchitectureModelSchema>;
export type ArchitectureClaim = z.infer<typeof ArchitectureClaimSchema>;
export type ArchitectureSourceLink = z.infer<
  typeof ArchitectureSourceLinkSchema
>;
