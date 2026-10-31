import { GuidedKotlinCompanion } from './GuidedKotlinCompanion';
// apps/web/src/views/learning/LearningCompanionPanel.tsx
//
// The Hebrew Learning Companion panel, anchored on the left side of the screen.
// Features:
// - Multi-unit 3-screen curriculum navigation (Signup, Login, Home)
// - Step-by-step guidance, hints, tool highlighting, progress overview
// - Cost-effective AI Q&A with budget counter and local fallback
// - "מתחילים לכתוב את המסכים שלי" transition to Kotlin / Compose code

import React, { useState, useEffect } from 'react';
import { useLearningStore } from '../../stores/learningStore';
import { useProjectStore } from '../../stores/projectStore';
import { CURRICULUM_UNITS, getUnitById, enrichDesignSnapshot, generateKotlinLearningTasks } from '@agentic/core';
import SFSymbol from '../../components/SFSymbol';

export function LearningCompanionPanel() {
  const learningRecord = useLearningStore((s) => s.learningRecord);
  const activeUnitId = useLearningStore((s) => s.activeUnitId);
  const activeTaskId = useLearningStore((s) => s.activeTaskId);
  const activeTemplate = useLearningStore((s) => s.activeTemplate);
  const hintIndex = useLearningStore((s) => s.hintIndex);
  const showMeWhere = useLearningStore((s) => s.showMeWhere);
  const requestHint = useLearningStore((s) => s.requestHint);
  const proceedToNextTask = useLearningStore((s) => s.proceedToNextTask);
  const checkCurrentTask = useLearningStore((s) => s.checkCurrentTask);
  const switchUnit = useLearningStore((s) => s.switchUnit);
  const askAI = useLearningStore((s) => s.askAI);
  const startWritingMyScreens = useLearningStore((s) => s.startWritingMyScreens);
  const designSnapshot = useLearningStore((s) => s.learningStage === 'code' ? s.designSnapshot : null);
  const sessionSavedAt = useLearningStore(s => s.sessionSavedAt);
  const saveError = useLearningStore(s => s.saveError);
  const kotlinTasks = useLearningStore((s) => s.kotlinTasks);
  const activeKotlinTaskId = useLearningStore((s) => s.activeKotlinTaskId);
  const resetProgress = useLearningStore((s) => s.resetProgress);

  const project = useProjectStore((s) => s.project);

  const [questionInput, setQuestionInput] = useState('');
  const [isAsking, setIsAsking] = useState(false);
  const [chatLog, setChatLog] = useState<Array<{ sender: 'user' | 'agent'; text: string; source?: string }>>([]);
  const [showProgressMap, setShowProgressMap] = useState(false);
  const [showWhy, setShowWhy] = useState(true);

  const currentUnit = getUnitById(activeUnitId) ?? CURRICULUM_UNITS[0];
  const unitTemplates = currentUnit.templates;

  const currentTaskState = learningRecord.tasks[activeTaskId] ?? {
    taskId: activeTaskId,
    templateId: activeTaskId,
    status: 'active',
    helpLevel: 'none',
    assignedNodeIds: [],
  };

  const isCompleted = currentTaskState.status === 'completed';

  const completedCount = unitTemplates.filter(
    (t) => learningRecord.tasks[t.id]?.status === 'completed',
  ).length;

  const handleSendQuestion = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const query = questionInput.trim();
    if (!query || isAsking) return;

    setChatLog((prev) => [...prev, { sender: 'user', text: query }]);
    setQuestionInput('');
    setIsAsking(true);

    try {
      const res = await askAI(query, chatLog);
      setChatLog((prev) => [
        ...prev,
        { sender: 'agent', text: res.answer, source: res.source },
      ]);
    } catch {
      setChatLog((prev) => [
        ...prev,
        { sender: 'agent', text: 'אירעה שגיאה בחיבור למלווה. נסה שוב בעוד רגע.', source: 'local_approved' },
      ]);
    } finally {
      setIsAsking(false);
    }
  };

  const reference = designSnapshot ? enrichDesignSnapshot(designSnapshot, project) : null;
  useEffect(() => {
    if (!designSnapshot || designSnapshot.version === '3.0.0') return;
    const enriched = enrichDesignSnapshot(designSnapshot, project);
    const screen = enriched.screens.find(item => activeKotlinTaskId?.startsWith(`${item.id}_kotlin_`));
    useLearningStore.setState({ designSnapshot: enriched, ...(screen ? { kotlinTasks: generateKotlinLearningTasks(screen) } : {}) });
    useLearningStore.getState().persistSession();
  }, [designSnapshot, project, activeKotlinTaskId]);
  const referenceScreen = reference?.screens.find(screen => activeKotlinTaskId?.startsWith(`${screen.id}_kotlin_`));
  const activeKotlinTask = (referenceScreen ? generateKotlinLearningTasks(referenceScreen) : kotlinTasks).find((k) => k.id === activeKotlinTaskId);


  return (
    <div
      dir="rtl"
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: 'var(--bg-secondary, #12141A)',
        color: 'var(--text-primary, #F3F4F6)',
        display: 'flex',
        flexDirection: 'column',
        borderLeft: '1px solid var(--border-color, #232734)',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        userSelect: 'none',
      }}
    >
      {/* ─── Header & Unit Switcher ─────────────────────────────── */}
      <div
        style={{
          padding: '12px 14px',
          borderBottom: '1px solid var(--border-color, #232734)',
          backgroundColor: 'rgba(255, 255, 255, 0.02)',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                backgroundColor: 'rgba(59, 130, 246, 0.15)',
                border: '1px solid rgba(59, 130, 246, 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#3B82F6',
              }}
            >
              <SFSymbol name="sparkles" size={14} />
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: -0.2 }}>המלווה שלי</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted, #9CA3AF)' }}>
                {designSnapshot ? 'שלב המימוש ב־Kotlin' : 'שלב עיצוב המסכים'}
              </div>
            </div>
          </div>

          <button
            onClick={() => setShowProgressMap(!showProgressMap)}
            style={{
              background: 'none',
              border: 'none',
              color: showProgressMap ? '#3B82F6' : 'var(--text-muted, #9CA3AF)',
              cursor: 'pointer',
              fontSize: 11,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 6px',
              borderRadius: 6,
            }}
            title="מפת התקדמות המסלול"
          >
            <SFSymbol name="list.bullet" size={12} />
            <span>{completedCount}/{unitTemplates.length}</span>
          </button>
        </div>

        {/* 3-Screen Unit Tabs */}
        {!designSnapshot && (
          <div
            style={{
              display: 'flex',
              backgroundColor: 'rgba(0, 0, 0, 0.3)',
              borderRadius: 8,
              padding: 2,
              gap: 2,
            }}
          >
            {CURRICULUM_UNITS.map((unit) => {
              const isSelected = unit.id === activeUnitId;
              const unitDone = unit.templates.every(
                (t) => learningRecord.tasks[t.id]?.status === 'completed',
              );
              return (
                <button
                  key={unit.id}
                  onClick={() => switchUnit(unit.id)}
                  style={{
                    flex: 1,
                    padding: '5px 4px',
                    borderRadius: 6,
                    border: 'none',
                    backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.25)' : 'transparent',
                    color: isSelected ? '#93C5FD' : unitDone ? '#10B981' : '#9CA3AF',
                    fontSize: 11,
                    fontWeight: isSelected ? 700 : 500,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 4,
                    transition: 'all 0.15s ease',
                  }}
                >
                  {unitDone && <SFSymbol name="checkmark" size={9} color="#10B981" />}
                  <span>{unit.titleHe}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ─── Collapsible Progress Map ───────────────────────────── */}
      {showProgressMap && (
        <div
          style={{
            padding: '10px 14px',
            backgroundColor: 'rgba(0, 0, 0, 0.25)',
            borderBottom: '1px solid var(--border-color, #232734)',
            maxHeight: 180,
            overflowY: 'auto',
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 6, color: '#9CA3AF' }}>
            מפת צעדים — {currentUnit.titleHe}:
          </div>
          {unitTemplates.map((t) => {
            const st = learningRecord.tasks[t.id];
            const done = st?.status === 'completed';
            const isCurrent = t.id === activeTaskId;
            return (
              <div
                key={t.id}
                style={{
                  fontSize: 11,
                  padding: '3px 0',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  color: done ? '#10B981' : isCurrent ? '#3B82F6' : '#6B7280',
                  fontWeight: isCurrent ? 600 : 400,
                }}
              >
                <SFSymbol
                  name={done ? 'checkmark.circle.fill' : isCurrent ? 'arrow.forward.circle.fill' : 'circle'}
                  size={11}
                  color={done ? '#10B981' : isCurrent ? '#3B82F6' : '#4B5563'}
                />
                <span>
                  {t.stepNumber}. {t.titleHe}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* ─── Main Content Scrollable Area ───────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Kotlin Code Mode Card if Transitioned */}
        {designSnapshot && activeKotlinTask && referenceScreen ? (
          <GuidedKotlinCompanion key={`${project.learningProjectId ?? project.name}:${referenceScreen.id}`} screen={referenceScreen} file={activeKotlinTask.targetFile} />
        ) : (
          /* Active Design Task Card */
          <div
            style={{
              backgroundColor: isCompleted ? 'rgba(16, 185, 129, 0.08)' : 'rgba(59, 130, 246, 0.06)',
              border: `1px solid ${isCompleted ? 'rgba(16, 185, 129, 0.3)' : 'rgba(59, 130, 246, 0.25)'}`,
              borderRadius: 12,
              padding: 14,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            {/* Badge & Step counter */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: 999,
                  backgroundColor: isCompleted ? 'rgba(16, 185, 129, 0.2)' : 'rgba(59, 130, 246, 0.2)',
                  color: isCompleted ? '#10B981' : '#60A5FA',
                }}
              >
                צעד {activeTemplate.stepNumber} מתוך {unitTemplates.length}
              </span>

              <span
                style={{
                  fontSize: 10,
                  color: isCompleted ? '#10B981' : 'var(--text-muted, #9CA3AF)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <SFSymbol name={isCompleted ? 'checkmark.seal.fill' : 'clock'} size={10} />
                {isCompleted ? 'הושלם בהצלחה' : 'בביצוע'}
              </span>
            </div>

            {/* Title & Prompt */}
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4, color: '#FFFFFF' }}>
                {activeTemplate.titleHe}
              </div>
              <div style={{ fontSize: 12, lineHeight: 1.5, color: '#E5E7EB' }}>
                {activeTemplate.promptHe}
              </div>
            </div>

            {/* Why section */}
            <div
              style={{
                fontSize: 11,
                backgroundColor: 'rgba(0, 0, 0, 0.2)',
                padding: '8px 10px',
                borderRadius: 8,
                border: '1px solid rgba(255, 255, 255, 0.05)',
              }}
            >
              <div
                onClick={() => setShowWhy(!showWhy)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                  fontWeight: 600,
                  color: '#93C5FD',
                  marginBottom: showWhy ? 4 : 0,
                }}
              >
                <span>למה אנחנו עושים את זה?</span>
                <SFSymbol name={showWhy ? 'chevron.up' : 'chevron.down'} size={9} />
              </div>
              {showWhy && (
                <div style={{ color: '#D1D5DB', lineHeight: 1.4 }}>
                  {activeTemplate.whyHe}
                </div>
              )}
            </div>

            {/* Feedback message if completed */}
            {isCompleted && (
              <div
                style={{
                  padding: '8px 10px',
                  borderRadius: 8,
                  backgroundColor: 'rgba(16, 185, 129, 0.15)',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  color: '#34D399',
                  fontSize: 11,
                  lineHeight: 1.4,
                }}
              >
                {currentTaskState.feedbackMessage || 'מצוין! המשימה הושלמה בהצלחה.'}
              </div>
            )}

            {/* Action Buttons Row */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
              {activeTemplate.toolHighlightTarget && !isCompleted && (
                <button
                  onClick={showMeWhere}
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    padding: '7px 10px',
                    borderRadius: 8,
                    backgroundColor: 'rgba(59, 130, 246, 0.15)',
                    border: '1px solid rgba(59, 130, 246, 0.4)',
                    color: '#60A5FA',
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  <SFSymbol name="viewfinder" size={12} />
                  <span>הראה לי איפה</span>
                </button>
              )}

              {!isCompleted && activeTemplate.hintsHe.length > 0 && (
                <button
                  onClick={requestHint}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 5,
                    padding: '7px 10px',
                    borderRadius: 8,
                    backgroundColor: 'rgba(245, 158, 11, 0.12)',
                    border: '1px solid rgba(245, 158, 11, 0.35)',
                    color: '#FBBF24',
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  <SFSymbol name="lightbulb.fill" size={11} />
                  <span>רמז {hintIndex > 0 ? `(${hintIndex}/${activeTemplate.hintsHe.length})` : ''}</span>
                </button>
              )}

              {!isCompleted && (
                <button
                  onClick={checkCurrentTask}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 5,
                    padding: '7px 10px',
                    borderRadius: 8,
                    backgroundColor: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    color: '#E5E7EB',
                    fontSize: 11,
                    fontWeight: 500,
                    cursor: 'pointer',
                  }}
                >
                  <SFSymbol name="arrow.clockwise" size={11} />
                  <span>בדוק אותי</span>
                </button>
              )}
            </div>

            {/* Prominent Proceed Button when completed */}
            {isCompleted && (
              <button
                onClick={proceedToNextTask}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  padding: '10px 14px',
                  borderRadius: 8,
                  backgroundColor: '#10B981',
                  border: 'none',
                  color: '#FFFFFF',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                  boxShadow: '0 2px 10px rgba(16, 185, 129, 0.3)',
                }}
              >
                <span>המשך לשלב הבא</span>
                <SFSymbol name="arrow.left" size={12} color="#FFFFFF" />
              </button>
            )}
          </div>
        )}

        {/* Big CTA: Transition from Design to Code! */}
        {!designSnapshot && (
          <button
            onClick={() => {
              const snap = startWritingMyScreens();
              if (!snap) {
                alert('נא ליצור לפחות מסך אחד לפני המעבר לקוד.');
              }
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              padding: '12px 16px',
              borderRadius: 10,
              backgroundColor: 'linear-gradient(135deg, #7C3AED 0%, #4F46E5 100%)',
              background: '#6366F1',
              border: 'none',
              color: '#FFFFFF',
              fontSize: 13,
              fontWeight: 700,
              cursor: 'pointer',
              boxShadow: '0 4px 14px rgba(99, 102, 241, 0.35)',
              transition: 'all 0.15s ease',
            }}
          >
            <SFSymbol name="chevron.left.forwardslash.chevron.right" size={13} color="#FFFFFF" />
            <span>מתחילים לכתוב את המסכים שלי</span>
          </button>
        )}

        {/* Revealed Hints Box */}
        {hintIndex > 0 && (
          <div
            style={{
              padding: '10px 12px',
              borderRadius: 10,
              backgroundColor: 'rgba(245, 158, 11, 0.08)',
              border: '1px solid rgba(245, 158, 11, 0.25)',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#FBBF24', fontSize: 11, fontWeight: 600 }}>
              <SFSymbol name="lightbulb.fill" size={12} />
              <span>רמזים לעזרה:</span>
            </div>
            {activeTemplate.hintsHe.slice(0, hintIndex).map((hint, idx) => (
              <div key={idx} style={{ fontSize: 11, color: '#FDE68A', lineHeight: 1.4 }}>
                • {hint}
              </div>
            ))}
          </div>
        )}

        {/* Cost-Effective AI & Q&A */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted, #9CA3AF)' }}>
              שאל שאלה חופשית:
            </span>
            <span style={{ fontSize: 9, color: '#6B7280' }}>
              AI חסכוני ומבוקר (0 API לשאלות שגרתיות)
            </span>
          </div>

          {chatLog.length > 0 && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                maxHeight: 140,
                overflowY: 'auto',
                padding: '8px 10px',
                backgroundColor: 'rgba(0, 0, 0, 0.2)',
                borderRadius: 8,
              }}
            >
              {chatLog.map((msg, i) => (
                <div
                  key={i}
                  style={{
                    alignSelf: msg.sender === 'user' ? 'flex-start' : 'flex-end',
                    backgroundColor: msg.sender === 'user' ? 'rgba(59, 130, 246, 0.2)' : 'rgba(255, 255, 255, 0.06)',
                    padding: '6px 10px',
                    borderRadius: 8,
                    fontSize: 11,
                    maxWidth: '90%',
                    lineHeight: 1.4,
                  }}
                >
                  <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', unicodeBidi: 'plaintext' }}>{msg.text}</div>
                  {msg.source === 'local_approved' && <div style={{ fontSize: 10, opacity: 0.65, marginTop: 5 }}>הסבר מובנה · ללא קריאת AI</div>}
                  {msg.source === 'unavailable' && <div>המענה האישי אינו זמין</div>}
                </div>
              ))}
            </div>
          )}

          <form onSubmit={handleSendQuestion} style={{ display: 'flex', gap: 6 }}>
            <input
              type="text"
              value={questionInput}
              onChange={(e) => setQuestionInput(e.target.value)}
              placeholder="שאל שאלה על הרכיב, העיצוב או הקוד..."
              disabled={isAsking}
              style={{
                flex: 1,
                padding: '6px 10px',
                borderRadius: 6,
                backgroundColor: 'var(--bg-canvas, #1E232F)',
                border: '1px solid var(--border-color, #374151)',
                color: '#FFFFFF',
                fontSize: 11,
                outline: 'none',
              }}
            />
            <button
              type="submit"
              disabled={!questionInput.trim() || isAsking}
              style={{
                padding: '6px 10px',
                borderRadius: 6,
                backgroundColor: 'var(--accent-primary, #3B82F6)',
                border: 'none',
                color: '#FFFFFF',
                fontSize: 11,
                fontWeight: 600,
                cursor: questionInput.trim() && !isAsking ? 'pointer' : 'default',
                opacity: questionInput.trim() && !isAsking ? 1 : 0.5,
              }}
            >
              {isAsking ? '...' : 'שאל'}
            </button>
          </form>
        </div>
      </div>

      {/* ─── Footer: Reset / Status ─────────────────────────────── */}
      <div
        style={{
          padding: '8px 14px',
          borderTop: '1px solid var(--border-color, #232734)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: 10,
          color: 'var(--text-muted, #9CA3AF)',
        }}
      >
        <span role="status">{saveError ?? (sessionSavedAt ? 'הפרויקט וההתקדמות נשמרו מקומית' : 'טרם נשמר')}</span>
        <button
          onClick={() => {
            if (confirm('האם לאפס את התקדמות המשימות?')) {
              resetProgress();
            }
          }}
          style={{
            background: 'none',
            border: 'none',
            color: '#6B7280',
            cursor: 'pointer',
            fontSize: 10,
            textDecoration: 'underline',
          }}
        >
          איפוס
        </button>
      </div>
    </div>
  );
}
