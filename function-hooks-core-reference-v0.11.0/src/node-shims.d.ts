declare const Buffer: any;
declare const process: any;

declare module "node:async_hooks" {
  export class AsyncLocalStorage<T> {
    getStore(): T | undefined;
    run<R>(store: T, callback: () => R): R;
  }
}

declare module "node:crypto" {
  export function randomUUID(): string;
  export function createHash(name: string): any;
  export function createHmac(name: string, key: any): any;
  export function timingSafeEqual(a: any, b: any): boolean;
  export function createPrivateKey(key: any): any;
  export function createPublicKey(key: any): any;
  export function sign(algorithm: any, data: any, key: any): any;
  export function verify(algorithm: any, data: any, key: any, signature: any): boolean;
  export function generateKeyPairSync(type: string): any;
}

declare module "node:url" {
  export function pathToFileURL(path: string): URL;
  export function fileURLToPath(url: string | URL): string;
}

declare module "node:path" {
  export function resolve(...paths: string[]): string;
  export function dirname(path: string): string;
  export function relative(from: string, to: string): string;
  export function join(...paths: string[]): string;
  export function isAbsolute(path: string): boolean;
  export function extname(path: string): string;
  export function basename(path: string): string;
  export const sep: string;
}

declare module "node:fs/promises" {
  export function readFile(path: string, encoding?: string): Promise<any>;
  export function readdir(path: string, options?: any): Promise<any[]>;
  export function writeFile(path: string, data: any, encoding?: string): Promise<void>;
  export function mkdir(path: string, options?: any): Promise<void>;
  export function rm(path: string, options?: any): Promise<void>;
  export function realpath(path: string): Promise<string>;
  export function mkdtemp(prefix: string): Promise<string>;
  export function lstat(path: string): Promise<any>;
  export function symlink(target: string, path: string): Promise<void>;
  export function open(path: string, flags: string): Promise<any>;
}

declare module "node:child_process" {
  export type ChildProcessWithoutNullStreams = any;
  export function spawn(command: string, args?: readonly string[], options?: any): ChildProcessWithoutNullStreams;
}

declare module "node:process" {
  const processValue: any;
  export default processValue;
}

declare module "node:test" {
  const test: (name: string, fn: () => unknown | Promise<unknown>) => void;
  export default test;
}

declare module "node:assert/strict" {
  const assert: {
    equal(actual: unknown, expected: unknown, message?: string): void;
    notEqual(actual: unknown, expected: unknown, message?: string): void;
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
    ok(value: unknown, message?: string): void;
    match(value: string, regexp: RegExp, message?: string): void;
    throws(fn: () => unknown, expected?: unknown): void;
    rejects(fn: (() => unknown | Promise<unknown>) | Promise<unknown>, expected?: unknown): Promise<void>;
  };
  export default assert;
}

declare module "node:fs" {
  export function readFileSync(path: string, encoding?: string): any;
  export function realpathSync(path: string): string;
}

declare module "node:os" { export function tmpdir(): string; export function hostname(): string; }
declare module "node:events" { export function once(emitter: any, event: string): Promise<any[]>; }
declare module "node:http" { export function createServer(handler: (req: any, res: any) => void): any; }
