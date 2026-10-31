/** Opt-in real toolchain smoke test; uses its own app and never modifies student sources. */
import { AndroidRunner } from '../apps/server/src/services/AndroidRunner.js';
const result = await new AndroidRunner().run({
  projectId: 'agentic-android-runtime-smoke', runId: 'android-smoke',
  entryFile: 'app/src/main/java/com/example/app/ui/SmokeScreen.kt', entryFunction: 'SmokeScreen',
  files: { 'app/src/main/java/com/example/app/ui/SmokeScreen.kt': `package com.example.app.ui
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
@Composable
fun SmokeScreen() {
 var count by remember { mutableStateOf(0) }
 Column(Modifier.padding(32.dp)) {
  Text("AgenticDesigner — Android", style = MaterialTheme.typography.headlineSmall)
  Text("הרצה אמיתית של Kotlin מתוך הדפדפן")
  Button(onClick = { count++ }) { Text("לחצת $count פעמים") }
 }
}
` },
}, message => console.log(message));
console.log(JSON.stringify(result, null, 2));
if (!result.success) process.exitCode = 1;
