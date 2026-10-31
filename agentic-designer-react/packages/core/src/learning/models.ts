// packages/core/src/learning/models.ts
//
// Core domain models for the guided Hebrew learning companion.
// Clean TypeScript models, zero DOM / Node dependencies.

import type { DesignProject } from '../models/DesignProject';

export type TaskStatus =
  | 'pending_dependencies' // ממתינה לתלות
  | 'available'            // זמינה להתחלה
  | 'active'               // פעילה - התלמיד עובד כרגע
  | 'evaluating'           // בבדיקה
  | 'needs_fix'            // דורשת תיקון (ראיה מצביעה על פער)
  | 'completed'            // הושלמה בהצלחה
  | 'needs_recheck';       // דורשת בדיקה מחדש (למשל לאחר Undo או שינוי משמעותי)

export type HelpLevel = 'none' | 'first_hint' | 'second_hint' | 'explanation';

export type ElementRole =
  | 'signup_screen'
  | 'app_title'
  | 'email_input'
  | 'email_label'
  | 'password_input'
  | 'submit_button'
  | 'login_link'
  | 'loading_state'
  | 'error_state';

export interface LearningEvidence {
  id: string;
  taskId: string;
  timestamp: number;
  checkType: 'structure' | 'property' | 'behavior' | 'manual_confirmation';
  passed: boolean;
  projectVersion?: string;
  detectedNodeId?: string;
  details?: string;
}

export interface StudentTaskState {
  taskId: string;
  templateId: string;
  status: TaskStatus;
  helpLevel: HelpLevel;
  completedAt?: number;
  evidenceId?: string;
  feedbackMessage?: string;
  assignedNodeIds: string[];
}

export interface ConceptMasteryRecord {
  conceptId: string;
  firstDemonstratedAt?: number;
  lastVerifiedAt?: number;
  score: number; // 0.0 to 1.0
  independentCount: number; // Number of times successfully solved without hints
}

export interface LearningProjectRecord {
  schemaVersion: string; // e.g. "1.0.0"
  id: string;            // Stable UUID for the learning session
  designProjectId?: string;
  name: string;
  trackId: string;       // e.g. "android-compose-pilot"
  targetPlatform: 'Android';
  createdAt: number;
  updatedAt: number;
  activeTaskId: string;
  activeScreenId?: string;
  tasks: Record<string, StudentTaskState>;
  roles: Record<string, ElementRole>; // NodeId -> ElementRole
  evidenceLog: LearningEvidence[];
  conceptMastery: Record<string, ConceptMasteryRecord>;
  drafts?: Record<string, string>;
}

export type LearningEditorEventType =
  | 'node_added'
  | 'node_modified'
  | 'node_deleted'
  | 'selection_changed'
  | 'style_modified'
  | 'undo_performed'
  | 'redo_performed';

export interface LearningEditorEvent {
  type: LearningEditorEventType;
  timestamp: number;
  nodeId?: string;
  nodeType?: string;
  propertyName?: string;
  source: 'student' | 'restore' | 'automated';
}

export interface TaskEvaluationContext {
  project: DesignProject;
  learningRecord: LearningProjectRecord;
  lastEvent?: LearningEditorEvent;
}

export interface TaskEvaluationResult {
  passed: boolean;
  feedbackHe: string;
  detectedNodeId?: string;
  assignedRole?: ElementRole;
  missingDetailsHe?: string[];
}

export interface TaskTemplate {
  id: string;
  unitId: string;
  stepNumber: number;
  titleHe: string;
  promptHe: string;
  whyHe: string;
  hintsHe: string[];
  toolHighlightTarget?: string;
  dependencies: string[];
  concepts: string[];
  summaryQuestionHe?: string;
  transferExerciseHe?: string;
  check: (context: TaskEvaluationContext) => TaskEvaluationResult;
}
