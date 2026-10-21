import * as TYPE from "@babel/types";
import { addPatternNames, walkNode } from "./AstUtils";

/**
 * 反编译结果里偶尔会出现同一作用域内重复的 let/import 声明(例如 import constants
 * 与 let constants 同时存在),Babel 建立 scope 时会直接抛
 * "Duplicate declaration"。在进入任何 traverse 之前做一次轻量归一化。
 *
 * 规则:
 *   1. 同一语句列表内重复的 let 声明只保留第一个;带初始化的重复项改写为赋值语句。
 *   2. 顶层 import 的本地名如果与顶层 var/function/class 冲突,删掉该 import specifier
 *      (模块副作用通过保留空 import 维持)。
 */
export function normalizeDeclarations(program: TYPE.Program): boolean {
    let changed = false;

    const declaredTopLevel = new Set<string>();
    const importDeclarations: TYPE.ImportDeclaration[] = [];

    for (const statement of program.body) {
        if (TYPE.isImportDeclaration(statement)) {
            importDeclarations.push(statement);
        } else if (TYPE.isVariableDeclaration(statement)) {
            for (const declarator of statement.declarations) addPatternNames(declarator.id, declaredTopLevel);
        } else if ((TYPE.isFunctionDeclaration(statement) || TYPE.isClassDeclaration(statement)) && statement.id) {
            declaredTopLevel.add(statement.id.name);
        }
    }

    // import 与顶层声明重名:删除 import specifier,保留局部声明
    for (const declaration of importDeclarations) {
        const before = declaration.specifiers.length;
        declaration.specifiers = declaration.specifiers.filter((specifier) => {
            const name = specifier.local?.name;
            return !name || !declaredTopLevel.has(name);
        });
        if (declaration.specifiers.length !== before) changed = true;
    }

    if (dedupeList(program.body)) changed = true;
    walkNode(program, (node) => {
        if (TYPE.isFunction(node) && TYPE.isBlockStatement(node.body)) {
            if (dedupeList(node.body.body)) changed = true;
            return true;
        }
        if (TYPE.isBlockStatement(node)) {
            if (dedupeList(node.body)) changed = true;
        }
        return true;
    });

    return changed;
}

function dedupeList(statements: TYPE.Statement[]): boolean {
    let changed = false;
    const seen = new Set<string>();

    for (let i = 0; i < statements.length; i++) {
        const statement = statements[i];
        if (!TYPE.isVariableDeclaration(statement)) continue;

        const kept: TYPE.VariableDeclarator[] = [];
        const assignments: TYPE.ExpressionStatement[] = [];
        for (const declarator of statement.declarations) {
            if (!TYPE.isIdentifier(declarator.id)) {
                kept.push(declarator);
                continue;
            }
            const name = declarator.id.name;
            if (seen.has(name)) {
                changed = true;
                if (declarator.init) {
                    assignments.push(TYPE.expressionStatement(
                        TYPE.assignmentExpression("=", TYPE.identifier(name), declarator.init)));
                }
            } else {
                seen.add(name);
                kept.push(declarator);
            }
        }

        if (kept.length !== statement.declarations.length) changed = true;
        if (kept.length === 0) {
            statements.splice(i, 1, ...assignments);
            i += assignments.length - 1;
        } else {
            statement.declarations = kept;
            if (assignments.length > 0) {
                statements.splice(i + 1, 0, ...assignments);
                i += assignments.length;
            }
        }
    }

    return changed;
}
