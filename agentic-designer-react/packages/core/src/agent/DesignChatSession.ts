// Ported 1:1 from AgenticDesigner/Services/DesignChatSession.swift
//
// The conversation behind the designer. A single "Ask Agent" text field
// makes the agent feel like a command line; a thread makes it feel like a
// collaborator. Every user turn snapshots the project first, so any message
// can be reverted individually — "undo that idea" rather than "undo 40 node
// edits".

import { newUUID } from '../models/uuid';
import type { ProjectCheckpoint, AgentCheckpointStore, DesignAgentDesignHost } from './hosts';
import { CheckpointStore } from '../services/CheckpointStore';

export type ChatRole = 'user' | 'agent' | 'system';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  date: number;
  /** The project state BEFORE this turn ran — reverting restores it. */
  checkpoint?: ProjectCheckpoint;
  /** Live status while the turn is running ("Designing screens…"). */
  stage?: string;
  isRunning: boolean;
  summary?: string;
}

export class DesignChatSession {
  private _messages: ChatMessage[] = [];
  private _isRunning = false;
  private readonly listeners = new Set<() => void>();

  get messages(): readonly ChatMessage[] {
    return this._messages;
  }

  get isRunning(): boolean {
    return this._isRunning;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // ignore subscriber errors
      }
    }
  }

  // MARK: - Turn lifecycle

  appendUser(text: string, checkpoint?: ProjectCheckpoint): string {
    this._messages.push({
      id: newUUID(),
      role: 'user',
      text,
      date: Date.now(),
      checkpoint,
      isRunning: false,
    });
    const agentId = newUUID();
    const agent: ChatMessage = {
      id: agentId,
      role: 'agent',
      text: '',
      date: Date.now(),
      stage: 'Thinking…',
      isRunning: true,
    };
    this._messages.push(agent);
    this._isRunning = true;
    this.notify();
    return agentId;
  }

  updateStage(id: string, stage: string): void {
    const index = this._messages.findIndex((m) => m.id === id);
    if (index < 0) return;
    this._messages[index] = { ...this._messages[index]!, stage };
    this.notify();
  }

  finish(id: string, summary: string): void {
    const index = this._messages.findIndex((m) => m.id === id);
    if (index < 0) return;
    this._messages[index] = {
      ...this._messages[index]!,
      isRunning: false,
      stage: undefined,
      text: summary,
    };
    this._isRunning = false;
    this.notify();
  }

  fail(id: string, error: string): void {
    const index = this._messages.findIndex((m) => m.id === id);
    if (index < 0) return;
    this._messages[index] = {
      ...this._messages[index]!,
      isRunning: false,
      stage: undefined,
      text: `Failed: ${error}`,
    };
    this._isRunning = false;
    this.notify();
  }

  appendSystem(text: string): void {
    this._messages.push({
      id: newUUID(),
      role: 'system',
      text,
      date: Date.now(),
      isRunning: false,
    });
    this.notify();
  }

  /**
   * Reverts the project to the state before this user message, and drops
   * that turn (and everything after it) from the thread.
   */
  async revert(
    message: ChatMessage,
    design: DesignAgentDesignHost,
    checkpointStore?: AgentCheckpointStore,
  ): Promise<void> {
    if (!message.checkpoint) return;
    const store = checkpointStore ?? CheckpointStore;
    const restored = await store.load(message.checkpoint);
    store.save(design.project, 'before revert');
    design.replaceProject(restored);
    const index = this._messages.findIndex((m) => m.id === message.id);
    if (index >= 0) {
      this._messages.splice(index);
    }
    this.appendSystem('Reverted to the state before that message.');
  }

  clear(): void {
    this._messages = [];
    this._isRunning = false;
    this.notify();
  }
}
