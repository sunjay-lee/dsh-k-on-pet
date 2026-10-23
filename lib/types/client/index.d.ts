export declare const name: string;
export declare const inject: string[];
export declare function apply(ctx: { slots: { inject(name: string, fn: () => Generator<unknown>): unknown } }): void;
