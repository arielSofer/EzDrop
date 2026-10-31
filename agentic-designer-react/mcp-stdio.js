#!/usr/bin/env node
// Simple stdio-to-HTTP JSON-RPC relay for MCP clients (Antigravity IDE, Claude, Cursor)
import readline from 'node:readline';

const MCP_URL = process.env.AGENTIC_MCP_URL || 'http://127.0.0.1:8765/mcp';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

rl.on('line', async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  try {
    const res = await fetch(MCP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: trimmed,
    });

    const body = await res.text();
    if (body) {
      process.stdout.write(body + '\n');
    }
  } catch (err) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.id !== undefined) {
        process.stdout.write(
          JSON.stringify({
            jsonrpc: '2.0',
            id: parsed.id,
            error: { code: -32603, message: `MCP relay failed: ${err.message}` },
          }) + '\n'
        );
      }
    } catch {
      // Ignore unparseable lines
    }
  }
});
