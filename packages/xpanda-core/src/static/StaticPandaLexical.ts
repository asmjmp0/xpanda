import type { PandaIRCFG } from "../disasm/PandaIRCFG";
import type { PandaMethod } from "../file/method/PandaMethod";
import { StaticPandaDisAssembler } from "./StaticPandaDisAssembler";

/**
 * CFG cache for ArkTS-Sta methods. The static language has no dynamic
 * lexical-environment bytecodes, so there is no lexical analysis; only the
 * small surface consumed by the shared decompiler pipeline is provided.
 *
 * @Author: jmp0
 */
export class StaticPandaLexical {
    private readonly cfgs = new Map<PandaMethod, PandaIRCFG | null>();

    has(method: PandaMethod): boolean {
        return this.cfgs.has(method) ? this.cfgs.get(method) !== null : !!method.methodCode;
    }

    getPandaIRCFG(method: PandaMethod): PandaIRCFG {
        if (this.cfgs.has(method)) {
            const cached = this.cfgs.get(method);
            if (!cached) throw new Error("method body unavailable");
            return cached;
        }
        try {
            const cfg = StaticPandaDisAssembler.disAssembly(method);
            this.cfgs.set(method, cfg);
            return cfg;
        } catch (e) {
            this.cfgs.set(method, null);
            throw e;
        }
    }

    getTypeInfo(_method: PandaMethod, _name: string): any {
        return null;
    }
}
