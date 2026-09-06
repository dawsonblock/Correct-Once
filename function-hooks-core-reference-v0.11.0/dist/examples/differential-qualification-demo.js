import { runDifferentialQualification } from "../tools/differential-qualifier.js";
const report = await runDifferentialQualification(256);
if (report.failed) {
    console.error(JSON.stringify(report, null, 2));
    process.exitCode = 1;
}
else {
    console.log(`dual-runtime differential qualification: PASS — ${report.iterations} generated chains / ${report.comparedDispatches} dispatches`);
}
//# sourceMappingURL=differential-qualification-demo.js.map