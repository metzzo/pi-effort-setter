import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  ModelThinkingLevelMemory,
  ThinkingLevelStore,
} from "../src/model-thinking-levels.js";

const SOL = { provider: "openai-codex", id: "gpt-5.6-sol" };
const K3 = { provider: "kimi-coding", id: "k3" };
const MODULE_PATH = resolve("src/model-thinking-levels.js");

function withTempStore(run) {
  const directory = mkdtempSync(join(tmpdir(), "pi-model-thinking-levels-"));
  try {
    return run({ directory, store: new ThinkingLevelStore(directory) });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function listFiles(directory) {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
}

function readEntries(directory) {
  return listFiles(directory)
    .filter((path) => path.endsWith(".json"))
    .map((path) => JSON.parse(readFileSync(path, "utf8")))
    .sort((a, b) => `${a.provider}/${a.modelId}`.localeCompare(`${b.provider}/${b.modelId}`));
}

function runWriter(directory, model, level) {
  const program = [
    `import { ThinkingLevelStore } from ${JSON.stringify(MODULE_PATH)};`,
    "const [directory, provider, id, level] = process.argv.slice(1);",
    "new ThinkingLevelStore(directory).set({ provider, id }, level);",
  ].join("\n");

  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      ["--input-type=module", "--eval", program, directory, model.provider, model.id, level],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`writer exited ${code}: ${stderr}`));
    });
  });
}

test("first activation keeps and persists the current level", () => {
  withTempStore(({ directory, store }) => {
    const memory = new ModelThinkingLevelMemory(store);

    assert.equal(memory.activate(SOL, "xhigh"), "xhigh");
    assert.equal(store.get(SOL), "xhigh");
    assert.deepEqual(readEntries(directory), [
      {
        version: 1,
        provider: "openai-codex",
        modelId: "gpt-5.6-sol",
        level: "xhigh",
      },
    ]);
  });
});

test("each provider/model pair restores its own level", () => {
  withTempStore(({ store }) => {
    const memory = new ModelThinkingLevelMemory(store);

    memory.activate(SOL, "high");
    assert.equal(memory.recordChange(SOL, "xhigh"), true);
    memory.activate(K3, "medium");
    assert.equal(memory.recordChange(K3, "high"), true);

    assert.equal(memory.activate(SOL, "high"), "xhigh");
    assert.equal(memory.activate(K3, "medium"), "high");
  });
});

test("the provider is part of model identity", () => {
  withTempStore(({ store }) => {
    const memory = new ModelThinkingLevelMemory(store);
    const otherK3 = { provider: "another-provider", id: "k3" };

    memory.activate(K3, "high");
    memory.activate(otherK3, "low");

    assert.equal(store.get(K3), "high");
    assert.equal(store.get(otherK3), "low");
  });
});

test("model names that are JavaScript inherited-property names work normally", () => {
  withTempStore(({ store }) => {
    const specialModels = [
      { provider: "__proto__", id: "constructor" },
      { provider: "toString", id: "__proto__" },
    ];

    store.set(specialModels[0], "max");
    store.set(specialModels[1], "minimal");

    assert.equal(store.get(specialModels[0]), "max");
    assert.equal(store.get(specialModels[1]), "minimal");
  });
});

test("an interim clamp for the next model does not overwrite its memory", () => {
  withTempStore(({ store }) => {
    const memory = new ModelThinkingLevelMemory(store);

    memory.activate(K3, "low");
    memory.activate(SOL, "xhigh");

    assert.equal(memory.recordChange(K3, "high"), false);
    assert.equal(memory.activate(K3, "high"), "low");
  });
});

test("an explicit scoped-model level is not persisted before its effective value", () => {
  withTempStore(({ store }) => {
    const memory = new ModelThinkingLevelMemory(store);

    memory.activate(K3, "low");
    assert.equal(memory.activate(K3, "high", { restore: false }), "high");
    assert.equal(store.get(K3), "low");
    assert.equal(memory.recordChange(K3, "high"), true);
    assert.equal(store.get(K3), "high");
  });
});

test("recording the effective level updates an unsupported saved preference", () => {
  withTempStore(({ store }) => {
    const memory = new ModelThinkingLevelMemory(store);

    memory.activate(SOL, "xhigh");
    assert.equal(memory.activate(SOL, "high"), "xhigh");
    assert.equal(memory.recordChange(SOL, "high"), true);
    assert.equal(store.get(SOL), "high");
  });
});

test("saved levels survive a new store and extension instance", () => {
  withTempStore(({ directory, store }) => {
    const firstMemory = new ModelThinkingLevelMemory(store);
    firstMemory.activate(SOL, "xhigh");

    const secondMemory = new ModelThinkingLevelMemory(new ThinkingLevelStore(directory));
    assert.equal(secondMemory.activate(SOL, "medium"), "xhigh");
  });
});

test("different models can be written concurrently by separate processes", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-model-thinking-levels-processes-"));
  try {
    await Promise.all([
      runWriter(directory, SOL, "xhigh"),
      runWriter(directory, K3, "high"),
    ]);

    const store = new ThinkingLevelStore(directory);
    assert.equal(store.get(SOL), "xhigh");
    assert.equal(store.get(K3), "high");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("atomic writes leave no temporary files behind", () => {
  withTempStore(({ directory, store }) => {
    store.set(SOL, "xhigh");
    store.set(SOL, "high");

    const files = listFiles(directory);
    assert.equal(files.length, 1);
    assert.match(files[0], /\.json$/);
  });
});

test("get rejects malformed state instead of silently using it", () => {
  withTempStore(({ directory, store }) => {
    store.set(SOL, "xhigh");
    writeFileSync(listFiles(directory)[0], "not json\n", "utf8");
    assert.throws(() => store.get(SOL), /valid JSON/);
  });
});

test("get rejects unsupported, mismatched, or invalid entries", async (t) => {
  async function withCorruptEntry(entry, pattern) {
    withTempStore(({ directory, store }) => {
      store.set(SOL, "xhigh");
      writeFileSync(listFiles(directory)[0], `${JSON.stringify(entry)}\n`, "utf8");
      assert.throws(() => store.get(SOL), pattern);
    });
  }

  await t.test("unsupported version", () =>
    withCorruptEntry({ version: 2, provider: SOL.provider, modelId: SOL.id, level: "xhigh" }, /version 1/));
  await t.test("non-object entry", () => withCorruptEntry(null, /version 1/));
  await t.test("different provider", () =>
    withCorruptEntry({ version: 1, provider: "other", modelId: SOL.id, level: "xhigh" }, /does not match/));
  await t.test("different model id", () =>
    withCorruptEntry({ version: 1, provider: SOL.provider, modelId: "other", level: "xhigh" }, /does not match/));
  await t.test("invalid thinking level", () =>
    withCorruptEntry({ version: 1, provider: SOL.provider, modelId: SOL.id, level: "extreme" }, /invalid thinking level/));
});

test("get propagates filesystem errors other than a missing file", () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-model-thinking-levels-file-"));
  const path = join(directory, "not-a-directory");
  try {
    writeFileSync(path, "file\n", "utf8");
    assert.throws(() => new ThinkingLevelStore(path).get(SOL));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("model and thinking-level inputs are validated", () => {
  withTempStore(({ store }) => {
    const unicodeModel = { provider: "provider-🙂", id: "モデル" };
    store.set(unicodeModel, "high");
    assert.equal(store.get(unicodeModel), "high");

    assert.throws(() => store.get({ provider: "", id: "model" }), /provider/);
    assert.throws(() => store.get({ provider: "provider", id: "" }), /Model id/);
    assert.throws(() => store.get({ provider: "provider-\ud800", id: "model" }), /surrogate/);
    assert.throws(() => store.get({ provider: "provider", id: "model-\udfff" }), /surrogate/);
    assert.throws(() => store.set(SOL, "extreme"), /thinking level/);
  });
});
