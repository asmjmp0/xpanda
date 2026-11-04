/**
 * Last-resort repair for generated lexical-environment slots.
 *
 * Structural rewrites can move or clone a reference to a `local_*` /
 * `sendable_*` slot after the pass that dropped its declaration. The result is
 * still valid Babel AST, but the generated JavaScript reads an undeclared
 * identifier (`local_1_0 = p1; ... local_1_0 ...`). This pass re-declares any
 * generated slot that is read or written with no visible binding.
 *
 * The primary implementation uses Babel scopes after a single crawl, which
 * distinguishes block-scoped declarations from outer references. If the raw
 * AST still contains duplicate declarations and the crawl fails, a
 * scope-conservative AST fallback is used instead.
 */
import traverse, {type NodePath} from "@babel/traverse";
import * as TYPE from "@babel/types";
import {VISITOR_KEYS} from "@babel/types";

const LEXICAL_TEMP = /^(local|sendable)_\d+_\d+(_\d+)?$/;

const FUNCTION_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ObjectMethod",
  "ClassMethod",
  "ClassPrivateMethod",
]);

export function declareUndeclaredLexicalTemps(program: TYPE.Program): boolean {
  try {
    return declareByScope(program);
  } catch {
    return declareByAst(program);
  }
}

/**
 * Scope-aware repair: after one `scope.crawl()`, every reference without a
 * binding is collected. References in the same function (or in an outer
 * function plus its closures) share one declaration; sibling functions get
 * separate declarations, so two unrelated `local_1_0` slots don't alias.
 */
function declareByScope(program: TYPE.Program): boolean {
  const file = TYPE.file(program);
  let programPath: NodePath<TYPE.Program> | null = null;
  traverse(file, {
    Program(path) {
      programPath = path;
      path.scope.crawl();
    },
  });
  if (programPath == null) return false;

  const owners = new Map<string, Set<NodePath<TYPE.Function | TYPE.Program>>>();
  traverse(file, {
    Identifier(path) {
      const name = path.node.name;
      if (!LEXICAL_TEMP.test(name)) return;
      if (!isReferencePath(path)) return;
      if (path.scope.getBinding(name)) return;
      const owner = (path.getFunctionParent() as NodePath<TYPE.Function>) ?? programPath!;
      let set = owners.get(name);
      if (!set) {
        set = new Set();
        owners.set(name, set);
      }
      set.add(owner);
    },
  });

  const byOwner = new Map<TYPE.Node, {path: NodePath<TYPE.Function | TYPE.Program>; names: Set<string>}>();
  const add = (owner: NodePath<TYPE.Function | TYPE.Program>, name: string): void => {
    let entry = byOwner.get(owner.node);
    if (!entry) {
      entry = {path: owner, names: new Set()};
      byOwner.set(owner.node, entry);
    }
    entry.names.add(name);
  };

  for (const [name, nameOwners] of owners) {
    const paths = [...nameOwners];
    if (paths.length === 1) {
      add(paths[0], name);
      continue;
    }
    let common: NodePath = paths[0];
    for (const other of paths.slice(1)) {
      common = commonAncestor(common, other);
    }
    if (common.isProgram() || !common.isFunction()) {
      // Sibling functions (their common ancestor is Program or a class body):
      // keep separate locals instead of hoisting one shared slot. Collapse a
      // nested callback to the enclosing function under the common ancestor, so
      // a closure never shadows the declaration it is supposed to capture.
      const targets = new Set<NodePath<TYPE.Function | TYPE.Program>>();
      for (const owner of paths) targets.add(topScopeUnder(common, owner));
      for (const target of targets) add(target, name);
    } else {
      add(common as NodePath<TYPE.Function | TYPE.Program>, name);
    }
  }

  let changed = false;
  for (const {path, names} of byOwner.values()) {
    if (names.size === 0) continue;
    addDeclarations(path, [...names]);
    changed = true;
  }
  return changed;
}

function commonAncestor(a: NodePath, b: NodePath): NodePath {
  let current: NodePath | null = a;
  while (current && !current.isAncestor(b)) {
    current = current.parentPath;
  }
  return current!;
}

function topScopeUnder(
  common: NodePath,
  owner: NodePath<TYPE.Function | TYPE.Program>,
): NodePath<TYPE.Function | TYPE.Program> {
  let current: NodePath = owner;
  while (current.parentPath && current.parentPath !== common) {
    current = current.parentPath;
  }
  if (current.isFunction() || current.isProgram()) {
    return current as NodePath<TYPE.Function | TYPE.Program>;
  }
  return owner;
}

function isReferencePath(path: NodePath<TYPE.Identifier>): boolean {
  const parent = path.parentPath;
  if (!parent) return true;
  if (parent.isVariableDeclarator() && path.key === "id") return false;
  if (parent.isFunction() && path.key === "id") return false;
  if (parent.isClass() && path.key === "id") return false;
  if ((parent.isMemberExpression() || parent.isOptionalMemberExpression())
      && path.key === "property" && !parent.node.computed) return false;
  if ((parent.isObjectProperty() || parent.isObjectMethod() || parent.isClassProperty())
      && path.key === "key" && !parent.node.computed) return false;
  if (parent.isLabeledStatement() && path.key === "label") return false;
  if ((parent.isBreakStatement() || parent.isContinueStatement()) && path.key === "label") return false;
  if (parent.isImportSpecifier() || parent.isImportDefaultSpecifier() || parent.isImportNamespaceSpecifier()) return false;
  return true;
}

function addDeclarations(
  owner: NodePath<TYPE.Function | TYPE.Program>,
  names: string[],
): void {
  if (owner.isProgram()) {
    addDeclaration(owner.node.body, names);
    return;
  }
  const fn = owner.node as TYPE.Function;
  if (!fn.body) return;
  if (!TYPE.isBlockStatement(fn.body)) {
    fn.body = TYPE.blockStatement([TYPE.returnStatement(fn.body)]);
  }
  addDeclaration(fn.body.body, names);
}

/**
 * AST fallback used when the scope crawl fails. Declarations are collected per
 * function (block-level declarations are treated as visible in the whole
 * function, matching the generator's top-of-function `let` groups), and a slot
 * missing in the current scope is added there before nested functions are
 * visited.
 */
function declareByAst(program: TYPE.Program): boolean {
  let changed = false;

  const visitScope = (
    scopeNode: TYPE.Node,
    body: TYPE.Statement[],
    inherited: Set<string>,
  ): void => {
    const declared = new Set(inherited);
    addParams(scopeNode, declared);
    const used = new Set<string>();
    const nested: TYPE.Function[] = [];

    const walk = (node: TYPE.Node, parent: TYPE.Node | null, key: string | null): void => {
      if (node !== scopeNode && FUNCTION_TYPES.has(node.type)) {
        nested.push(node as TYPE.Function);
        return;
      }
      if (TYPE.isVariableDeclarator(node) && TYPE.isIdentifier(node.id)) {
        declared.add(node.id.name);
      } else if ((TYPE.isFunctionDeclaration(node) || TYPE.isClassDeclaration(node)) && node.id) {
        declared.add(node.id.name);
      } else if (TYPE.isImportDeclaration(node)) {
        for (const specifier of node.specifiers) declared.add(specifier.local.name);
      } else if (TYPE.isCatchClause(node) && TYPE.isIdentifier(node.param)) {
        declared.add(node.param.name);
      } else if (TYPE.isIdentifier(node) && isReference(node, parent, key) && LEXICAL_TEMP.test(node.name)) {
        used.add(node.name);
      }

      const keys = VISITOR_KEYS[node.type] as string[] | undefined;
      if (!keys) return;
      for (const childKey of keys) {
        const value = (node as any)[childKey];
        if (Array.isArray(value)) {
          for (const child of value) {
            if (child && typeof child.type === "string") walk(child, node, childKey);
          }
        } else if (value && typeof value.type === "string") {
          walk(value, node, childKey);
        }
      }
    };
    walk(scopeNode, null, null);

    const missing = [...used].filter(name => !declared.has(name));
    if (missing.length > 0) {
      addDeclaration(body, missing);
      for (const name of missing) declared.add(name);
      changed = true;
    }

    for (const fn of nested) {
      if (TYPE.isBlockStatement(fn.body)) {
        visitScope(fn, fn.body.body, declared);
      } else {
        // Expression-bodied arrow: wrap the body in a block so a missing slot
        // can be declared without changing the returned value.
        const returned = TYPE.returnStatement(fn.body);
        fn.body = TYPE.blockStatement([returned]);
        visitScope(fn, fn.body.body, declared);
      }
    }
  };

  visitScope(program, program.body, new Set());
  return changed;
}

function addParams(scopeNode: TYPE.Node, declared: Set<string>): void {
  if (!FUNCTION_TYPES.has(scopeNode.type)) return;
  const fn = scopeNode as TYPE.Function;
  for (const param of fn.params) {
    if (TYPE.isIdentifier(param)) declared.add(param.name);
    else if (TYPE.isAssignmentPattern(param) && TYPE.isIdentifier(param.left)) declared.add(param.left.name);
    else if (TYPE.isRestElement(param) && TYPE.isIdentifier(param.argument)) declared.add(param.argument.name);
    else if (TYPE.isObjectPattern(param) || TYPE.isArrayPattern(param)) {
      for (const name of patternNames(param)) declared.add(name);
    }
  }
  if ((TYPE.isFunctionDeclaration(fn) || TYPE.isFunctionExpression(fn)) && fn.id) {
    declared.add(fn.id.name);
  }
}

function patternNames(pattern: TYPE.ObjectPattern | TYPE.ArrayPattern): string[] {
  const names: string[] = [];
  const walk = (node: TYPE.Node | null | undefined): void => {
    if (!node) return;
    if (TYPE.isIdentifier(node)) {
      names.push(node.name);
      return;
    }
    if (TYPE.isAssignmentPattern(node)) {
      walk(node.left);
      return;
    }
    if (TYPE.isRestElement(node)) {
      walk(node.argument);
      return;
    }
    if (TYPE.isObjectPattern(node)) {
      for (const property of node.properties) {
        if (TYPE.isRestElement(property)) walk(property.argument);
        else walk(property.value);
      }
      return;
    }
    if (TYPE.isArrayPattern(node)) {
      for (const element of node.elements) walk(element);
    }
  };
  walk(pattern);
  return names;
}

function isReference(node: TYPE.Identifier, parent: TYPE.Node | null, key: string | null): boolean {
  if (!parent) return true;
  if (TYPE.isVariableDeclarator(parent) && key === "id") return false;
  if (TYPE.isFunction(parent) && key === "id") return false;
  if (TYPE.isClass(parent) && key === "id") return false;
  if (TYPE.isMemberExpression(parent) && key === "property" && !parent.computed) return false;
  if (TYPE.isOptionalMemberExpression(parent) && key === "property" && !parent.computed) return false;
  if ((TYPE.isObjectProperty(parent) || TYPE.isObjectMethod(parent) || TYPE.isClassProperty(parent))
      && key === "key" && !parent.computed) return false;
  if (TYPE.isLabeledStatement(parent) && key === "label") return false;
  if ((TYPE.isBreakStatement(parent) || TYPE.isContinueStatement(parent)) && key === "label") return false;
  if (TYPE.isImportSpecifier(parent) || TYPE.isImportDefaultSpecifier(parent) || TYPE.isImportNamespaceSpecifier(parent)) return false;
  return true;
}

function addDeclaration(body: TYPE.Statement[], names: string[]): void {
  const declaration = TYPE.variableDeclaration(
    "let",
    names.map(name => TYPE.variableDeclarator(TYPE.identifier(name), null)),
  );
  let index = 0;
  while (index < body.length && TYPE.isExpressionStatement(body[index])
      && (body[index] as any).directive != null) {
    index++;
  }
  body.splice(index, 0, declaration);
}
