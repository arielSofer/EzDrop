import React, { useEffect, useState } from 'react';
import { useLearningStore } from '../../stores/learningStore';
import { useProjectStore } from '../../stores/projectStore';
import { parseComposePreview, type PreviewDocument } from './preview/composePreview';
import { ComposePreviewCanvas } from './preview/ComposePreviewCanvas';
export function KotlinRuntimePreview() {
  const task = useLearningStore(s => s.kotlinTasks.find(task => task.id === s.activeKotlinTaskId));
  const screen = useLearningStore(s => s.designSnapshot?.screens.find(screen => task?.id.startsWith(`${screen.id}_kotlin_`)));
  const source = useProjectStore(s => task ? s.project.sourceOverrides?.[task.targetFile] ?? '' : '');
  const [snapshot, setSnapshot] = useState<{ file: string; source: string; document: PreviewDocument } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!task) return;
      try {
        const entry = task.targetFile.split('/').pop()!.replace(/\.kt$/, '');
        setSnapshot({ file: task.targetFile, source, document: parseComposePreview(source, entry) });
        setError('');
      } catch (e) { setError((e as Error).message); }
    }, 180);
    return () => clearTimeout(timer);
  }, [source, task?.targetFile]);
  const current = snapshot?.file === task?.targetFile ? snapshot : null;
  return <div dir="rtl" style={{ padding: 12, overflow: 'auto', flex: 1, fontSize: 12, lineHeight: 1.6 }}>
    <strong>Preview אינטראקטיבי · מתעדכן בהקלדה</strong>
    <p>תצוגה חזותית של רכיבי Compose בסיסיים, ללא Build וללא API. אפשר להקליד וללחוץ: שינויים במצב המקומי משתקפים במסך. שרתים, חיישנים ולוגיקה שאינה נתמכת נבדקים באמולטור. שינוי קוד מאפס את מצב הניסוי.</p>
    <p role="status" style={{ color: error ? '#fbbf24' : '#a7f3d0' }}>{error ? `${error} ${current ? 'מוצגת התצוגה התקינה האחרונה.' : ''}` : current?.source !== source ? 'מעדכן תצוגה…' : 'התצוגה מעודכנת'}</p>
    {current?.document.warnings.map(warning => <p key={warning} style={{ color: '#fbbf24' }}>{warning}</p>)}
    {current && <ComposePreviewCanvas document={current.document} width={screen?.width} height={screen?.height} />}
    {current && !current.document.nodes.length && <p>הפריסה עדיין ריקה. הוסף רכיב בתוך גוף המסך כדי לראות אותו כאן.</p>}
  </div>;
}
