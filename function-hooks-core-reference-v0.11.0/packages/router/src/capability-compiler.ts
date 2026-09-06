import { assertAdmittedCapability, type AdmittedCapability, type CapabilityRegistry } from "@function-hooks/capabilities";
import type { AnyCapabilityRoute, ExecutionRouter, RoutedActionRequest } from "./types.js";
import { InvalidCapabilityRouteError } from "./errors.js";
import { createExecutionRouter } from "./router.js";

const META_ID = "function-hooks.capability.id";
const META_CANDIDATE = "function-hooks.capability.candidate-hash";
const META_DESCRIPTOR = "function-hooks.capability.descriptor-hash";
const META_ADMISSION = "function-hooks.capability.admission-id";
const META_POLICY = "function-hooks.capability.policy-version";

function inputObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InvalidCapabilityRouteError(`${label} requires an object input.`);
  return value as Record<string, unknown>;
}
function stringField(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) throw new InvalidCapabilityRouteError(`${field} must be a non-empty string.`);
  return value;
}
function textField(value: unknown, field: string): string {
  if (typeof value !== "string") throw new InvalidCapabilityRouteError(`${field} must be a string.`);
  return value;
}
function stringArray(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value) || value.some((entry)=>typeof entry !== "string")) throw new InvalidCapabilityRouteError(`${field} must be an array of strings.`);
  return Object.freeze([...value] as string[]);
}
function trustedMetadata(capability: AdmittedCapability): Readonly<Record<string,string>> {
  return Object.freeze({
    [META_ID]: capability.id,
    [META_CANDIDATE]: capability.candidateHash,
    [META_DESCRIPTOR]: capability.descriptorHash,
    [META_ADMISSION]: capability.admission.admissionId,
    [META_POLICY]: capability.admission.policyVersion,
  });
}

export function compileAdmittedCapabilityRoute(value: AdmittedCapability): AnyCapabilityRoute {
  assertAdmittedCapability(value);
  const capability = value;
  const common = { app: capability.app, capability: capability.capability, trustedMetadata: trustedMetadata(capability) };
  const implementation = capability.implementation;
  if (implementation.kind === "mcp") {
    return Object.freeze({ ...common, backend:"mcp" as const, event:"mcp.call" as const,
      build: (request: Readonly<RoutedActionRequest>) => ({ server: implementation.server, tool: implementation.tool, ...(request.input === undefined ? {} : {args: request.input}) }) });
  }
  if (implementation.kind === "http") {
    return Object.freeze({ ...common, backend:"api" as const, event:"network.request" as const,
      build: (request: Readonly<RoutedActionRequest>) => {
        const bodyMode=implementation.body ?? "json";
        let body: string | undefined;
        if (bodyMode === "text" && request.input !== undefined) body=textField(request.input,"request.input");
        if (bodyMode === "json" && request.input !== undefined) body=JSON.stringify(request.input);
        const headers={...(implementation.headers ?? {})};
        if (bodyMode === "json" && body !== undefined && !Object.keys(headers).some((key)=>key.toLowerCase()==="content-type")) headers["content-type"]="application/json";
        return { url: implementation.url, ...(implementation.method===undefined?{}:{method:implementation.method}), ...(Object.keys(headers).length?{headers}:{}), ...(body===undefined?{}:{body}) };
      } });
  }
  if (implementation.kind === "browser") {
    return Object.freeze({ ...common, backend:"browser" as const, event:"browser.call" as const,
      build: (request: Readonly<RoutedActionRequest>) => ({ operation: implementation.operation, ...(implementation.target===undefined?{}:{target:implementation.target}), ...(request.input===undefined?{}:{args:request.input}) }) });
  }
  if (implementation.kind === "desktop") {
    return Object.freeze({ ...common, backend:"desktop" as const, event:"desktop.call" as const,
      build: (request: Readonly<RoutedActionRequest>) => ({ application: implementation.application, operation: implementation.operation, ...(implementation.target===undefined?{}:{target:implementation.target}), ...(request.input===undefined?{}:{args:request.input}) }) });
  }
  if (implementation.kind === "process") {
    return Object.freeze({ ...common, backend:"local" as const, event:"process.exec" as const,
      build: (request: Readonly<RoutedActionRequest>) => ({ profile: implementation.profile, ...(request.input===undefined?{}:{args:stringArray(request.input,"request.input")}), ...(implementation.cwd===undefined?{}:{cwd:implementation.cwd}), ...(implementation.timeoutMs===undefined?{}:{timeoutMs:implementation.timeoutMs}) }) });
  }
  if (implementation.kind === "filesystem.read") {
    return Object.freeze({ ...common, backend:"local" as const, event:"fs.read" as const,
      build: (request: Readonly<RoutedActionRequest>) => {
        const path = implementation.path ?? (typeof request.input === "string" ? request.input : stringField(inputObject(request.input,"filesystem.read input").path,"request.input.path"));
        return {path};
      } });
  }
  if (implementation.kind === "filesystem.write") {
    return Object.freeze({ ...common, backend:"local" as const, event:"fs.write" as const,
      build: (request: Readonly<RoutedActionRequest>) => {
        const input=inputObject(request.input,"filesystem.write input");
        const path=implementation.path ?? stringField(input.path,"request.input.path");
        const data=textField(input.data,"request.input.data");
        return {path,data};
      } });
  }
  throw new InvalidCapabilityRouteError(`Capability ${capability.id} has unsupported implementation.`);
}

export async function compileActiveCapabilityRoutes(registry: CapabilityRegistry): Promise<readonly AnyCapabilityRoute[]> {
  const records=await registry.list({state:"active"});
  return Object.freeze(records.map(({capability})=>compileAdmittedCapabilityRoute(capability)));
}

export interface CreateExecutionRouterFromRegistryOptions {
  readonly gateway: ExecutionRouter["gateway"];
  readonly registry: CapabilityRegistry;
  readonly manualRoutes?: readonly AnyCapabilityRoute[];
}

export async function createExecutionRouterFromRegistry(options: CreateExecutionRouterFromRegistryOptions): Promise<ExecutionRouter> {
  const generated=await compileActiveCapabilityRoutes(options.registry);
  return createExecutionRouter({gateway:options.gateway,routes:[...generated,...(options.manualRoutes ?? [])]});
}
