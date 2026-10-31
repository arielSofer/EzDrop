import React, { useEffect, useState } from 'react';
import { bridge } from '../../bridge/bridgeClient';
import { useAndroidSetupStore } from '../../stores/androidSetupStore';

export function AndroidSetupWizard() {
  const setup = useAndroidSetupStore();
  const [accepted, setAccepted] = useState(false);
  const [starting, setStarting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testMessage, setTestMessage] = useState('');
  const testEmulator = async () => {
    setTesting(true); setTestMessage('בונה מסך בדיקה נפרד…');
    const runId = crypto.randomUUID();
    const unsubscribe = bridge.on('android.progress', event => { if (event.runId === runId) setTestMessage(event.message); });
    try {
      const result = await bridge.call('android.buildAndLaunch', { projectId: 'agentic-android-setup-check', runId,
        entryFile: 'app/src/main/java/com/example/setup/AndroidReadyScreen.kt', entryFunction: 'AndroidReadyScreen',
        files: { 'app/src/main/java/com/example/setup/AndroidReadyScreen.kt': `package com.example.setup
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
@Composable
fun AndroidReadyScreen() {
 var count by remember { mutableStateOf(0) }
 Column(Modifier.fillMaxSize().padding(32.dp)) {
  Text("Android מוכן ללמידה", style = MaterialTheme.typography.headlineMedium)
  Text("לחץ על הכפתור כדי לבדוק שהמסך מגיב")
  Button(onClick = { count++ }) { Text("לחיצות: $count") }
 }
}
` } });
      setTestMessage(result.success ? 'מסך הבדיקה נפתח בחלון האמולטור. לחץ על הכפתור ובדוק שהמונה משתנה.' : `${result.message}\n${result.output.slice(-3000)}`);
    } catch (error) { setTestMessage(`בדיקת ההרצה נכשלה: ${(error as Error).message}`); }
    finally { unsubscribe(); setTesting(false); }
  };
  useEffect(() => {
    if (!setup.open) { setAccepted(false); return; }
    const interval = setInterval(() => { void useAndroidSetupStore.getState().refresh(); }, 3000);
    return () => clearInterval(interval);
  }, [setup.open]);
  useEffect(() => {
    if (!setup.open) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); useAndroidSetupStore.getState().close(); } };
    window.addEventListener('keydown', close, true);
    return () => window.removeEventListener('keydown', close, true);
  }, [setup.open]);
  if (!setup.open) return null;
  const status = setup.status;
  const busy = starting || status?.running;
  return <div style={{ position: 'fixed', inset: 0, zIndex: 10000, background: '#000a', display: 'grid', placeItems: 'center', padding: 20 }}>
    <section role="dialog" aria-modal="true" aria-labelledby="android-setup-title" dir="rtl"
      style={{ width: 'min(560px, 95vw)', maxHeight: '90vh', overflow: 'auto', background: '#161c29', color: '#ecf0f8', border: '1px solid #38455d', borderRadius: 16, padding: 24, boxShadow: '0 20px 60px #0008' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 id="android-setup-title" style={{ margin: 0, fontSize: 21 }}>מכינים את Android במחשב שלך</h2>
        <button autoFocus onClick={setup.close} aria-label="סגור אשף הכנה" style={{ color: '#fff', background: 'transparent', border: 0, padding: 8, cursor: 'pointer' }}>✕</button>
      </div>
      <p style={{ color: '#bbc7db', lineHeight: 1.6 }}>הכנה חד־פעמית להרצת הקוד שלך באמולטור מקומי. אין צורך לפתוח פרויקט ב־Android Studio.</p>
      {status && <ul style={{ listStyle: 'none', padding: 0 }}>
        {status.components.map(component => <li key={component.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '10px 0', borderBottom: '1px solid #2b3444' }}>
          <span>{component.label}</span><span style={{ color: component.ready ? '#74dfb4' : '#f7cc83' }}>{component.ready ? '✓ מוכן' : 'נדרשת הכנה'}</span>
        </li>)}
      </ul>}
      <div role="status" style={{ lineHeight: 1.6, margin: '14px 0' }}>
        {status?.message || (setup.checking ? 'בודק את הכלים במחשב…' : status?.ready ? 'הכול מוכן. אפשר לחזור לקוד ולהריץ.' : 'המערכת תוריד ותתקין את הרכיבים החסרים.')}
      </div>
      {(setup.error || status?.error) && <pre role="alert" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 160, overflow: 'auto', color: '#ffb0b0', fontSize: 12 }}>{setup.error || status?.error}</pre>}
      {status?.supported && !status.ready && !status.running && <>
        <p style={{ color: '#bbc7db', fontSize: 13, lineHeight: 1.6 }}>נדרשים אינטרנט ולפחות 12 GB פנויים. ההורדות עשויות להגיע למספר GB. ההתקנה נשמרת בתיקיות המשתמש ואינה דורשת קריאות AI.</p>
        <label style={{ display: 'flex', gap: 10, fontSize: 13, lineHeight: 1.6, alignItems: 'flex-start' }}>
          <input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} />
          <span>אני מאשר להתקין במחשב ומסכים ל־<a href="https://developer.android.com/studio/terms" target="_blank" rel="noreferrer" style={{ color: '#91bfff' }}>תנאי Android SDK</a> ולרישיונות החבילות הנלוות. כלי Java מופץ תחת <a href="https://adoptium.net/about/" target="_blank" rel="noreferrer" style={{ color: '#91bfff' }}>רישיון Temurin</a>.</span>
        </label>
      </>}
      {busy && <p style={{ color: '#bbc7db', fontSize: 12 }}>אפשר לסגור את החלון או לרענן את הדף; ההתקנה תמשיך כל עוד השרת המקומי פועל.</p>}
      {testMessage && <p role="status" style={{ whiteSpace: 'pre-wrap', maxHeight: 150, overflow: 'auto' }}>{testMessage}</p>}
      {status?.ready && <button disabled={testing} onClick={() => void testEmulator()} style={{ ...primary, marginTop: 12 }}>
        {testing ? 'בודק הרצה באמולטור…' : 'פתח מסך בדיקה באמולטור'}
      </button>}
      <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
        {status?.ready ? <button onClick={setup.close} style={primary}>חזרה לקוד — מוכן להרצה</button> : status?.supported && <button
          disabled={!accepted || !!busy || setup.checking}
          onClick={async () => { setStarting(true); try { await setup.install(accepted); } finally { setStarting(false); } }}
          style={{ ...primary, opacity: !accepted || busy ? 0.5 : 1 }}>{busy ? 'ההתקנה מתבצעת…' : status.error ? 'נסה להתקין שוב' : 'התקן והכן את האמולטור'}</button>}
        <button onClick={() => void setup.refresh()} disabled={setup.checking} style={{ ...primary, background: '#303c50' }}>בדוק שוב</button>
      </div>
    </section>
  </div>;
}
const primary: React.CSSProperties = { background: '#377bf6', color: 'white', border: 0, borderRadius: 8, padding: '10px 15px', cursor: 'pointer', fontWeight: 600 };
