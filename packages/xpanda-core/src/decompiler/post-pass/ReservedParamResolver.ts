/**
 * Resolve the compiler's reserved entry parameters after structured analysis.
 *
 * ArkTS passes three hidden parameters to every function; the decompiler exposes
 * them as `panda_jmp0_reserved_param_p0/p1/p2` and injects `p2 = this` at every
 * entry. Keeping those names in the raw AST leaks a decompiler implementation
 * detail into every consumer (and `p2 = this` alone makes SSA lowering reject
 * every function). This pass runs once, after `StructureAnalysis` has produced
 * the final statement tree, and replaces the reserved names with their source
 * meaning:
 *
 *   p0 -> this / function name / class or method name / undefined
 *   p1 -> new.target
 *   p2 -> this when it is a stable receiver, otherwise a normal local
 *
 * A stable `p2` is written exactly once (`p2 = this`) before any read; its
 * reads can be replaced with `this` and the preamble dropped. If `p2` is
 * reassigned (ArkUI component builders move the receiver between parent
 * contexts) the value is a mutable local, so it is renamed to a normal
 * identifier instead of being folded to `this`.
 */
import traverse, {type NodePath} from '@babel/traverse';
import * as t from '@babel/types';
import {VISITOR_KEYS} from '@babel/types';

const RESERVED_PARAM_PREFIX = 'panda_jmp0_reserved_param_';
const P0 = `${RESERVED_PARAM_PREFIX}p0`;
const P1 = `${RESERVED_PARAM_PREFIX}p1`;
const P2 = `${RESERVED_PARAM_PREFIX}p2`;
const SENDABLE_CLASS = 'panda_jmp0_reserved_sendable_class';
const LEX_BEGIN = 'panda_jmp0_reserved_lex_begin';
const EXPORT_NAME_PREFIX = 'panda_jmp0_reserved_export_name_';

const FUNCTION_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
  'ObjectMethod',
  'ClassMethod',
  'ClassPrivateMethod',
]);

type P2Info = {
  used: boolean;
  stable: boolean;
  rename: string | null;
};

/**
 * Resolve all `panda_jmp0_reserved_param_*` identifiers in place.
 * Returns whether the AST was modified.
 */
export function resolveReservedParams(program: t.Program): boolean {
  const p2Info = new WeakMap<t.Node, P2Info>();
  const usedNames = collectIdentifierNames(program);

  const infoFor = (scope: t.Node): P2Info => {
    let info = p2Info.get(scope);
    if (!info) {
      info = analyzeP2(scope);
      if (info.used && !info.stable) {
        info.rename = uniqueName(usedNames);
      }
      p2Info.set(scope, info);
    }
    return info;
  };

  p2Info.set(program, infoFor(program));
  let changed = false;

  // Export-name temporaries need binding information; run before the main
  // identifier walk so their declarations can disappear cleanly.
  if ([...usedNames].some(name => name.startsWith(EXPORT_NAME_PREFIX))) {
    changed = rewriteExportNames(program, usedNames) || changed;
  }

  traverse(t.file(program), {
    noScope: true,
    Function(path) {
      infoFor(path.node);
    },
    AssignmentExpression(path) {
      const {left, right, operator} = path.node;
      if (!t.isIdentifier(left, {name: P2})) return;
      const info = infoFor(scopeNode(path, program));
      if (!info.stable || operator !== '=' || !t.isThisExpression(right)) return;
      // The stable entry preamble: p2 = this. Drop the whole statement when it
      // stands alone; otherwise preserve the expression value.
      const statement = path.parentPath;
      if (statement.isExpressionStatement()) {
        statement.remove();
      } else {
        path.replaceWith(t.thisExpression());
      }
      path.skip();
      changed = true;
    },
    ExpressionStatement(path) {
      if (t.isIdentifier(path.node.expression, {name: LEX_BEGIN})) {
        path.remove();
        path.skip();
        changed = true;
      }
    },
    VariableDeclarator(path) {
      const id = path.node.id;
      if (!t.isIdentifier(id) || !id.name.startsWith(RESERVED_PARAM_PREFIX)) return;
      if (id.name !== P2) {
        removeDeclarator(path);
        changed = true;
        return;
      }
      const info = infoFor(scopeNode(path, program));
      if (info.used && !info.stable && info.rename) {
        id.name = info.rename;
        changed = true;
        return;
      }
      // Stable (`p2 = this` folded to `this`) or completely unused.
      removeDeclarator(path);
      changed = true;
    },
    Identifier(path) {
      const name = path.node.name;
      if (name === P0) {
        if (resolveP0(path)) changed = true;
      } else if (name === P1) {
        path.replaceWith(path.getFunctionParent() ? newTarget() : t.identifier('undefined'));
        path.skip();
        changed = true;
      } else if (name === P2) {
        const info = infoFor(scopeNode(path, program));
        if (info.stable) {
          path.replaceWith(t.thisExpression());
          path.skip();
          changed = true;
        } else if (info.rename) {
          path.node.name = info.rename;
          changed = true;
        }
      } else if (name === SENDABLE_CLASS) {
        if (resolveSendableClass(path)) changed = true;
      } else if (name === LEX_BEGIN) {
        // A marker that ended up inside an expression (e.g. a condition
        // sequence) has no statement to delete; replace it with a no-op value.
        path.replaceWith(t.identifier('undefined'));
        path.skip();
        changed = true;
      }
    },
  });

  return changed;
}

function scopeNode(path: NodePath, program: t.Program): t.Node {
  return path.getFunctionParent()?.node ?? program;
}

function removeDeclarator(path: NodePath<t.VariableDeclarator>): void {
  const declaration = path.parentPath;
  path.remove();
  if (declaration.isVariableDeclaration() && declaration.node.declarations.length === 0) {
    declaration.remove();
  }
}

/**
 * `p0` denotes the function's own value: the function/class name for named
 * functions and methods, `undefined` for anonymous functions, and a removable
 * entry self-assignment at module scope.
 */
function resolveP0(path: NodePath<t.Identifier>): boolean {
  // The declarator itself is handled by the VariableDeclarator visitor.
  if (path.parentPath?.isVariableDeclarator() && path.key === 'id') return false;

  const statementParent = path.findParent(p => p.isStatement());
  if (statementParent == null) return false;

  const func = path.getFunctionParent();
  if (func == null) {
    const statement = path.getStatementParent();
    if (statement && isSelfParamPreambleStatement(statement.node, P0)) {
      statement.remove();
      path.skip();
      return true;
    }
    path.replaceWith(t.identifier('undefined'));
    path.skip();
    return true;
  }

  if (func.isFunctionDeclaration() || func.isFunctionExpression()) {
    const id = (func.node as t.FunctionDeclaration | t.FunctionExpression).id;
    if (id) {
      path.node.name = id.name;
      return true;
    }
  }

  if (func.isClassMethod()) {
    if (func.node.kind === 'constructor') {
      const clazz = func.findParent(p => p.isClass());
      if (clazz && t.isClass(clazz.node) && t.isIdentifier(clazz.node.id)) {
        path.node.name = clazz.node.id.name;
        return true;
      }
    } else if (t.isIdentifier(func.node.key)) {
      path.node.name = func.node.key.name;
      return true;
    }
    path.replaceWith(t.identifier('undefined'));
    path.skip();
    return true;
  }

  if (func.isObjectMethod()) {
    if (t.isIdentifier(func.node.key)) {
      path.node.name = func.node.key.name;
      return true;
    }
    path.replaceWith(t.identifier('undefined'));
    path.skip();
    return true;
  }

  if (func.isArrowFunctionExpression()) {
    const statement = path.getStatementParent();
    if (statement && isSelfParamPreambleStatement(statement.node, P0)) {
      statement.remove();
      path.skip();
      return true;
    }
    path.replaceWith(t.identifier('undefined'));
    path.skip();
    return true;
  }

  // Unknown function shape: keep the output free of the reserved identifier.
  path.replaceWith(t.identifier('undefined'));
  path.skip();
  return true;
}

/**
 * `vN = panda_jmp0_reserved_param_p0` or a sequence made only of such entry
 * self-assignments. Removing the whole statement avoids leaving a dead write
 * behind, while a p0 that appears in a larger expression is replaced with
 * `undefined` instead (deleting the statement would drop the rest of the body).
 */
function isSelfParamPreambleStatement(statement: t.Node | null | undefined, name: string): boolean {
  if (!statement || !t.isExpressionStatement(statement)) return false;
  const expression = statement.expression;
  if (t.isAssignmentExpression(expression, {operator: '='}) &&
      t.isIdentifier(expression.right, {name}) &&
      t.isIdentifier(expression.left)) {
    return true;
  }
  if (t.isSequenceExpression(expression)) {
    return expression.expressions.every(item =>
      t.isAssignmentExpression(item, {operator: '='}) &&
      t.isIdentifier(item.right) &&
      item.right.name.startsWith(RESERVED_PARAM_PREFIX) &&
      t.isIdentifier(item.left));
  }
  return false;
}

function resolveSendableClass(path: NodePath<t.Identifier>): boolean {
  const func = path.getFunctionParent();
  if (func) {
    const clazz = func.findParent(p => p.isClass());
    if (clazz && t.isClass(clazz.node) && t.isIdentifier(clazz.node.id)) {
      path.replaceWith(t.identifier(clazz.node.id.name));
      path.skip();
      return true;
    }
  }
  path.replaceWith(t.identifier('undefined'));
  path.skip();
  return true;
}

/**
 * `panda_jmp0_reserved_export_name_<name>` is a temporary alias for an export
 * binding. When the real `<name>` is referenced elsewhere, replace references
 * with the real name and drop the alias declaration/assignments. This needs
 * Babel binding information; if the raw AST still has duplicate declarations
 * (normalized only by simplify), fall back to a scope-free pass.
 */
function rewriteExportNames(program: t.Program, usedNames: Set<string>): boolean {
  let changed = false;
  try {
    traverse(t.file(program), {
      Program(path) {
        const bindings = path.scope.getAllBindings();
        for (const key in bindings) {
          if (!key.startsWith(EXPORT_NAME_PREFIX)) continue;
          const keyName = key.substring(EXPORT_NAME_PREFIX.length);
          if (path.scope.references[keyName] !== true) continue;
          const binding = bindings[key];
          for (const referencePath of binding.referencePaths) {
            referencePath.replaceWith(t.identifier(keyName));
          }
          for (const constantViolation of binding.constantViolations) {
            constantViolation.remove();
            constantViolation.skip();
          }
          binding.path.remove();
          binding.path.skip();
          changed = true;
        }
      },
    });
  } catch {
    changed = rewriteExportNamesFallback(program, usedNames);
  }
  return changed;
}

function rewriteExportNamesFallback(program: t.Program, usedNames: Set<string>): boolean {
  let changed = false;
  const aliases = new Set(
    [...usedNames].filter(name => name.startsWith(EXPORT_NAME_PREFIX)),
  );
  if (aliases.size === 0) return false;

  traverse(t.file(program), {
    noScope: true,
    Identifier(path) {
      const name = path.node.name;
      if (!aliases.has(name)) return;
      const keyName = name.substring(EXPORT_NAME_PREFIX.length);
      if (!usedNames.has(keyName)) return;

      if (path.parentPath?.isVariableDeclarator() && path.key === 'id') {
        removeDeclarator(path.parentPath as NodePath<t.VariableDeclarator>);
        path.skip();
        changed = true;
        return;
      }
      if (path.parentPath?.isAssignmentExpression() && path.key === 'left') {
        const assignment = path.parentPath;
        const statement = assignment.parentPath;
        if (statement?.isExpressionStatement()) {
          statement.remove();
        } else {
          assignment.replaceWith((assignment.node as t.AssignmentExpression).right);
        }
        path.skip();
        changed = true;
        return;
      }
      path.replaceWith(t.identifier(keyName));
      changed = true;
    },
  });
  return changed;
}

function newTarget(): t.MemberExpression {
  return t.memberExpression(t.identifier('new'), t.identifier('target'));
}

/**
 * Inspect one function (or the module body) without descending into nested
 * functions: every function has its own reserved parameters.
 */
function analyzeP2(scope: t.Node): P2Info {
  let writes = 0;
  let writesThis = 0;
  let firstRef: t.Identifier | null = null;
  let writeLeft: t.Identifier | null = null;
  let used = false;

  const walk = (node: t.Node, parent: t.Node | null, key: string | null): void => {
    if (node !== scope && FUNCTION_TYPES.has(node.type)) return;

    if (t.isIdentifier(node, {name: P2}) && !(t.isVariableDeclarator(parent) && key === 'id')) {
      used = true;
      if (firstRef == null) firstRef = node;
      if (t.isAssignmentExpression(parent) && key === 'left') writeLeft = node;
    }

    if (t.isAssignmentExpression(node) && t.isIdentifier(node.left, {name: P2})) {
      writes++;
      if (node.operator === '=' && t.isThisExpression(node.right)) writesThis++;
    } else if (t.isUpdateExpression(node) && t.isIdentifier(node.argument, {name: P2})) {
      writes++;
    }

    const keys = VISITOR_KEYS[node.type] as string[] | undefined;
    if (!keys) return;
    for (const childKey of keys) {
      const value = (node as any)[childKey];
      if (Array.isArray(value)) {
        for (const child of value) {
          if (child && typeof child.type === 'string') walk(child, node, childKey);
        }
      } else if (value && typeof value.type === 'string') {
        walk(value, node, childKey);
      }
    }
  };

  walk(scope, null, null);
  const stable = used && writes === 1 && writesThis === 1 && firstRef === writeLeft;
  return {used, stable, rename: null};
}

function collectIdentifierNames(root: t.Node): Set<string> {
  const names = new Set<string>();
  const walk = (node: t.Node): void => {
    if (t.isIdentifier(node)) names.add(node.name);
    const keys = VISITOR_KEYS[node.type] as string[] | undefined;
    if (!keys) return;
    for (const key of keys) {
      const value = (node as any)[key];
      if (Array.isArray(value)) {
        for (const child of value) {
          if (child && typeof child.type === 'string') walk(child);
        }
      } else if (value && typeof value.type === 'string') {
        walk(value);
      }
    }
  };
  walk(root);
  return names;
}

function uniqueName(used: Set<string>): string {
  let index = 0;
  let name = 'thisArg';
  while (used.has(name)) {
    index++;
    name = `thisArg${index}`;
  }
  used.add(name);
  return name;
}
