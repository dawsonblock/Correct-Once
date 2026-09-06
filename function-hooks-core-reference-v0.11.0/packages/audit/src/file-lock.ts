import { open, readFile, stat, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";

interface FileLockOptions {
  readonly enabled?: boolean;
  readonly timeoutMs?: number;
  readonly staleMs?: number;
}

interface LockRecord {
  readonly token: string;
  readonly pid: number;
  readonly host: string;
  readonly createdAt: number;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error: any) { return error?.code === "EPERM"; }
}

async function staleLock(lockPath: string, staleMs: number): Promise<boolean> {
  try {
    const info = await stat(lockPath);
    let record: LockRecord | undefined;
    try { record = JSON.parse(await readFile(lockPath, "utf8") as string) as LockRecord; } catch { /* malformed lock; age decides recovery */ }
    // Same-host crash recovery does not wait for the stale timeout when the owner PID is gone.
    if (record?.host === hostname()) return !processAlive(record.pid);
    if (Date.now() - info.mtimeMs < staleMs) return false;
    return true;
  } catch (error: any) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export async function withFileLock<T>(resourcePath: string, options: FileLockOptions, operation: () => Promise<T>): Promise<T> {
  if (options.enabled === false) return operation();
  const lockPath = `${resourcePath}.lock`;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const staleMs = options.staleMs ?? 300_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("File lock timeoutMs must be a finite positive number.");
  if (!Number.isFinite(staleMs) || staleMs <= 0) throw new Error("File lock staleMs must be a finite positive number.");
  const started = Date.now();
  const token = randomUUID();
  const record: LockRecord = { token, pid: process.pid, host: hostname(), createdAt: Date.now() };
  let handle: any;
  while (!handle) {
    try {
      handle = await open(lockPath, "wx");
      await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8");
      await handle.sync();
    } catch (error: any) {
      if (error?.code !== "EEXIST") throw error;
      if (await staleLock(lockPath, staleMs)) {
        try { await unlink(lockPath); } catch (unlinkError: any) { if (unlinkError?.code !== "ENOENT") throw unlinkError; }
        continue;
      }
      if (Date.now() - started >= timeoutMs) throw new Error(`Timed out acquiring cross-process lock for ${resourcePath}.`);
      await sleep(Math.min(50, Math.max(5, Math.floor((Date.now() - started) / 20) + 5)));
    }
  }
  try {
    return await operation();
  } finally {
    try { await handle.close(); } catch { /* best effort */ }
    try {
      const current = JSON.parse(await readFile(lockPath, "utf8") as string) as LockRecord;
      if (current?.token === token) await unlink(lockPath);
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}
