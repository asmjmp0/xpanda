import { NodeFactory } from "../ast/NodeFactory";
import { NodeUtils } from "../ast/NodeUtils";

/**
 * 代码生成器:直接复用原 TS 的 NodeFactory/NodeUtils(取代 Java 的 GraalVM JSBridge)
 * @Author: jmp0
 */
export class CodeGenerator {
    nodeFactory: typeof NodeFactory = NodeFactory;
    nodeUtils: typeof NodeUtils = NodeUtils;

    getNodeFactory(): typeof NodeFactory {
        return this.nodeFactory;
    }

    getNodeUtils(): typeof NodeUtils {
        return this.nodeUtils;
    }

    arrayObject(): any[] {
        return [];
    }

    addToArray(arr: any[], obj: any): void {
        arr.push(obj);
    }
}
