export interface FileLockOptions {
    readonly enabled?: boolean;
    readonly timeoutMs?: number;
    readonly staleMs?: number;
}
export declare function withFileLock<T>(resourcePath: string, options: FileLockOptions, operation: () => Promise<T>): Promise<T>;
//# sourceMappingURL=file-lock.d.ts.map