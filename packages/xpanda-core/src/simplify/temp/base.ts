import { PassState } from "./types";

/**
 * 各功能模块的基类:统一持有 TempVariableSimplify 的共享状态。
 *
 * 访问器让拆分后的方法可以继续写 `this.changed = true`,
 * 而不需要把整个文件改成 `this.state.changed`。
 *
 * @Author: jmp0
 */
export abstract class TempVariablePass {
    constructor(protected readonly state: PassState) {}

    protected get changed(): boolean {
        return this.state.changed;
    }

    protected set changed(value: boolean) {
        this.state.changed = value;
    }

    protected get cleanupVersion(): number {
        return this.state.cleanupVersion;
    }

    protected set cleanupVersion(value: number) {
        this.state.cleanupVersion = value;
    }

    protected get conditionsOnly(): boolean {
        return this.state.conditionsOnly;
    }

    protected get returnsOnly(): boolean {
        return this.state.returnsOnly;
    }

    protected get hubOnly(): boolean {
        return this.state.hubOnly;
    }
}
