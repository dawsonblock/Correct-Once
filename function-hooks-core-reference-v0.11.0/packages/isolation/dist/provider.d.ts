import type { OnRegistrar } from "@function-hooks/plugins";
export interface IsolatedModuleRegistration {
    register(on: OnRegistrar, options?: unknown): Promise<void>;
    close(): Promise<void>;
}
export interface IsolationProvider {
    open(modulePath: string, pluginName: string): Promise<IsolatedModuleRegistration>;
}
//# sourceMappingURL=provider.d.ts.map