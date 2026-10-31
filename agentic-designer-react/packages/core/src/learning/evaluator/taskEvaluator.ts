// packages/core/src/learning/evaluator/taskEvaluator.ts
//
// Pure domain evaluator for learning progress, task status transitions,
// and evidence logging. Fully deterministic and testable.

import type { DesignProject } from '../../models/DesignProject';
import { newUUID } from '../../models/uuid';
import type {
  LearningProjectRecord,
  StudentTaskState,
  TaskTemplate,
  TaskEvaluationContext,
  TaskEvaluationResult,
  LearningEvidence,
  LearningEditorEvent,
} from '../models';
import { SIGNUP_TASK_TEMPLATES } from '../curriculum/signupCurriculum';

/** Creates a brand new learning record for a project */
export function createInitialLearningRecord(
  projectId: string,
  projectName: string,
  templates: TaskTemplate[] = SIGNUP_TASK_TEMPLATES,
): LearningProjectRecord {
  const now = Date.now();
  const tasks: Record<string, StudentTaskState> = {};

  for (let i = 0; i < templates.length; i++) {
    const t = templates[i];
    tasks[t.id] = {
      taskId: t.id,
      templateId: t.id,
      status: i === 0 ? 'active' : 'pending_dependencies',
      helpLevel: 'none',
      assignedNodeIds: [],
    };
  }

  return {
    schemaVersion: '1.0.0',
    id: newUUID(),
    designProjectId: projectId,
    name: projectName,
    trackId: 'android-compose-pilot',
    targetPlatform: 'Android',
    createdAt: now,
    updatedAt: now,
    activeTaskId: templates[0]?.id ?? '',
    tasks,
    roles: {},
    evidenceLog: [],
    conceptMastery: {},
  };
}

/** Evaluates the currently active task */
export function evaluateActiveTask(
  project: DesignProject,
  record: LearningProjectRecord,
  templates: TaskTemplate[] = SIGNUP_TASK_TEMPLATES,
  lastEvent?: LearningEditorEvent,
): { updatedRecord: LearningProjectRecord; result: TaskEvaluationResult } {
  const activeTaskId = record.activeTaskId;
  const template = templates.find((t) => t.id === activeTaskId);
  if (!template) {
    return {
      updatedRecord: record,
      result: { passed: false, feedbackHe: 'לא נמצאה משימה פעילה.' },
    };
  }

  const context: TaskEvaluationContext = {
    project,
    learningRecord: record,
    lastEvent,
  };

  const checkResult = template.check(context);
  const now = Date.now();

  const nextRecord: LearningProjectRecord = {
    ...record,
    updatedAt: now,
    tasks: { ...record.tasks },
    roles: { ...record.roles },
    evidenceLog: [...record.evidenceLog],
  };

  const currentTaskState = nextRecord.tasks[activeTaskId] ?? {
    taskId: activeTaskId,
    templateId: activeTaskId,
    status: 'active',
    helpLevel: 'none',
    assignedNodeIds: [],
  };

  if (checkResult.passed) {
    // Generate evidence record
    const evidenceId = newUUID();
    const evidence: LearningEvidence = {
      id: evidenceId,
      taskId: activeTaskId,
      timestamp: now,
      checkType: 'structure',
      passed: true,
      detectedNodeId: checkResult.detectedNodeId,
      details: checkResult.feedbackHe,
    };
    nextRecord.evidenceLog.push(evidence);

    // Assign role if detected
    if (checkResult.detectedNodeId && checkResult.assignedRole) {
      nextRecord.roles[checkResult.detectedNodeId] = checkResult.assignedRole;
    }

    const assigned = [...currentTaskState.assignedNodeIds];
    if (checkResult.detectedNodeId && !assigned.includes(checkResult.detectedNodeId)) {
      assigned.push(checkResult.detectedNodeId);
    }

    nextRecord.tasks[activeTaskId] = {
      ...currentTaskState,
      status: 'completed',
      completedAt: currentTaskState.completedAt ?? now,
      evidenceId,
      feedbackMessage: checkResult.feedbackHe,
      assignedNodeIds: assigned,
    };
  } else {
    // If it was already completed and now fails (e.g. user deleted node)
    const newStatus = currentTaskState.status === 'completed' ? 'needs_recheck' : 'active';
    nextRecord.tasks[activeTaskId] = {
      ...currentTaskState,
      status: newStatus,
      feedbackMessage: checkResult.feedbackHe,
    };
  }

  return { updatedRecord: nextRecord, result: checkResult };
}

/** Advance to the next task in sequence once current task is completed */
export function advanceToNextTask(
  record: LearningProjectRecord,
  templates: TaskTemplate[] = SIGNUP_TASK_TEMPLATES,
): LearningProjectRecord {
  const activeTask = record.tasks[record.activeTaskId];
  if (!activeTask || activeTask.status !== 'completed') {
    return record;
  }

  const currentIndex = templates.findIndex((t) => t.id === record.activeTaskId);
  if (currentIndex === -1 || currentIndex >= templates.length - 1) {
    return record; // Reached end of curriculum
  }

  const nextTemplate = templates[currentIndex + 1];
  const nextTasks = { ...record.tasks };

  nextTasks[nextTemplate.id] = {
    taskId: nextTemplate.id,
    templateId: nextTemplate.id,
    status: 'active',
    helpLevel: 'none',
    assignedNodeIds: [],
  };

  return {
    ...record,
    updatedAt: Date.now(),
    activeTaskId: nextTemplate.id,
    tasks: nextTasks,
  };
}

/** Check whether an undo or node deletion invalidated previously completed tasks */
export function verifyAllCompletedTasks(
  project: DesignProject,
  record: LearningProjectRecord,
  templates: TaskTemplate[] = SIGNUP_TASK_TEMPLATES,
): LearningProjectRecord {
  let changed = false;
  const nextTasks = { ...record.tasks };

  for (const [taskId, taskState] of Object.entries(record.tasks)) {
    if (taskState.status === 'completed') {
      const t = templates.find((item) => item.id === taskId);
      if (t) {
        const res = t.check({ project, learningRecord: record });
        if (!res.passed) {
          changed = true;
          nextTasks[taskId] = {
            ...taskState,
            status: 'needs_recheck',
            feedbackMessage: res.feedbackHe,
          };
        }
      }
    }
  }

  if (!changed) return record;
  return {
    ...record,
    updatedAt: Date.now(),
    tasks: nextTasks,
  };
}
