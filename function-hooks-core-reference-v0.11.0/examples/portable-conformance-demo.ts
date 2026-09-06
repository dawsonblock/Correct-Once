import { runKernelConformance } from "@function-hooks/core/conformance";
import { createPortableKernel } from "@function-hooks/portable";

const report = await runKernelConformance(createPortableKernel);
if (report.failed !== 0) {
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} else {
  console.log(`portable kernel conformance: ${report.passed}/${report.total} PASS (${report.semanticsVersion})`);
}
