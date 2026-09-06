// Runs the official @durable-agent-outbox/conformance public runner without Vitest.
// The donor source is compiled into a temporary work tree by qualify_upstream_dao.py.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.argv[2];
if (!root) {
  console.error("usage: node run_official.mjs <compiled-donor-root>");
  process.exit(2);
}
const modPath = path.join(root, "packages", "conformance", "dist", "index.js");
if (!fs.existsSync(modPath)) {
  console.error(`compiled conformance module missing: ${modPath}`);
  process.exit(2);
}
const {
  ALL_MUTANTS,
  ALL_SCENARIOS,
  createReferenceHarness,
  runConformance,
} = await import(pathToFileURL(modPath).href);

const reference = await runConformance({
  implementation: "durable-agent-outbox:upstream-reference",
  createHarness: createReferenceHarness,
});

const mutants = [];
for (const mutant of ALL_MUTANTS) {
  const report = await runConformance({
    implementation: `durable-agent-outbox:mutant:${mutant.id}`,
    createHarness: mutant.createHarness,
  });
  const failed = report.scenarios.filter((scenario) => !scenario.passed).map((scenario) => scenario.id);
  mutants.push({
    id: mutant.id,
    description: mutant.description,
    must_fail: [...mutant.mustFail],
    failed_scenarios: failed,
    passed_suite: report.passed,
    required_failures_observed: mutant.mustFail.every((id) => failed.includes(id)),
  });
}

const document = {
  schema: "effect-fabric/upstream-dao-runner/v1",
  scenarios: ALL_SCENARIOS.map((scenario) => ({ id: scenario.id, title: scenario.title })),
  reference,
  mutants,
};
process.stdout.write(`${JSON.stringify(document, null, 2)}\n`);
