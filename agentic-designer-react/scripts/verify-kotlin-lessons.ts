/** Builds the exact teaching examples and captures a real Android preview in an isolated app. */
import fs from 'node:fs';
import { getKotlinLesson } from '../packages/core/src/learning/codegen/kotlinLessons';
import { getDesignGuidance } from '../packages/core/src/learning/codegen/designGuidance';
import type { ScreenSnapshot } from '../packages/core/src/learning/codegen/designSnapshot';
import { AndroidRunner } from '../apps/server/src/services/AndroidRunner';
const examples = [1, 2, 3, 4].map(step => {
 const lesson = getKotlinLesson(step)!;
 const body = step === 1 ? lesson.examples[0].code : step === 2 ? `Column { ${lesson.examples[0].code} }` :
   `${lesson.examples[0].code}\nColumn { ${lesson.examples[1].code} }`;
 return `@Composable\nfun Lesson${step}() {\n${body}\n}`;
});
const design: ScreenSnapshot = { id: 'smoke', name: 'Design smoke', width: 390, height: 844, fillColor: '#101626', components: [
 { id: 'text', type: 'Text', name: 'Brand', text: 'PACEGUARD $5', width: 342, height: 24, x: 24, y: 60, fontSize: 18, textColor: '#c9ff36', textAlign: 'center' },
 { id: 'input', type: 'Input', name: 'Password', text: 'Password', isSecure: true, width: 342, height: 56, x: 24, y: 100, fillColor: '#202637', textColor: '#ffffff', stroke: '#515661', cornerRadius: 10 },
 { id: 'button', type: 'Button', name: 'Login', text: 'Log in', width: 342, height: 48, x: 24, y: 180, fillColor: '#c9ff36', textColor: '#111111', cornerRadius: 8 },
] };
const designExamples = [1,2,3,4].map(step => `@Composable fun DesignLesson${step}() {
var message by remember { mutableStateOf("") }
${getDesignGuidance(design, step).drills[0].code}
}`);
const source = `package com.example.lessons
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Shield
${getDesignGuidance(design, 1).imports.map(path => `import ${path}`).join('\n')}
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.tooling.preview.Preview
${examples.join('\n')}
${designExamples.join('\n')}
${getKotlinLesson(5)!.examples[0].code}
@Composable
fun LessonPreviewScreen() { Column(Modifier.padding(24.dp)) { Icon(imageVector = Icons.Filled.Shield, contentDescription = "Shield", tint = androidx.compose.ui.graphics.Color(0xFFCCFF33), modifier = Modifier.size(32.dp)); Lesson2(); Lesson3(); Lesson4() } }
`;
const result = await new AndroidRunner().run({ projectId: 'agentic-kotlin-lessons-smoke', runId: 'lessons-smoke',
 entryFile: 'app/src/main/java/com/example/lessons/LessonPreviewScreen.kt', entryFunction: 'LessonPreviewScreen',
 capturePreview: true, files: { 'app/src/main/java/com/example/lessons/LessonPreviewScreen.kt': source } }, message => console.log(message));
if (result.previewImage) fs.writeFileSync('/tmp/agentic-lessons-preview.png', Buffer.from(result.previewImage.split(',')[1], 'base64'));
console.log(JSON.stringify({ success: result.success, preview: !!result.previewImage, previewError: result.previewError, diagnostics: result.diagnostics, message: result.message }));
if (!result.success || !result.previewImage) { console.log(result.output); process.exitCode = 1; }
