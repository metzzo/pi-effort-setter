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
  writeFileSync,
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
const modelA = parseModel(process.env.PI_INTEGRATION_MODEL_A ?? "openai-codex/gpt-6.1-sol");
const modelB = parseModel(process.env.PI_INTEGRATION_MODEL_B ?? "kimi-coding/k3");
const levelA = process.env.PI_INTEGRATION_LEVEL_A ?? "xhigh";
const levelB = process.env.PI_INTEGRATION_LEVEL_B ?? "high";

// Custom capability-restricted models. The provider is never contacted: the
// suite makes no LLM request.
const noReasoningModel = { provider: "test-clamp", id: "no-reasoning" };
const holeyModel = { provider: "test-clamp", id: "holey" };

function customModelsConfiguration() {
  const cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  return {
    providers: {
      [noReasoningModel.provider]: {
        baseUrl: "http://127.0.0.1:9/v1",
        api: "openai-completions",
        apiKey: "test",
        models: [
          {
            id: noReasoningModel.id,
            name: "No Reasoning",
            reasoning: false,
            input: ["text"],
            contextWindow: 8192,
            maxTokens: 1024,
            cost,
          },
          {
            id: holeyModel.id,
            name: "Holey",
            reasoning: true,
            thinkingLevelMap: {
              minimal: null,
              low: null,
              medium: null,
              high: "high",
              xhigh: null,
              max: "max",
            },
            input: ["text"],
            contextWindow: 8192,
            maxTokens: 1024,
            cost,
          },
        ],
      },
    },
  };
}

function writeSavedLevel(agentDir, model, level) {
  const path = join(
    agentDir,
    "model-thinking-levels",
    Buffer.from(model.provider, "utf8").toString("hex"),
    `${Buffer.from(model.id, "utf8").toString("hex")}.json`,
  );
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    `${JSON.stringify({ version: 1, provider: model.provider, modelId: model.id, level }, null, 2)}\n`,
    "utf8",
  );
}

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

  async close(options = {}) {
    this.#child.stdin.end();
    const result = await this.#exit;
    assert.deepEqual(result, { code: 0, signal: null });
    if (options.stderrPattern) assert.match(this.#stderr, options.stderrPattern);
    else assert.equal(this.#stderr, "");
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

async function scopedCycleCase(agentDir) {
  writeSavedLevel(agentDir, modelA, levelA);
  writeSavedLevel(agentDir, modelB, levelB);
  const rpc = new RpcProcess(agentDir, [
    "--model",
    modelSpecification(modelA),
    "--thinking",
    "off",
    "--models",
    `${modelSpecification(modelA)},${modelSpecification(modelB)}`,
  ]);
  try {
    for (let index = 0; index < 8; index++) {
      const expectedModel = index % 2 === 0 ? modelB : modelA;
      const expectedLevel = index % 2 === 0 ? levelB : levelA;
      const cycled = await send(rpc, { id: `cycle-${index}`, type: "cycle_model" });
      assert.equal(cycled.data.model.provider, expectedModel.provider);
      assert.equal(cycled.data.model.id, expectedModel.id);
      assert.equal(cycled.data.thinkingLevel, expectedLevel);
      assert.equal(cycled.data.isScoped, true);
      const levels = readSavedLevels(agentDir);
      assert.equal(levels.get(`${modelA.provider}\0${modelA.id}`), levelA);
      assert.equal(levels.get(`${modelB.provider}\0${modelB.id}`), levelB);
    }
  } finally {
    await rpc.close();
  }
}

async function persistenceFailureDoesNotBlockPinCase(agentDir) {
  const statePath = join(agentDir, "model-thinking-levels");
  rmSync(statePath, { recursive: true, force: true });
  writeFileSync(statePath, "not a directory\n", "utf8");

  const rpc = new RpcProcess(agentDir, [
    "--model",
    modelSpecification(modelA),
    "--thinking",
    "off",
    "--models",
    `${modelSpecification(modelA)}:${levelA}`,
  ]);
  try {
    const state = await send(rpc, { id: "failed-persistence-pin", type: "get_state" });
    assert.equal(state.data.thinkingLevel, levelA);
  } finally {
    await rpc.close({ stderrPattern: /\[model-thinking-levels\]/ });
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

async function capabilityClampCase(agentDir) {
  rmSync(join(agentDir, "model-thinking-levels"), { recursive: true, force: true });
  writeSavedLevel(agentDir, noReasoningModel, "high");
  writeSavedLevel(agentDir, holeyModel, "xhigh");

  const rpc = new RpcProcess(agentDir, [
    "--model",
    modelSpecification(noReasoningModel),
    "--thinking",
    "high",
  ]);
  try {
    // The saved high is restored, Pi clamps it to off for a non-reasoning
    // model, and the extension must persist the clamped value.
    const clampedOff = await send(rpc, { id: "clamped-off", type: "get_state" });
    // Pi clamps holey maps upward first: saved xhigh becomes max.
    await send(rpc, { id: "to-holey", type: "set_model", provider: holeyModel.provider, modelId: holeyModel.id });
    const clampedMax = await send(rpc, { id: "clamped-max", type: "get_state" });

    assert.equal(clampedOff.data.thinkingLevel, "off");
    assert.equal(clampedMax.data.thinkingLevel, "max");
  } finally {
    await rpc.close();
  }

  const levels = readSavedLevels(agentDir);
  assert.equal(levels.get(`${noReasoningModel.provider}\0${noReasoningModel.id}`), "off");
  assert.equal(levels.get(`${holeyModel.provider}\0${holeyModel.id}`), "max");
}

async function clampedScopedPinCase(agentDir) {
  rmSync(join(agentDir, "model-thinking-levels"), { recursive: true, force: true });
  const rpc = new RpcProcess(agentDir, [
    "--model",
    modelSpecification(noReasoningModel),
    "--thinking",
    "off",
    "--models",
    `${modelSpecification(noReasoningModel)}:high`,
  ]);
  try {
    // The pin asks for high on a non-reasoning model: the live level and the
    // persisted value must both be the clamped off.
    const state = await send(rpc, { id: "clamped-pin", type: "get_state" });
    assert.equal(state.data.thinkingLevel, "off");
  } finally {
    await rpc.close();
  }

  const levels = readSavedLevels(agentDir);
  assert.equal(levels.get(`${noReasoningModel.provider}\0${noReasoningModel.id}`), "off");
}

async function offScopedPinCase(agentDir) {
  rmSync(join(agentDir, "model-thinking-levels"), { recursive: true, force: true });
  writeSavedLevel(agentDir, holeyModel, "max");
  const rpc = new RpcProcess(agentDir, [
    "--model",
    modelSpecification(holeyModel),
    "--thinking",
    "high",
    "--models",
    `${modelSpecification(holeyModel)}:off,${modelSpecification(noReasoningModel)}`,
  ]);
  try {
    // An off pin must beat learned max on startup and every switch.
    const startup = await send(rpc, { id: "off-startup", type: "get_state" });
    assert.equal(startup.data.thinkingLevel, "off");
    assert.equal(readSavedLevels(agentDir).get(`${holeyModel.provider}\0${holeyModel.id}`), "off");
    await send(rpc, { id: "learn-max", type: "set_thinking_level", level: "max" });
    assert.equal(readSavedLevels(agentDir).get(`${holeyModel.provider}\0${holeyModel.id}`), "max");
    await send(rpc, { id: "leave-off", type: "set_model", provider: noReasoningModel.provider, modelId: noReasoningModel.id });
    await send(rpc, { id: "return-off", type: "set_model", provider: holeyModel.provider, modelId: holeyModel.id });
    const direct = await send(rpc, { id: "direct-off", type: "get_state" });
    assert.equal(direct.data.thinkingLevel, "off");
    await send(rpc, { id: "cycle-away", type: "cycle_model" });
    const cycled = await send(rpc, { id: "cycle-off", type: "cycle_model" });
    assert.equal(cycled.data.model.id, holeyModel.id);
    assert.equal(cycled.data.thinkingLevel, "off");
    assert.equal(readSavedLevels(agentDir).get(`${holeyModel.provider}\0${holeyModel.id}`), "off");
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

  writeFileSync(
    join(temporaryAgentDir, "models.json"),
    `${JSON.stringify(customModelsConfiguration(), null, 2)}\n`,
    "utf8",
  );

  // Run first so earlier cases cannot supply the learned cycling preferences.
  await scopedCycleCase(temporaryAgentDir);
  await capabilityClampCase(temporaryAgentDir);
  await clampedScopedPinCase(temporaryAgentDir);
  await offScopedPinCase(temporaryAgentDir);
  await learnedPreferenceCase(temporaryAgentDir);
  await startupRestoreCase(temporaryAgentDir);
  await persistenceFailureDoesNotBlockPinCase(temporaryAgentDir);
  await directScopedPinCase(temporaryAgentDir);

  const levels = readSavedLevels(temporaryAgentDir);
  assert.equal(levels.get(`${modelA.provider}\0${modelA.id}`), levelA);
  assert.equal(levels.get(`${modelB.provider}\0${modelB.id}`), levelB);
  console.log(
    `Validated capability clamping, clamped/off scoped pins, learned restore, startup restore, repeated scoped cycling, persistence-independent scoped pins, and direct scoped pins for ${modelSpecification(modelA)}=${levelA} and ${modelSpecification(modelB)}=${levelB}`,
  );
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
