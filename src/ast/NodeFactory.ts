/* eslint-disable max-lines */
import * as generator from '@babel/generator';
import * as TYPE from '@babel/types';
import * as parser from '@babel/parser'
import { formatLongLogicalChains } from './FormatCode';

export class NodeFactory {
    public static parse(code:string):TYPE.Program{
        return parser.parse(code,{sourceType:"module",allowUndeclaredExports:true}).program;
    }

    public static generate(node:TYPE.Node):string{
        const code = generator.default(node,{
            jsescOption:{
                minimal:true,
            },
        }).code;
        return formatLongLogicalChains(code);
    }
    public static thisExpressionNode():TYPE.ThisExpression{
        return TYPE.thisExpression();
    }

    public static programNode():TYPE.Program{
        return TYPE.program([],undefined,"module");
    }

    public static identifierNode(name:string,type?:string):TYPE.Identifier{
        const id = TYPE.identifier(name);
        if (type !=null){
            id.trailingComments = []
            id.trailingComments.push({
                value: type,
                type: "CommentBlock"
            })
        }
        return id
    }

    public static variableDeclaratorNode(id:TYPE.LVal,init?: TYPE.Expression | null):TYPE.VariableDeclarator{
        return TYPE.variableDeclarator(id,init ?? null);
    }

    public static variableDeclarationNode(declarations: Array<TYPE.VariableDeclarator>,kind: "var" | "let" | "const" | "using" | "await using"):TYPE.VariableDeclaration{
        return TYPE.variableDeclaration(kind,declarations);
    }

    public static assignmentExpressionNode(operator: string, left: TYPE.LVal | TYPE.OptionalMemberExpression, right: TYPE.Expression):TYPE.AssignmentExpression{
        return TYPE.assignmentExpression(operator,left,right);
    }

    public static expressionStatementNode(expression: TYPE.Expression):TYPE.ExpressionStatement{
        return TYPE.expressionStatement(expression);
    }

    public static blockStatementNode():TYPE.BlockStatement{
        return TYPE.blockStatement([]);
    }

    public static nullLiteralNode():TYPE.NullLiteral{
        return TYPE.nullLiteral();
    }

    public static stringLiteralNode(value:string):TYPE.StringLiteral{
        return TYPE.stringLiteral(value);
    }

    public static numberLiteralNode(value:number):TYPE.NumericLiteral{
        return TYPE.numericLiteral(value);
    }

    public static booleanLiteralNode(value:boolean):TYPE.BooleanLiteral{
        return TYPE.booleanLiteral(value);
    }

    public static memberExpressionNode(object: TYPE.Expression | TYPE.Super, property: TYPE.Expression | TYPE.Identifier | TYPE.PrivateName, computed?: boolean):TYPE.MemberExpression{
        return TYPE.memberExpression(object,property,computed);
    }

    public static callExpressionNode(callee: TYPE.Expression | TYPE.Super | TYPE.V8IntrinsicIdentifier, _arguments: Array<TYPE.Expression | TYPE.SpreadElement | TYPE.ArgumentPlaceholder> ):TYPE.CallExpression{
        return TYPE.callExpression(callee as any,_arguments as any);
    }

    public static returnStatementNode(argument?: TYPE.Expression | null):TYPE.ReturnStatement{
        return TYPE.returnStatement(argument)
    }

    public static functionExpressionNode(id:TYPE.Identifier | null | undefined,params: Array<TYPE.Identifier | TYPE.Pattern | TYPE.RestElement>, body: TYPE.BlockStatement, async?: boolean,generator?: boolean,):TYPE.FunctionExpression{
        if (body.extra && body.extra["panda_async"] === true) async = true;
        if (body.extra && body.extra["panda_generator"] === true) generator = true;
        return TYPE.functionExpression(id as any,params,body,generator,async);
    }

    public static classMethodNode(key: TYPE.Identifier | TYPE.StringLiteral | TYPE.NumericLiteral | TYPE.BigIntLiteral | TYPE.Expression,func:TYPE.FunctionExpression,kind:"get" | "set" | "method" | "constructor", computed:boolean, isStatic:boolean):TYPE.ClassMethod{
        return TYPE.classMethod(kind,key,func.params,func.body,computed,isStatic,func.generator,func.async);
    }

    public static classBodyNode(body: Array<TYPE.ClassMethod | TYPE.ClassPrivateMethod | TYPE.ClassProperty | TYPE.ClassPrivateProperty | TYPE.ClassAccessorProperty | TYPE.TSDeclareMethod | TYPE.TSIndexSignature | TYPE.StaticBlock>):TYPE.ClassBody{
        return TYPE.classBody(body);
    }

    public static classPropertyNode(key: TYPE.Identifier | TYPE.StringLiteral | TYPE.NumericLiteral | TYPE.BigIntLiteral | TYPE.Expression, value?: TYPE.Expression | null):TYPE.ClassProperty {
        return TYPE.classProperty(key,value);
    }

    public static classExpressionNode(id: TYPE.Identifier | null | undefined, superClass: TYPE.Expression | null | undefined, body: TYPE.ClassBody, decorators?: Array<TYPE.Decorator> | null):TYPE.ClassExpression{
        return TYPE.classExpression(id,superClass,body,decorators);
    }

    public static spreadElementNode(argument: TYPE.Expression):TYPE.SpreadElement{
        return TYPE.spreadElement(argument)
    }

    public static arrayExpressionNode(elements?: Array<null | TYPE.Expression | TYPE.SpreadElement>):TYPE.ArrayExpression{
        return TYPE.arrayExpression(elements)
    }

    public static superNode():TYPE.Super{
        return TYPE.super();
    }

    public static newExpressionNode(callee: TYPE.Expression | TYPE.Super | TYPE.V8IntrinsicIdentifier, _arguments: Array<TYPE.Expression | TYPE.SpreadElement | TYPE.ArgumentPlaceholder>):TYPE.NewExpression{
        return TYPE.newExpression(callee as any,_arguments as any);
    }

    public static objectPropertyNode(key: TYPE.Expression | TYPE.Identifier | TYPE.StringLiteral | TYPE.NumericLiteral | TYPE.BigIntLiteral | TYPE.DecimalLiteral | TYPE.PrivateName, value: TYPE.Expression | TYPE.PatternLike):TYPE.ObjectProperty{
        return TYPE.objectProperty(key,value);
    }

    public static objectExpressionNode(properties: Array<TYPE.ObjectMethod | TYPE.ObjectProperty | TYPE.SpreadElement>):TYPE.ObjectExpression{
        return TYPE.objectExpression(properties);
    }

    public static updateExpressionNode(operator: "++" | "--", argument: TYPE.Expression, prefix?: boolean):TYPE.UpdateExpression{
        return TYPE.updateExpression(operator,argument,prefix);
    }

    public static unaryExpressionNode(operator: "void" | "throw" | "delete" | "!" | "+" | "-" | "~" | "typeof", argument: TYPE.Expression, prefix?: boolean):TYPE.UnaryExpression{
        return TYPE.unaryExpression(operator,argument,prefix);
    }

    public static throwStatementNode(argument: TYPE.Expression):TYPE.ThrowStatement{
        return TYPE.throwStatement(argument)
    }

    public static binaryExpressionNode(operator: "+" | "-" | "/" | "%" | "*" | "**" | "&" | "|" | ">>" | ">>>" | "<<" | "^" | "==" | "===" | "!=" | "!==" | "in" | "instanceof" | ">" | "<" | ">=" | "<=" | "|>", left: TYPE.Expression | TYPE.PrivateName, right: TYPE.Expression):TYPE.BinaryExpression{
        return TYPE.binaryExpression(operator,left,right);
    }

    public static addComment(node:TYPE.Program|TYPE.BlockStatement,value:string):void{
        TYPE.addComment(node,"inner",value,false);
    }

    public static addTrailingComment(node:TYPE.Program|TYPE.BlockStatement,value:string):void{
        TYPE.addComment(node,"trailing",value,true);
    }

    public static addLeadingComment(node:TYPE.Program|TYPE.BlockStatement,value:string):void{
        TYPE.addComment(node,"leading",value,true);
    }

    public static ifStatementNode(test: TYPE.Expression, consequent: TYPE.Statement, alternate?: TYPE.Statement | null):TYPE.IfStatement{
        return TYPE.ifStatement(test,consequent,alternate);
    }

    public static doWhileStatementNode(test: TYPE.Expression,body: TYPE.Statement):TYPE.DoWhileStatement{
        return TYPE.doWhileStatement(test,body);
    }

    public static whileStatementNode(test: TYPE.Expression,body: TYPE.Statement):TYPE.WhileStatement{
        return TYPE.whileStatement(test,body);
    }

    public static breakStatement():TYPE.BreakStatement{
        return TYPE.breakStatement();
    }

    public static continueStatement():TYPE.ContinueStatement{
        return TYPE.continueStatement();
    }

    public static labeledStatementNode(name:string,body: TYPE.Statement):TYPE.LabeledStatement{
        if (body == null) body = TYPE.emptyStatement();
        return TYPE.labeledStatement(TYPE.identifier(name),body);
    }


    public static tryStatementNode(tryBody:TYPE.BlockStatement,catchBody:TYPE.BlockStatement):TYPE.TryStatement{
        return TYPE.tryStatement(tryBody,TYPE.catchClause(TYPE.identifier("acc"),catchBody))
    }

    public static awaitExpressionNode(argument: TYPE.Expression):TYPE.AwaitExpression{
        return TYPE.awaitExpression(argument);
    }

    public static dynamicImportExpressionNode(argument: TYPE.Expression):TYPE.CallExpression{
        return TYPE.callExpression(TYPE.import(),[TYPE.identifier("acc")]);
    }

    public static importSpecifierNode(local: string ,imported: string):TYPE.ImportSpecifier{
        return TYPE.importSpecifier(TYPE.identifier(local),TYPE.identifier(imported));
    }

    public static importDefaultSpecifierNode(local: string):TYPE.ImportDefaultSpecifier{
        return TYPE.importDefaultSpecifier(TYPE.identifier(local));
    }

    public static importNamespaceSpecifierNode(local: string):TYPE.ImportNamespaceSpecifier{
        return TYPE.importNamespaceSpecifier(TYPE.identifier(local));
    }

    public static importDeclarationNode(specifier: TYPE.ImportSpecifier | TYPE.ImportDefaultSpecifier | TYPE.ImportNamespaceSpecifier, source: string):TYPE.ImportDeclaration{
        return TYPE.importDeclaration([specifier],TYPE.stringLiteral(source));
    }

    public static exportDefaultDeclarationNode(name:string):TYPE.ExportDefaultDeclaration{
        return TYPE.exportDefaultDeclaration(TYPE.identifier(name));
    }

    public static exportDefaultSpecifierNode(exported:string):TYPE.ExportDefaultSpecifier{
        return TYPE.exportDefaultSpecifier(TYPE.identifier(exported))
    }

    public static exportSpecifierNode(local:string, exported:string):TYPE.ExportSpecifier{
        return TYPE.exportSpecifier(TYPE.identifier(local),TYPE.identifier(exported))
    }

    public static exportNamedDeclarationNode(specifier:TYPE.ExportSpecifier,path:string|null|undefined):TYPE.ExportNamedDeclaration{
        return TYPE.exportNamedDeclaration(null,[specifier],path?TYPE.stringLiteral(path):null);
    }

    public static exportAllDeclarationNode(path:string):TYPE.ExportAllDeclaration{
        return TYPE.exportAllDeclaration(TYPE.stringLiteral(path));
    }

    public static sequenceExpressionNode(expressions: Array<TYPE.Expression>):TYPE.SequenceExpression{
        return TYPE.sequenceExpression(expressions??[]);
    }

    public static logicalExpressionNode(operator: "||" | "&&" | "??", left: TYPE.Expression, right: TYPE.Expression):TYPE.LogicalExpression{
        return TYPE.logicalExpression(operator,left,right);
    }

    public static yieldExpressionNode(argument: TYPE.Expression ):TYPE.YieldExpression{
        return TYPE.yieldExpression(argument);
    }


}