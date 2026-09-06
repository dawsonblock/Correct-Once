import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
const root = resolve("packages/portable/src");
const files=[];
async function walk(dir){ for(const e of await readdir(dir,{withFileTypes:true})){const p=resolve(dir,e.name); if(e.isDirectory()) await walk(p); else if(e.name.endsWith(".ts")) files.push(p);} }
await walk(root);
const failures=[];
const forbidden=[
  [/from\s+["']node:/, "node: import"],
  [/\bAsyncLocalStorage\b/, "AsyncLocalStorage"],
  [/\bprocess\b/, "process global"],
  [/\bBuffer\b/, "Buffer global"],
  [/\brequire\s*\(/, "CommonJS require"],
  [/\b__dirname\b|\b__filename\b/, "Node path globals"],
];
for(const file of files){ const text=await readFile(file,"utf8"); for(const [rx,label] of forbidden){ if(rx.test(text)) failures.push(`${file}: ${label}`); } }
if(failures.length){ console.error(failures.join("\n")); process.exit(1); }
console.log("portable web-platform source gate: PASS (no Node runtime primitives)");
