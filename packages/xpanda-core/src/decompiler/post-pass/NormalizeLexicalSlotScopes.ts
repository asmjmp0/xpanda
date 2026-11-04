import traverse, { NodePath } from "@babel/traverse";
import * as TYPE from "@babel/types";

const LEXICAL_SLOT_NAME = /^(local|sendable)_\d+_\d+(_\d+)?$/;

interface LexicalSlotDeclaration {
    name: string;
    declarator: NodePath<TYPE.VariableDeclarator>;
    declaration: NodePath<TYPE.VariableDeclaration>;
    block: NodePath<TYPE.BlockStatement | TYPE.Program>;
    fn: NodePath<TYPE.Function | TYPE.Program>;
}

/**
 * 把越界的 newLexEnv 槽声明提升到所有读取的共同祖先块。
 *
 * 结构化归约按指令顺序把 `let local_X_Y_Z` 放在 newLexEnv 所在的块里,但词法
 * 环境的真实可见范围由字节码决定:同一个环境可能在 poplexenv 之后的续跑路径
 * 上继续被读取,也可能被循环外定义的闭包捕获。声明留在里层块时,这些读取没有
 * 绑定;每个函数内槽名按环境实例唯一,提升到共同祖先不会和其它环境冲突,也
 * 不会改变循环每轮的绑定(只有真正跨出循环的槽才会被提升)。
 *
 * @Author: jmp0
 */
export function normalizeLexicalSlotScopes(program: TYPE.Program): boolean {
    let programPath: NodePath<TYPE.Program> | null = null;
    const declarations = new Map<string, LexicalSlotDeclaration[]>();
    const references: Array<{ name: string; path: NodePath<TYPE.Identifier>; fn: NodePath<TYPE.Function | TYPE.Program> }> = [];

    traverse(TYPE.file(program), {
        Program(path) {
            programPath = path;
        },
        VariableDeclarator(path) {
            if (!TYPE.isIdentifier(path.node.id) || path.node.init) return;
            const name = path.node.id.name;
            if (!LEXICAL_SLOT_NAME.test(name)) return;
            const declaration = path.parentPath;
            if (!declaration.isVariableDeclaration()) return;
            const block = declaration.parentPath;
            if (!block.isBlockStatement() && !block.isProgram()) return;
            const fn = (path.getFunctionParent() as NodePath<TYPE.Function>) ?? programPath!;
            let list = declarations.get(name);
            if (!list) {
                list = [];
                declarations.set(name, list);
            }
            list.push({ name, declarator: path, declaration, block, fn });
        },
        Identifier(path) {
            if (!LEXICAL_SLOT_NAME.test(path.node.name)) return;
            if (!path.isReferencedIdentifier()) return;
            const fn = (path.getFunctionParent() as NodePath<TYPE.Function>) ?? programPath!;
            references.push({ name: path.node.name, path, fn });
        },
    });

    // 每个声明收集"不在声明块内"的读取;多个读取取共同祖先块。
    const moves = new Map<LexicalSlotDeclaration, NodePath<TYPE.Node>[]>();
    for (const reference of references) {
        const list = declarations.get(reference.name);
        if (!list) continue;
        let best: LexicalSlotDeclaration | null = null;
        for (const declaration of list) {
            if (declaration.fn !== reference.fn && !declaration.fn.isAncestor(reference.fn)) continue;
            if (!best || best.fn.isAncestor(declaration.fn)) best = declaration;
        }
        if (!best) continue;
        if (best.block.isAncestor(reference.path)) continue;
        let paths = moves.get(best);
        if (!paths) {
            paths = [];
            moves.set(best, paths);
        }
        paths.push(reference.path);
    }

    const hoisted = new Map<NodePath<TYPE.BlockStatement | TYPE.Program>, LexicalSlotDeclaration[]>();
    for (const [declaration, paths] of moves) {
        let common: NodePath<TYPE.Node> = declaration.block;
        for (const path of paths) {
            let current: NodePath<TYPE.Node> | null = path;
            while (current && current !== common && !current.isAncestor(common)) {
                current = current.parentPath;
            }
            if (current) common = current;
            while (common && !common.isBlockStatement() && !common.isProgram()) {
                common = common.parentPath!;
            }
        }
        if (common === declaration.block) continue;
        const target = common as NodePath<TYPE.BlockStatement | TYPE.Program>;
        let bucket = hoisted.get(target);
        if (!bucket) {
            bucket = [];
            hoisted.set(target, bucket);
        }
        bucket.push(declaration);
    }

    let changed = false;
    for (const [target, bucket] of hoisted) {
        const body = target.node.body as TYPE.Statement[];
        let index = 0;
        while (index < body.length) {
            const statement = body[index];
            if (TYPE.isImportDeclaration(statement)
                || (TYPE.isExpressionStatement(statement) && (statement as any).directive != null)) {
                index++;
                continue;
            }
            break;
        }
        for (const declaration of bucket) {
            const node = declaration.declaration.node;
            const moved = TYPE.variableDeclaration("let", [
                TYPE.variableDeclarator(TYPE.identifier(declaration.name), null),
            ]);
            if (node.declarations.length === 1) {
                declaration.declaration.remove();
            } else {
                node.declarations = node.declarations.filter((item) => item !== declaration.declarator.node);
            }
            body.splice(index, 0, moved);
            index++;
            changed = true;
        }
    }
    return changed;
}
