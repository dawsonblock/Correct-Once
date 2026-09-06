export interface AssuredEventBehavior {
    readonly sideEffect?: boolean;
    readonly idempotent?: boolean;
    readonly maxNextCalls?: number;
}
export interface AssuredEventDefinition {
    readonly behavior?: AssuredEventBehavior;
}
export interface DispatchLimits {
    readonly deadlineMs: number;
    readonly maxInputBytes: number;
    readonly maxResultBytes: number;
    readonly maxNextCalls: number;
}
export interface RuntimeBudgetConfig {
    readonly defaults?: Partial<DispatchLimits>;
    readonly perEvent?: Readonly<Record<string, Partial<DispatchLimits>>>;
}
export declare class BudgetController {
    #private;
    constructor(config?: RuntimeBudgetConfig);
    limitsFor(eventName: string, definition: AssuredEventDefinition): DispatchLimits;
}
//# sourceMappingURL=budgets.d.ts.map