#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import readline from "node:readline";

const controlPath = process.argv[2];
const callStatePath = process.argv[3] ?? `${controlPath}.calls.json`;

if (!controlPath) {
  console.error("usage: stdio_mcp_server.mjs <control.json> [call-state.json]");
  process.exit(2);
}

function loadControl() {
  const parsed = JSON.parse(readFileSync(controlPath, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("control file must be a JSON object");
  }
  return parsed;
}

function toolEntries() {
  const control = loadControl();
  const tools = control.tools;
  if (!tools || typeof tools !== "object" || Array.isArray(tools)) {
    throw new Error("control.tools must be an object");
  }
  return Object.entries(tools);
}

function reply(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function error(id, code, message) {
  process.stdout.write(
    `${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`,
  );
}

function writeCallState(state) {
  writeFileSync(callStatePath, JSON.stringify(state), "utf8");
}

function incrementCallCount() {
  const state = JSON.parse(readFileSync(callStatePath, "utf8"));
  const current =
    typeof state.callCount === "number" && Number.isFinite(state.callCount)
      ? state.callCount
      : 0;
  writeCallState({ ...state, callCount: current + 1 });
}

writeCallState({ callCount: 0 });

const input = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

input.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let message;
  try {
    message = JSON.parse(trimmed);
  } catch (errorValue) {
    console.error(`invalid JSON-RPC input: ${trimmed}`);
    return;
  }

  const id = message.id;
  const method = message.method;

  if (method === "notifications/initialized" || method === "notifications/cancelled") {
    return;
  }

  if (method === "initialize") {
    reply(id, {
      protocolVersion: "2025-03-26",
      capabilities: {
        tools: {
          listChanged: false,
        },
      },
      serverInfo: {
        name: "correct-once-stdio-fixture",
        version: "0.1.0",
      },
    });
    return;
  }

  if (method === "tools/list") {
    reply(id, {
      tools: toolEntries().map(([name, config]) => ({
        name,
        description:
          typeof config.description === "string"
            ? config.description
            : `Fixture tool ${name}`,
        inputSchema:
          config.inputSchema && typeof config.inputSchema === "object"
            ? config.inputSchema
            : {},
        annotations:
          config.annotations && typeof config.annotations === "object"
            ? config.annotations
            : {},
      })),
    });
    return;
  }

  if (method === "tools/call") {
    const params = message.params ?? {};
    const name = params.name;
    const args = params.arguments ?? {};
    if (typeof name !== "string" || !name) {
      error(id, -32602, "tools/call requires params.name");
      return;
    }
    if (!args || typeof args !== "object" || Array.isArray(args)) {
      error(id, -32602, "tools/call requires params.arguments to be an object");
      return;
    }
    incrementCallCount();
    const entry = Object.fromEntries(toolEntries())[name];
    if (!entry || typeof entry !== "object") {
      error(id, -32602, `unknown tool: ${name}`);
      return;
    }
    if (entry.isError === true) {
      reply(id, {
        content: [
          {
            type: "text",
            text:
              typeof entry.errorText === "string"
                ? entry.errorText
                : `fixture error from ${name}`,
          },
        ],
        structuredContent:
          entry.errorResult && typeof entry.errorResult === "object"
            ? entry.errorResult
            : { ok: false },
        isError: true,
      });
      return;
    }
    const result =
      entry.result && typeof entry.result === "object" ? entry.result : { ok: true };
    reply(id, {
      content: [
        {
          type: "json",
          json: result,
        },
      ],
      structuredContent: result,
      _meta:
        entry.meta && typeof entry.meta === "object"
          ? entry.meta
          : { externalId: `${name}-fixture` },
      isError: false,
    });
    return;
  }

  error(id, -32601, `unsupported method: ${method}`);
});
