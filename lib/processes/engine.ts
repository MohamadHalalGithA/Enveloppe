import {
  ProcessDefinitionZ,
  type CaseStatus,
  type DeadlineResult,
  type DocType,
  type ProcessDefinition,
  type ProcessId,
  type ProcessView,
} from "@/lib/contracts";
import type { Registry } from "@/lib/registry/load";
import { sourceOf } from "@/lib/registry/lookup";
import { formatCivilDate } from "@/lib/ui/format";
import craObjection from "@/data/processes/cra-objection.json";
import craReview from "@/data/processes/cra-review.json";
import irccBiometrics from "@/data/processes/ircc-biometrics.json";

/**
 * Process Graph (Blueprint Part 13): ordered JSON state machines, no graph database.
 * Transitions only move forward: a triggering letter type, or the user saving submission proof.
 */

function validate(defs: unknown[]): ProcessDefinition[] {
  return defs.map((d) => {
    const p = ProcessDefinitionZ.parse(d);
    const ids = new Set(p.stages.map((s) => s.id));
    for (const [doc, stage] of Object.entries(p.triggers)) {
      if (!ids.has(stage!)) throw new Error(`${p.id}: trigger ${doc} → unknown stage ${stage}`);
    }
    for (const [from, to] of Object.entries(p.afterSubmit)) {
      if (!ids.has(from) || !ids.has(to)) throw new Error(`${p.id}: afterSubmit ${from} → ${to} uses an unknown stage`);
      if (stageIndex(p, to) <= stageIndex(p, from)) throw new Error(`${p.id}: afterSubmit must move forward`);
    }
    for (const doc of p.startsWith) if (!p.triggers[doc]) throw new Error(`${p.id}: ${doc} starts the process but has no trigger`);
    return p;
  });
}

export const PROCESSES: ProcessDefinition[] = validate([craReview, craObjection, irccBiometrics]);

export function processById(id: string | null): ProcessDefinition | undefined {
  return PROCESSES.find((p) => p.id === id);
}

function stageIndex(p: ProcessDefinition, stageId: string | null): number {
  return p.stages.findIndex((s) => s.id === stageId);
}

/** Which process a new case opened by this letter belongs to, and at which stage. */
export function placeNewCase(docType: DocType | null): { processId: ProcessId; stageId: string } | null {
  if (!docType) return null;
  const p = PROCESSES.find((d) => d.startsWith.includes(docType));
  return p ? { processId: p.id, stageId: p.triggers[docType]! } : null;
}

/** Where a letter moves an existing case. Never moves a case backwards. */
export function advanceForLetter(processId: string | null, currentStageId: string | null, docType: DocType | null): string | null {
  const p = processById(processId);
  if (!p || !docType) return currentStageId;
  const target = p.triggers[docType];
  if (!target) return currentStageId;
  return stageIndex(p, target) > stageIndex(p, currentStageId) ? target : currentStageId;
}

/** Stage after the user records that they submitted what was asked. */
export function afterSubmit(processId: string | null, stageId: string | null): string | null {
  const p = processById(processId);
  return (p && stageId && p.afterSubmit[stageId]) || stageId;
}

/** A process stage implies the case status: something to do, waiting, or finished. */
export function statusForStage(processId: string | null, stageId: string | null): CaseStatus {
  const stage = processById(processId)?.stages.find((s) => s.id === stageId);
  if (!stage) return "ACTION_REQUIRED";
  if (stage.terminal) return "CLOSED";
  if (stage.userAction) return "ACTION_REQUIRED";
  return "WAITING_FOR_GOVERNMENT";
}

/**
 * An old letter: the deadline to act on the step it put you in has passed. Say so on that step instead of
 * showing it as still open ("You can object if you disagree", years later).
 */
export function flagMissedDeadline(
  view: ProcessView | null,
  deadline: DeadlineResult | null,
  actionStageId: string | null | undefined,
): ProcessView | null {
  if (!view || deadline?.status !== "PASSED" || !deadline.effective || view.currentStageId !== actionStageId) return view;
  const alert = `The deadline for this step was ${formatCivilDate(deadline.effective)}. It has passed.`;
  return { ...view, stages: view.stages.map((s) => (s.id === view.currentStageId ? { ...s, alert } : s)) };
}

export function processView(reg: Registry, processId: string | null, stageId: string | null): ProcessView | null {
  const p = processById(processId);
  const current = p ? stageIndex(p, stageId) : -1;
  if (!p || current < 0) return null;
  return {
    processId: p.id,
    title: p.title,
    currentStageId: p.stages[current].id,
    stages: p.stages.map((s, i) => ({
      id: s.id,
      label: s.label,
      state: i < current ? "done" : i === current ? "current" : "todo",
      ...(s.expectNext ? { expectNext: s.expectNext } : {}),
    })),
    sourceUrl: sourceOf(reg, p.sourceId).url,
  };
}
