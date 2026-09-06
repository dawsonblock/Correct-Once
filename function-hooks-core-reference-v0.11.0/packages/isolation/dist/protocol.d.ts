export interface RemoteHookDescriptor {
    readonly hookId: string;
    readonly event: string;
    readonly matcher?: unknown;
}
export type HostToChildMessage = {
    readonly type: "invoke";
    readonly id: string;
    readonly hookId: string;
    readonly event: unknown;
    readonly meta: {
        readonly event: string;
        readonly origin: string;
    };
} | {
    readonly type: "response";
    readonly id: string;
    readonly ok: true;
    readonly value?: unknown;
} | {
    readonly type: "response";
    readonly id: string;
    readonly ok: false;
    readonly error: string;
} | {
    readonly type: "cancel";
    readonly id: string;
};
export type ChildToHostMessage = {
    readonly type: "ready";
    readonly hooks: readonly RemoteHookDescriptor[];
} | {
    readonly type: "invokeResult";
    readonly id: string;
    readonly ok: true;
    readonly value?: unknown;
} | {
    readonly type: "invokeResult";
    readonly id: string;
    readonly ok: false;
    readonly error: string;
} | {
    readonly type: "request";
    readonly id: string;
    readonly invocationId: string;
    readonly method: "next";
    readonly value: unknown;
} | {
    readonly type: "request";
    readonly id: string;
    readonly invocationId: string;
    readonly method: "engine";
    readonly event: string;
    readonly value: unknown;
} | {
    readonly type: "fatal";
    readonly error: string;
};
//# sourceMappingURL=protocol.d.ts.map