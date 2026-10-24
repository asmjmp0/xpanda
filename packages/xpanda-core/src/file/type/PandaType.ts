import type { PandaClass } from "../clazz/PandaClass";
import { HEADER_SIZE } from "../desc/Header";
import { PandaRawType, pandaRawTypeOf, toFieldType } from "../desc/enums";

/**
 * 字段/方法类型(移植自 Java jmp0.abc.file.type.PandaType)
 * 偏移 <= Header 大小 视为原始类型(其偏移编码了原始类型值)
 * @Author: jmp0
 */
export class PandaType {
    readonly pandaClass: PandaClass;
    readonly primitive: boolean;
    rawType: PandaRawType;

    constructor(pandaClass: PandaClass, isField: boolean) {
        this.pandaClass = pandaClass;
        this.primitive = pandaClass.getOffset() <= HEADER_SIZE;
        if (this.primitive) {
            const raw = pandaRawTypeOf(pandaClass.getOffset() & 0xff);
            if (raw === null) throw new Error("bad raw type " + pandaClass.getOffset());
            this.rawType = isField ? toFieldType(raw) : raw;
        } else {
            this.rawType = PandaRawType.REF;
        }
    }
}
