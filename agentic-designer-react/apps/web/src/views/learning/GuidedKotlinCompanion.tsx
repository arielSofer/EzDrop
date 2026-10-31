import React, { useEffect, useMemo, useState } from 'react';
import type { ScreenSnapshot } from '@agentic/core';
import { useProjectStore } from '../../stores/projectStore';
import { useLearningStore } from '../../stores/learningStore';
import { useAndroidRunStore } from '../../stores/androidRunStore';
import { checkGuidedStep, guidedBatches } from './preview/guidedSteps';
interface Progress { step: string; completed: string[]; manual?: string[] }
export function GuidedKotlinCompanion({ screen, file }: { screen: ScreenSnapshot; file: string }) {
 const projectId = useProjectStore(s => s.project.learningProjectId ?? s.project.name);
 const source = useProjectStore(s => s.project.sourceOverrides?.[file] ?? '');
 const steps = useMemo(() => guidedBatches(screen), [screen]);
 const key = `agentic:guided-kotlin:v1:${projectId}:${screen.id}`;
 const [progress, setProgress] = useState<Progress>(() => {
  try { const saved = JSON.parse(localStorage.getItem(key) ?? 'null'); if (steps.some(step => step.members.some(member => member.id === saved?.step)) && Array.isArray(saved.completed)) return saved; } catch { /* local fallback */ }
  return { step: steps[0].id, completed: [] };
 });
 const [hint, setHint] = useState(0); const [solution, setSolution] = useState(false);
 const [answer, setAnswer] = useState(''); const [compared, setCompared] = useState(false);
 const [canReviewManually, setCanReviewManually] = useState(false);
 const [notice, setNotice] = useState(''); const [saveError, setSaveError] = useState('');
 const index = Math.max(0, steps.findIndex(step => step.members.some(member => member.id === progress.step))); const step = steps[index];
 useEffect(() => { setHint(0); setSolution(false); setAnswer(''); setCompared(false); setNotice(''); setCanReviewManually(false); }, [step.id]);
 useEffect(() => { setNotice(''); setCompared(false); setCanReviewManually(false); }, [source]);
 const save = (next: Progress) => {
  setProgress(next);
  try { localStorage.setItem(key, JSON.stringify(next)); setSaveError(''); }
  catch { setSaveError('ההתקדמות בצעדים לא נשמרה בדפדפן. השאר את החלון פתוח ונסה שוב.'); }
 };
 const advance = (manual = false) => {
  const failed = step.members.map(member => ({ member, error: checkGuidedStep(member, source, screen) })).find(result => result.error);
  const error = failed ? `${failed.member.title}: ${failed.error}` : null;
  if (error && !manual) { setNotice(`${error} אפשר לתקן ולבדוק שוב, או להמשיך לאחר השוואה ידנית לעיצוב.`); setCanReviewManually(true); return; }
  if (!compared) { setNotice('השווה את התוצאה לעיצוב וסמן שבדקת אותה.'); return; }
  if (step.id === 'review' && !useAndroidRunStore.getState().isCurrentSuccess(file)) { setNotice('יש להריץ את הקוד הנוכחי ב־Android לפני סיום המסך.'); return; }
  save({ manual: manual ? [...new Set([...(progress.manual ?? []), ...step.members.map(member => member.id)])] : progress.manual, step: steps[index + 1]?.id ?? step.id, completed: [...new Set([...progress.completed, ...step.members.map(member => member.id)])] });
  if (!steps[index + 1]) setNotice('סיימת את רצף הלימוד של המסך. אפשר לעבור למסך אחר דרך בורר המסכים.');
 };
 return <section className="guided-kotlin-card" aria-label="ליווי Kotlin במשימות משולבות" style={{ minWidth: 0, maxWidth: '100%', overflowWrap: 'anywhere', padding: 14, border: '1px solid #69428b', borderRadius: 12, background: '#21182e', fontSize: 12, lineHeight: 1.7 }}>
  <div style={{ color: '#cba9f4' }}>{screen.name} · משימה {index + 1} מתוך {steps.length}</div>
  <h3 style={{ marginBlock: 10 }}>{step.title}</h3>
  <strong>1. מסתכלים בעיצוב</strong><p>{step.observe}</p>
  <strong>2. מבינים לפני שכותבים</strong><p>{step.explain}</p>
  <strong>3. עכשיו תורך</strong><p>{step.instruction}</p>
  <ul style={{ paddingInlineStart: 18 }}>{step.members.map(member => <li key={member.id} style={{ marginBottom: 8 }}><strong>{member.title}</strong><p>{member.observe}</p><p>{member.explain}</p><p style={{ color: '#cde4ff' }}><strong>איך עושים: </strong>{member.instruction}</p></li>)}</ul>
  <p style={{ color: '#a8b8cf' }}>אם כבר כתבת את החלק הזה, בדוק והתאם אותו. אין צורך למחוק או להקליד מחדש.</p>
  <div style={{ marginBlock: 12 }}>
   {hint > 0 && <p>{step.hints[0]}</p>}
   {hint > 1 && <p>{step.hints[1]}</p>}
   {hint > 2 && <pre dir="ltr" style={{ whiteSpace: 'pre-wrap', background: '#11151f', padding: 10 }}>{step.hints[2]}</pre>}
   {hint < 3 && <button className="learning-control" onClick={() => setHint(hint + 1)}>{['אני צריך הסבר נוסף', 'רמז לתחביר', 'הצג דוגמה קטנה'][hint]}</button>}
   {hint === 3 && !solution && <button className="learning-control" onClick={() => setSolution(true)}>הצג פתרון למשימה</button>}
   {solution && <><p>דוגמאות לשילוב ברכיבים הקיימים — אין להדביק את כל הקטעים כרצף. פרמטרים נוספים משלבים באותה רשימת פרמטרים, בלי לשכפל את הרכיב.</p><pre dir="ltr" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', background: '#11151f', padding: 10 }}>{step.solution}</pre></>}
  </div>
  <strong>4. בודקים בתרחיש אמיתי</strong><p>{step.question}</p>
  <details><summary>רשום נימוק או נקודה לדיון עם המורה (רשות)</summary>
  <textarea aria-label="ההסבר שלי לצעד" value={answer} onChange={event => setAnswer(event.target.value)} placeholder="מה מצאת בבדיקה ומה שינית בעקבותיה?" style={{ width: '100%', minHeight: 70, background: '#121722', color: '#f3f4f6', border: '1px solid #665079', borderRadius: 6, padding: 8 }} />
  </details>
  <label style={{ display: 'flex', gap: 8, marginBlock: 8 }}><input type="checkbox" checked={compared} onChange={event => setCompared(event.target.checked)} />השוויתי ב־Preview מול עיצוב היעד</label>
  <p style={{ color: '#a8b8cf', fontSize: 11 }}>בדיקה מקומית בלבד: זיהוי רכיב ומאפיין כשנתמכים. התאמה חזותית ואיכות ההסבר נבדקות יחד עם המורה; אין כאן הערכת AI.</p>
  <p role="status" style={{ color: '#fcd38c' }}>{notice || saveError}</p>
  <button className="learning-control" style={{ width: '100%', background: '#7133a4', color: '#fff', marginBlock: 8 }} onClick={() => advance()}>{index < steps.length - 1 ? 'בדוק והמשך למשימה הבאה' : 'סיום המסך'}</button>
  {canReviewManually && step.id !== 'review' && <div style={{ border: '1px solid #8a6a38', borderRadius: 8, padding: 8, marginBottom: 8 }}>
   <p>הבדיקה המקומית לא אישרה את המשימה. אם בדקת את התוצאה מול העיצוב, אפשר להמשיך ולשמור אותה כ״נבדקה ידנית״.</p>
   <button className="learning-control" onClick={() => advance(true)}>המשך על סמך בדיקה ידנית</button>
  </div>}
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
   <button className="learning-control" disabled={index === 0} onClick={() => save({ ...progress, step: steps[index - 1].id })}>משימה קודמת</button>
   <button className="learning-control" onClick={() => useLearningStore.getState().backToDesignMode()}>חזרה לעיצוב</button>
  </div>
 </section>;
}
