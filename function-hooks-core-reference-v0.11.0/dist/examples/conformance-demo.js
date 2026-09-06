import { createKernel } from "@function-hooks/core";
import { runKernelConformance } from "@function-hooks/core/conformance";
const report = await runKernelConformance(createKernel);
if (report.failed !== 0) {
    console.error(JSON.stringify(report, null, 2));
    process.exitCode = 1;
}
else {
    console.log(`kernel conformance: ${report.passed}/${report.total} PASS (${report.semanticsVersion})`);
}
//# sourceMappingURL=conformance-demo.js.map