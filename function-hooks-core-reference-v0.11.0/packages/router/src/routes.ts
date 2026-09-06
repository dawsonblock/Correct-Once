import type {
  BrowserCallInput, DesktopCallInput, FileReadInput, FileWriteInput,
  McpCallInput, NetworkRequestInput, ProcessExecInput,
} from "@function-hooks/gateway";
import type { CapabilityRoute, RoutedActionRequest } from "./types.js";

type MaybePromise<T> = T | Promise<T>;

type RouteIdentity = { readonly app: string; readonly capability: string };
type Mapper<T> = (input: unknown, request: Readonly<RoutedActionRequest>) => MaybePromise<T>;

export interface McpCapabilityRouteOptions extends RouteIdentity {
  readonly server: string;
  readonly tool: string;
  readonly mapArgs?: Mapper<unknown>;
}
export function mcpCapabilityRoute(options: McpCapabilityRouteOptions): CapabilityRoute<"mcp.call"> {
  return Object.freeze({ app: options.app, capability: options.capability, backend: "mcp" as const, event: "mcp.call" as const,
    build: async (request: Readonly<RoutedActionRequest>) => ({ server: options.server, tool: options.tool, ...(options.mapArgs ? { args: await options.mapArgs(request.input, request) } : request.input === undefined ? {} : { args: request.input }) } satisfies Omit<McpCallInput,"actionId">) });
}

export interface ApiCapabilityRouteOptions extends RouteIdentity {
  readonly method?: string;
  readonly buildRequest: Mapper<Omit<NetworkRequestInput, "actionId" | "metadata" | "method"> & { readonly method?: string }>;
}
export function apiCapabilityRoute(options: ApiCapabilityRouteOptions): CapabilityRoute<"network.request"> {
  return Object.freeze({ app: options.app, capability: options.capability, backend: "api" as const, event: "network.request" as const,
    build: async (request: Readonly<RoutedActionRequest>) => ({ ...(await options.buildRequest(request.input, request)), ...(options.method === undefined ? {} : { method: options.method }) }) });
}

export interface BrowserCapabilityRouteOptions extends RouteIdentity {
  readonly operation: string;
  readonly target?: string;
  readonly mapArgs?: Mapper<unknown>;
}
export function browserCapabilityRoute(options: BrowserCapabilityRouteOptions): CapabilityRoute<"browser.call"> {
  return Object.freeze({ app: options.app, capability: options.capability, backend: "browser" as const, event: "browser.call" as const,
    build: async (request: Readonly<RoutedActionRequest>) => ({ operation: options.operation, ...(options.target === undefined ? {} : { target: options.target }), ...(options.mapArgs ? { args: await options.mapArgs(request.input, request) } : request.input === undefined ? {} : { args: request.input }) } satisfies Omit<BrowserCallInput,"actionId">) });
}

export interface DesktopCapabilityRouteOptions extends RouteIdentity {
  readonly application: string;
  readonly operation: string;
  readonly target?: string;
  readonly mapArgs?: Mapper<unknown>;
}
export function desktopCapabilityRoute(options: DesktopCapabilityRouteOptions): CapabilityRoute<"desktop.call"> {
  return Object.freeze({ app: options.app, capability: options.capability, backend: "desktop" as const, event: "desktop.call" as const,
    build: async (request: Readonly<RoutedActionRequest>) => ({ application: options.application, operation: options.operation, ...(options.target === undefined ? {} : { target: options.target }), ...(options.mapArgs ? { args: await options.mapArgs(request.input, request) } : request.input === undefined ? {} : { args: request.input }) } satisfies Omit<DesktopCallInput,"actionId">) });
}

export interface ProcessCapabilityRouteOptions extends RouteIdentity {
  readonly profile: string;
  readonly mapArgs?: Mapper<readonly string[]>;
  readonly cwd?: string;
  readonly timeoutMs?: number;
}
export function processCapabilityRoute(options: ProcessCapabilityRouteOptions): CapabilityRoute<"process.exec"> {
  return Object.freeze({ app: options.app, capability: options.capability, backend: "local" as const, event: "process.exec" as const,
    build: async (request: Readonly<RoutedActionRequest>) => ({ profile: options.profile, ...(options.mapArgs ? { args: await options.mapArgs(request.input, request) } : {}), ...(options.cwd === undefined ? {} : { cwd: options.cwd }), ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }) } satisfies Omit<ProcessExecInput,"actionId">) });
}

export interface FileReadCapabilityRouteOptions extends RouteIdentity { readonly path: Mapper<string>; }
export function fileReadCapabilityRoute(options: FileReadCapabilityRouteOptions): CapabilityRoute<"fs.read"> {
  return Object.freeze({ app: options.app, capability: options.capability, backend: "local" as const, event: "fs.read" as const,
    build: async (request: Readonly<RoutedActionRequest>) => ({ path: await options.path(request.input, request) } satisfies Omit<FileReadInput,"actionId">) });
}

export interface FileWriteCapabilityRouteOptions extends RouteIdentity { readonly path: Mapper<string>; readonly data: Mapper<string>; }
export function fileWriteCapabilityRoute(options: FileWriteCapabilityRouteOptions): CapabilityRoute<"fs.write"> {
  return Object.freeze({ app: options.app, capability: options.capability, backend: "local" as const, event: "fs.write" as const,
    build: async (request: Readonly<RoutedActionRequest>) => ({ path: await options.path(request.input, request), data: await options.data(request.input, request) } satisfies Omit<FileWriteInput,"actionId">) });
}
