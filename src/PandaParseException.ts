/**
 * @Author: jmp0
 */
export class PandaParseException extends Error {
    constructor(message: string) {
        super(message);
        this.name = "PandaParseException";
    }
}

export class PandaDecompileException extends Error {
    constructor(message: string) {
        super(message);
        this.name = "PandaDecompileException";
    }
}
