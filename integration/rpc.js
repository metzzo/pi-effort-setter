import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionPath = join(repositoryRoot, "extensions", "model-thinking-levels.ts");
const sourceAgentDir = resolve(
  process.env.PI_INTEGRATION_SOURCE_AGENT_DIR ?? join(homedir(), ".pi", "agent"),
);
const piExecutable = process.env.PI_INTEGRATION_EXECUTABLE ?? "pi";
const modelA = parseModel(process.env.PI_INTEGRATION_MODEL_A ?? "openai-codex/gpt-5.6-sol");
const modelB = parseModel(process.env.PI_INTEGRATION_MODEL_B ?? "kimi-coding/k3");
const levelA = process.env.PI_INTEGRATION_LEVEL_A ?? "xhigh";
const levelB = process.env.PI_INTEGRATION_LEVEL_B ?? "high";

function parseModel(specification) {
  const separator = specification.indexOf("/");
  if (separator <= 0 || separator === specification.length - 1) {
    throw new Error(`Model must use provider/model-id format: ${specification}`);
  }
  return {
    provider: specification.slice(0, separator),
    id: specification.slice(separator + 1),
  };
}

function modelSpecification(model) {
  return `${model.provider}/${model.id}`;
}

class RpcProcess {
  #child;
  #events = [];
  #pending = new Map();
  #stderr = "";
  #stdoutBuffer = "";
  #exit;

  constructor(agentDir, arguments_) {
    this.#child = spawn(
      piExecutable,
      [
        "--mode",
        "rpc",
        "--no-session",
        "--no-extensions",
        "--extension",
        extensionPath,
        ...arguments_,
      ],
      {
        cwd: repositoryRoot,
        env: {
          ...process.env,
          PI_CODING_AGENT_DIR: agentDir,
          PI_OFFLINE: "1",
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    this.#child.stdout.setEncoding("utf8");
    this.#child.stderr.setEncoding("utf8");
    this.#child.stdout.on("data", (chunk) => this.#consumeStdout(chunk));
    this.#child.stderr.on("data", (chunk) => {
      this.#stderr += chunk;
    });
    this.#exit = new Promise((resolvePromise, reject) => {
      this.#child.on("error", reject);
      this.#child.on("exit", (code, signal) => {
        if (this.#stdoutBuffer.length > 0) {
          reject(new Error("Pi RPC ended with an unterminated JSONL record"));
          return;
        }
        for (const { reject: rejectResponse } of this.#pending.values()) {
          rejectResponse(new Error(`Pi RPC exited before responding (code=${code}, signal=${signal})`));
        }
        this.#pending.clear();
        resolvePromise({ code, signal });
      });
    });
  }

  #consumeStdout(chunk) {
    this.#stdoutBuffer += chunk;
    while (true) {
      const newline = this.#stdoutBuffer.indexOf("\n");
      if (newline === -1) return;
      let line = this.#stdoutBuffer.slice(0, newline);
      this.#stdoutBuffer = this.#stdoutBuffer.slice(newline + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      const event = JSON.parse(line);
      this.#events.push(event);
      if (event.type === "response" && event.id && this.#pending.has(event.id)) {
        const pending = this.#pending.get(event.id);
        this.#pending.delete(event.id);
        pending.resolve(event);
      }
    }
  }

  send(command) {
    return new Promise((resolvePromise, reject) => {
      this.#pending.set(command.id, { resolve: resolvePromise, reject });
      this.#child.stdin.write(`${JSON.stringify(command)}\n`, (error) => {
        if (!error) return;
        this.#pending.delete(command.id);
        reject(error);
      });
    });
  }

  async close() {
    this.#child.stdin.end();
    const result = await this.#exit;
    assert.deepEqual(result, { code: 0, signal: null });
    assert.equal(this.#stderr, "");
    assert.deepEqual(
      this.#events.filter((event) => event.type === "extension_error"),
      [],
    );
  }
}

async function send(rpc, command) {
  const response = await rpc.send(command);
  assert.equal(response.success, true, response.error);
  return response;
}

async function learnedPreferenceCase(agentDir) {
  const rpc = new RpcProcess(agentDir, [
    "--model",
    modelSpecification(modelA),
    "--thinking",
    levelA,
  ]);
  try {
    await send(rpc, { id: "to-b", type: "set_model", provider: modelB.provider, modelId: modelB.id });
    await send(rpc, { id: "b-level", type: "set_thinking_level", level: levelB });
    await send(rpc, { id: "to-a", type: "set_model", provider: modelA.provider, modelId: modelA.id });
    const restoredA = await send(rpc, { id: "restored-a", type: "get_state" });
    await send(rpc, { id: "back-b", type: "set_model", provider: modelB.provider, modelId: modelB.id });
    const restoredB = await send(rpc, { id: "restored-b", type: "get_state" });

    assert.equal(restoredA.data.thinkingLevel, levelA);
    assert.equal(restoredB.data.thinkingLevel, levelB);
  } finally {
    await rpc.close();
  }
}

async function startupRestoreCase(agentDir) {
  const rpc = new RpcProcess(agentDir, [
    "--model",
    modelSpecification(modelA),
    "--thinking",
    "off",
  ]);
  try {
    const startup = await send(rpc, { id: "startup-restore", type: "get_state" });
    assert.equal(startup.data.thinkingLevel, levelA);
  } finally {
    await rpc.close();
  }
}

async function directScopedPinCase(agentDir) {
  rmSync(join(agentDir, "model-thinking-levels"), { recursive: true, force: true });
  const rpc = new RpcProcess(agentDir, [
    "--model",
    modelSpecification(modelA),
    "--thinking",
    "off",
    "--models",
    `${modelSpecification(modelA)}:${levelA},${modelSpecification(modelB)}:${levelB}`,
  ]);
  try {
    const startup = await send(rpc, { id: "startup", type: "get_state" });
    await send(rpc, { id: "to-b", type: "set_model", provider: modelB.provider, modelId: modelB.id });
    const pinnedB = await send(rpc, { id: "pinned-b", type: "get_state" });
    await send(rpc, { id: "b-off", type: "set_thinking_level", level: "off" });
    await send(rpc, { id: "to-a", type: "set_model", provider: modelA.provider, modelId: modelA.id });
    const pinnedA = await send(rpc, { id: "pinned-a", type: "get_state" });
    await send(rpc, { id: "back-b", type: "set_model", provider: modelB.provider, modelId: modelB.id });
    const repinnedB = await send(rpc, { id: "repinned-b", type: "get_state" });

    assert.equal(startup.data.thinkingLevel, levelA);
    assert.equal(pinnedB.data.thinkingLevel, levelB);
    assert.equal(pinnedA.data.thinkingLevel, levelA);
    assert.equal(repinnedB.data.thinkingLevel, levelB);
  } finally {
    await rpc.close();
  }
}

function readSavedLevels(agentDir) {
  const root = join(agentDir, "model-thinking-levels");
  const levels = new Map();
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const data = JSON.parse(readFileSync(join(entry.parentPath, entry.name), "utf8"));
    levels.set(`${data.provider}\0${data.modelId}`, data.level);
  }
  return levels;
}

const temporaryRoot = mkdtempSync(join(tmpdir(), "pi-model-thinking-levels-rpc-"));
const temporaryAgentDir = join(temporaryRoot, "agent");
try {
  mkdirSync(temporaryAgentDir, { recursive: true });
  for (const name of ["auth.json", "models-store.json"]) {
    const source = join(sourceAgentDir, name);
    if (existsSync(source)) cpSync(source, join(temporaryAgentDir, name), { recursive: true });
  }

  await learnedPreferenceCase(temporaryAgentDir);
  await startupRestoreCase(temporaryAgentDir);
  await directScopedPinCase(temporaryAgentDir);

  const levels = readSavedLevels(temporaryAgentDir);
  assert.equal(levels.get(`${modelA.provider}\0${modelA.id}`), levelA);
  assert.equal(levels.get(`${modelB.provider}\0${modelB.id}`), levelB);
  console.log(
    `Validated learned restore, startup restore, and direct scoped pins for ${modelSpecification(modelA)}=${levelA} and ${modelSpecification(modelB)}=${levelB}`,
  );
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
