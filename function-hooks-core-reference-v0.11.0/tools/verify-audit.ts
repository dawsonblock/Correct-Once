import { verifyDurableAuditJournal } from "../src/audit/durable-journal.js";

const path = process.argv[2];
if (!path) {
  console.error("Usage: node dist/tools/verify-audit.js <journal.jsonl>");
  process.exitCode = 2;
} else {
  verifyDurableAuditJournal(path)
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.error(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
      process.exitCode = 1;
    });
}
