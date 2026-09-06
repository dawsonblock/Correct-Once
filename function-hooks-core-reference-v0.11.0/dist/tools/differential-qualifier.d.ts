export interface DifferentialQualificationReport {
    readonly iterations: number;
    readonly comparedDispatches: number;
    readonly failed: number;
    readonly failures: readonly string[];
}
export declare function runDifferentialQualification(iterations?: number): Promise<DifferentialQualificationReport>;
//# sourceMappingURL=differential-qualifier.d.ts.map