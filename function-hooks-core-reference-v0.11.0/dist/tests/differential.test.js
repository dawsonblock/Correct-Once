import test from "node:test";
import assert from "node:assert/strict";
import { runDifferentialQualification } from "../tools/differential-qualifier.js";
test("reference and portable runtimes remain equivalent across deterministic generated chains", async () => {
    const report = await runDifferentialQualification(256);
    assert.equal(report.failed, 0, JSON.stringify(report, null, 2));
    assert.equal(report.comparedDispatches, 768);
});
//# sourceMappingURL=differential.test.js.map