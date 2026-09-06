import test from "node:test";
import assert from "node:assert/strict";
import { validateDescriptor } from "../src/index.js";
test("hook modules must stay under hooks directory", () => {
    assert.throws(() => validateDescriptor("/tmp/plugin", { name: "x" }, { modules: ["../../escape.js"] }));
});
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readPluginDescriptor } from "../src/index.js";
test("readPluginDescriptor rejects hooks-module symlink escapes", async () => {
    const root = resolve(process.cwd(), `.tmp-symlink-plugin-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const outside = `${root}-outside.js`;
    await mkdir(resolve(root, "hooks"), { recursive: true });
    try {
        await writeFile(resolve(root, "plugin.json"), JSON.stringify({ name: "x" }), "utf8");
        await writeFile(resolve(root, "hooks", "hooks.json"), JSON.stringify({ modules: ["mod.js"] }), "utf8");
        await writeFile(outside, "export function register() {}\n", "utf8");
        await symlink(outside, resolve(root, "hooks", "mod.js"));
        await assert.rejects(() => readPluginDescriptor(root));
    }
    finally {
        await rm(root, { recursive: true, force: true });
        await rm(outside, { force: true });
    }
});
//# sourceMappingURL=manifest.test.js.map