// apps/web/src/App.tsx
//
// Root application component for AgenticDesigner.
// Mounts EditorView with the macOS dark desktop design system.

import React from 'react';
import { EditorView } from './views/EditorView';

export function App() {
  return <EditorView />;
}

export default App;
