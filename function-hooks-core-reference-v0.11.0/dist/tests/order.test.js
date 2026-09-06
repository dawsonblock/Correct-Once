import test from "node:test";
import assert from "node:assert/strict";
import { resolvePluginOrder } from "../src/index.js";
test("managed prepend/append surround dependency-ordered plugins", () => {
    const order = resolvePluginOrder([
        { name: "admin" },
        { name: "base" },
        { name: "feature", dependencies: ["base"] },
        { name: "tail" },
    ], { prepend: ["admin"], append: ["tail"] });
    assert.deepEqual(order, ["admin", "base", "feature", "tail"]);
});
//# sourceMappingURL=order.test.js.map