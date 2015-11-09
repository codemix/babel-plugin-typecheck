import generate from "babel-generator";

type Node = {
  type: string;
};

type Identifier = {
  type: string;
  name: string;
};

type QualifiedTypeIdentifier = {
  id: Identifier;
  qualification: Identifier|QualifiedTypeIdentifier;
};

type TypeAnnotation = {
  type: string;
};

type Scope = {};

type NodePath = {
  type: string;
  node: Node;
  scope: Scope;
};

/**
 * # Typecheck Transformer
 */
export default function ({types: t, template}): Object {
  // constants used when statically verifying types
  const TYPE_INVALID = 0;
  const TYPE_VALID = 1;
  const TYPE_UNKNOWN = 2;

  /**
   * Binary Operators that can only produce boolean results.
   */
  const BOOLEAN_BINARY_OPERATORS: Array<string> = [
    '==',
    '===',
    '>=',
    '<=',
    '>',
    '<',
    'instanceof'
  ];

  const checks: Object = createChecks();
  const staticChecks: Object = createStaticChecks();

  const checkIsArray: (() => Node) = template(`Array.isArray(input)`);
  const checkIsObject: (() => Node) = template(`input != null && typeof input === 'object'`);
  const checkNotNull: (() => Node) = template(`input != null`);

  const declareTypeChecker: (() => Node) = template(`
    const id = function id (input) {
      return check;
    };
  `);

  const guard: (() => Node) = template(`
    if (!check) {
      throw new TypeError(message);
    }
  `);

  const thrower: (() => Node) = template(`
    if (check) {
      ret;
    }
    else {
      throw new TypeError(message);
    }
  `);

  const readableName: (() => Node) = template(`
    input === null ? 'null' : typeof input === 'object' && input.constructor ? input.constructor.name || '[Unknown Object]' : typeof input
  `);

  const stack:Array<{node: Node; returns: number; isVoid: ?boolean; type: ?TypeAnnotation}> = [];

  return {
    inherits: require("babel-plugin-syntax-flow"),
    visitor: {
      TypeAlias (path: NodePath): void {
        path.replaceWith(createTypeAliasChecks(path));
      },

      InterfaceDeclaration (path: NodePath): void {
        path.replaceWith(createInterfaceChecks(path));
      },

      ExportNamedDeclaration (path: NodePath): void {
        const {node, scope} = path;
        if (node.declaration.type === 'TypeAlias') {
          path.replaceWith(t.exportNamedDeclaration(
            createTypeAliasChecks(path.get('declaration')),
            [],
            null
          ));
        }
      },

      ImportDeclaration (path: NodePath): void {
        if (path.node.importKind !== 'type') {
          return;
        }
        const [declarators, specifiers] = path.get('specifiers')
          .map(specifier => {
            const local = specifier.get('local');
            const tmpId = path.scope.generateUidIdentifierBasedOnNode(local.node);
            const replacement = t.importSpecifier(tmpId, specifier.node.imported);
            const id = t.identifier(local.node.name);

            id.isTypeChecker = true;
            const declarator = t.variableDeclarator(id, tmpId);
            declarator.isTypeChecker = true;
            return [declarator, replacement];
          })
          .reduce(([declarators, specifiers], [declarator, specifier]) => {
            declarators.push(declarator);
            specifiers.push(specifier);
            return [declarators, specifiers];
          }, [[], []]);

        const declaration = t.variableDeclaration('var', declarators);
        declaration.isTypeChecker = true;

        path.replaceWithMultiple([
          t.importDeclaration(specifiers, path.node.source),
          declaration
        ]);
      },

      Function: {
        enter (path: NodePath): void {
          const {node, scope} = path;
          const paramChecks = collectParamChecks(path);
          if (node.type === "ArrowFunctionExpression" && node.expression) {
            node.expression = false;
            node.body = t.blockStatement([t.returnStatement(node.body)]);
          }
          node.body.body.unshift(...paramChecks);
          const isVoid = node.returnType ? maybeNullableAnnotation(node.returnType) : null;
          node.savedTypeAnnotation = node.returnType;
          stack.push({node, returns: 0, isVoid, type: node.returnType});
        },
        exit (path: NodePath): void {
          const {node, returns, isVoid, type} = stack.pop();
          if (isVoid === false && returns === 0) {
            throw new SyntaxError(`Function ${node.id ? `"${node.id.name}" ` : ''}did not return a value, expected ${humanReadableType(type, path.scope)}`);
          }
        }
      },

      ReturnStatement (path: NodePath): void {
        const {node, parent, scope} = path;
        if (stack.length === 0 || node.isTypeChecked) {
          return;
        }
        stack[stack.length - 1].returns++;
        const {node: fn} = stack[stack.length - 1];
        const {returnType} = fn;
        if (!returnType) {
          return;
        }
        if (!node.argument) {
          if (maybeNullableAnnotation(returnType) === false) {
            throw new SyntaxError(`Function ${fn.id ? `"${fn.id.name}" ` : ''}did not return a value, expected ${humanReadableType(returnType, path.scope)}`);
          }
          return;
        }
        let id;
        if (node.argument.type === 'Identifier') {
          id = node.argument;
        }
        else {
          id = scope.generateUidIdentifierBasedOnNode(node.argument);
        }
        const ok = staticCheckAnnotation(path.get("argument"), returnType);
        if (ok === true) {
          return;
        }
        else if (ok === false) {
          throw new SyntaxError(`Invalid return type, expected ${humanReadableType(returnType, scope)}`);
        }
        const check = checkAnnotation(id, returnType, scope);
        if (!check) {
          return;
        }
        if (parent.type !== 'BlockStatement' && parent.type !== 'Program') {
          const block = [];
          if (node.argument.type !== 'Identifier') {
            scope.push({id: id});
            block.push(t.expressionStatement(
              t.assignmentExpression(
                '=',
                id,
                node.argument
              ))
            );
          }
          const ret = t.returnStatement(id);
          ret.isTypeChecked = true;
          block.push(thrower({
            check,
            ret,
            message: returnTypeErrorMessage(path, fn, id)
          }));
          path.replaceWith(t.blockStatement(block));
        }
        else {
          if (node.argument.type !== 'Identifier') {
            scope.push({id: id});
            path.insertBefore(t.expressionStatement(
              t.assignmentExpression(
                '=',
                id,
                node.argument
              ))
            );
          }
          const ret = t.returnStatement(id);
          ret.isTypeChecked = true;
          path.replaceWith(thrower({
            check,
            ret,
            message: returnTypeErrorMessage(path, fn, id)
          }));
        }
      },

      VariableDeclaration (path: NodePath): void {
        const {node, scope} = path;
        const collected = [];
        const declarations = path.get("declarations");
        for (let i = 0; i < node.declarations.length; i++) {
          const declaration = node.declarations[i];
          const {id, init} = declaration;
          if (!id.typeAnnotation || id.hasBeenTypeChecked) {
            continue;
          }
          id.savedTypeAnnotation = id.typeAnnotation;
          id.hasBeenTypeChecked = true;
          const ok = staticCheckAnnotation(declarations[i], id.typeAnnotation);
          if (ok === true) {
            continue;
          }
          else if (ok === false) {
            throw new SyntaxError(`Invalid assignment value, expected ${humanReadableType(id.typeAnnotation, scope)}`);
          }
          const check = checkAnnotation(id, id.typeAnnotation, scope);
          if (check) {
            collected.push(guard({
              check,
              message: varTypeErrorMessage(id, scope)
            }));
          }
        }
        if (collected.length > 0) {
          const check = collected.reduce((check, branch) => {
            branch.alternate = check;
            return branch;
          });
          if (path.parent.type === 'Program' || path.parent.type === 'BlockStatement') {
            path.insertAfter(check);
          }
          else {
            path.replaceWith(t.blockStatement([node, check]));
          }
        }
      },

      AssignmentExpression (path: NodePath): void {
        const {node, scope} = path;
        if (node.hasBeenTypeChecked || node.left.hasBeenTypeChecked) {
          return;
        }
        const binding = scope.getBinding(node.left.name);
        if (!binding || binding.path.type !== 'VariableDeclarator') {
          return;
        }
        let annotation = path.get('left').getTypeAnnotation();
        if (annotation.type === 'AnyTypeAnnotation') {
          const item = binding.path.get('id');
          annotation = item.node.savedTypeAnnotation || item.getTypeAnnotation();
        }

        node.hasBeenTypeChecked = true;
        node.left.hasBeenTypeChecked = true;
        if (annotation.type === 'AnyTypeAnnotation') {
          annotation = getAnnotation(path.get('right'));
          if (allowsAny(annotation)) {
            return;
          }
        }
        const id = node.left;
        const right = path.get('right');
        const ok = staticCheckAnnotation(right, annotation);
        if (ok === true) {
          return;
        }
        else if (ok === false) {
          throw new SyntaxError(`Invalid assignment value, expected ${humanReadableType(annotation, scope)}`);
        }
        const check = checkAnnotation(id, annotation, scope);
        if (!id.typeAnnotation) {
          id.typeAnnotation = annotation;
        }
        id.hasBeenTypeChecked = true;
        if (check) {
          path.getStatementParent().insertAfter(guard({
            check,
            message: varTypeErrorMessage(id, scope)
          }));
        }
      },

      TypeCastExpression (path: NodePath): void {
        const {node} = path;
        let target;
        switch (node.expression.type) {
          case 'Identifier':
            target = node.expression;
            break;
          case 'AssignmentExpression':
            target = node.expression.left;
            break;
          default:
            // unsupported.
            return;
        }
        const id = path.scope.getBindingIdentifier(target.name);
        if (!id) {
          return;
        }
        id.savedTypeAnnotation = path.getTypeAnnotation();
      }
    }
  };

  function createChecks (): Object {
    return {
      number: template(`typeof input === 'number'`),
      boolean: template(`typeof input === 'boolean'`),
      function: template(`typeof input === 'function'`),
      string: template(`typeof input === 'string'`),
      symbol: template(`typeof input === 'symbol'`),
      undefined: template(`input === undefined`),
      null: template(`input === null`),
      nullOrUndefined: template(`input == null`),
      instanceof: template(`input instanceof type`),
      type: template(`type(input)`),
      mixed: () => null,
      any: () => template(`input != null`).expression,
      union: checkUnion,
      array: checkArray,
      tuple: checkTuple,
      object: checkObject,
      nullable: checkNullable
    };
  }

  function createStaticChecks (): Object {
    return {
      string (path: NodePath): ?boolean {
        return maybeStringAnnotation(getAnnotation(path));
      },
      number (path: NodePath): ?boolean {
        return maybeNumberAnnotation(getAnnotation(path));
      },
      boolean (path: NodePath): ?boolean {
        return maybeBooleanAnnotation(getAnnotation(path));
      },
      function (path: NodePath): ?boolean {
        return maybeFunctionAnnotation(getAnnotation(path));
      },
      any (path: NodePath): ?boolean {
        return null;
      },
      instanceof ({path, type}): ?boolean {
        const {node, scope} = path;
        if (type.name === 'Object' && !scope.hasBinding('Object') && node.type === 'ObjectExpression') {
          return true;
        }
        return maybeInstanceOfAnnotation(getAnnotation(path), type);
      },
      type ({path, type}): ?boolean {
        return null;
      },
      array ({path, types}): ?boolean {
        const {node} = path;
        if (node.type === 'ArrayExpression') {
          if (types.length === 0) {
            return true;
          }
          else if (node.elements.length < types.length) {
            return false;
          }
          else {
            return null;
          }
        }
        else if (maybeArrayAnnotation(getAnnotation(path)) === false) {
          return false;
        }
        else {
          return null;
        }
      },
      tuple ({path, types}) {
        const {node} = path;
        let annotation = getAnnotation(path);
        if (annotation.type === 'TypeAnnotation' || annotation.type === 'NullableTypeAnnotation') {
          annotation = annotation.typeAnnotation;
        }
        //console.log('TUPLE!');
        return maybeTupleAnnotation(annotation);
      },
      union: checkStaticUnion,
      object: checkStaticObject,
      nullable: checkStaticNullable,
    };
  }

  function compareAnnotations (a: TypeAnnotation, b: TypeAnnotation): ?boolean {

    if (a.type === 'TypeAnnotation') {
      a = a.typeAnnotation;
    }
    if (b.type === 'TypeAnnotation') {
      b = b.typeAnnotation;
    }
    switch (a.type) {
      case 'StringTypeAnnotation':
      case 'StringLiteralTypeAnnotation':
        return maybeStringAnnotation(b);
      case 'NumberTypeAnnotation':
      case 'NumericLiteralTypeAnnotation':
        return maybeNumberAnnotation(b);
      case 'BooleanTypeAnnotation':
      case 'BooleanLiteralTypeAnnotation':
        return maybeBooleanAnnotation(b);
      case 'FunctionTypeAnnotation':
        return maybeFunctionAnnotation(b);
      case 'AnyTypeAnnotation':
        return null;
      case 'MixedTypeAnnotation':
        return null;
      case 'ObjectTypeAnnotation':
        return compareObjectAnnotation(a, b);
      case 'ArrayTypeAnnotation':
        return compareArrayAnnotation(a, b);
      case 'GenericTypeAnnotation':
        return compareGenericAnnotation(a, b);
      case 'TupleTypeAnnotation':
        return compareTupleAnnotation(a, b);
      case 'UnionTypeAnnotation':
        return compareUnionAnnotation(a, b);
      case 'NullableTypeAnnotation':
        return compareNullableAnnotation(a, b);
      default:
        return null;
    }
  }

  function unionComparer (a: TypeAnnotation, b: TypeAnnotation, comparator: (a:TypeAnnotation, b:TypeAnnotation) => ?boolean): ?boolean {
    let falseCount = 0;
    let trueCount = 0;
    if (!a.types) {
      //console.trace(a.type);
      return null;
    }
    for (let type of a.types) {
      const result = comparator(type, b);
      if (result === true) {
        if (b.type !== 'UnionTypeAnnotation') {
          return true;
        }
        trueCount++;
      }
      else if (result === false) {
        if (b.type === 'UnionTypeAnnotation') {
          return false;
        }
        falseCount++;
      }
    }
    if (falseCount === a.types.length) {
      return false;
    }
    else if (trueCount === a.types.length) {
      return true;
    }
    else {
      return null;
    }
  }

  function compareObjectAnnotation (a: Node, b: Node): ?boolean {
    switch (b.type) {
      case 'TypeAnnotation':
      case 'NullableTypeAnnotation':
        return compareObjectAnnotation(a, b.typeAnnotation);
      case 'UnionTypeAnnotation':
        return unionComparer(a, b, compareObjectAnnotation);
      case 'VoidTypeAnnotation':
      case 'BooleanTypeAnnotation':
      case 'BooleanLiteralTypeAnnotation':
      case 'StringTypeAnnotation':
      case 'StringLiteralTypeAnnotation':
      case 'NumberTypeAnnotation':
      case 'NumericLiteralTypeAnnotation':
      case 'FunctionTypeAnnotation':
        return false;
      default:
        return null;
    }
  }

  function compareArrayAnnotation (a: Node, b: Node): ?boolean {
    switch (b.type) {
      case 'TypeAnnotation':
      case 'NullableTypeAnnotation':
        return compareArrayAnnotation(a, b.typeAnnotation);
      case 'UnionTypeAnnotation':
        return unionComparer(a, b, compareObjectAnnotation);
      case 'VoidTypeAnnotation':
      case 'BooleanTypeAnnotation':
      case 'BooleanLiteralTypeAnnotation':
      case 'StringTypeAnnotation':
      case 'StringLiteralTypeAnnotation':
      case 'NumberTypeAnnotation':
      case 'NumericLiteralTypeAnnotation':
      case 'FunctionTypeAnnotation':
        return false;
      default:
        return null;
    }
  }

  function compareGenericAnnotation (a: Node, b: Node): ?boolean {
    switch (b.type) {
      case 'TypeAnnotation':
      case 'NullableTypeAnnotation':
        return compareGenericAnnotation(a, b.typeAnnotation);
      case 'GenericTypeAnnotation':
        if (b.id.name === a.id.name) {
          return true;
        }
        else {
          return null;
        }
      case 'UnionTypeAnnotation':
        return unionComparer(a, b, compareGenericAnnotation);
      default:
        return null;
    }
  }

  function compareTupleAnnotation (a: Node, b: Node): ?boolean {
    if (b.type === 'TupleTypeAnnotation') {
      if (b.types.length === 0) {
        return null;
      }
      else if (b.types.length < a.types.length) {
        return false;
      }
      return a.types.every((type, index) => compareAnnotations(type, b.types[index]));
    }
    switch (b.type) {
      case 'TypeAnnotation':
      case 'NullableTypeAnnotation':
        return compareTupleAnnotation(a, b.typeAnnotation);
      case 'UnionTypeAnnotation':
        return unionComparer(a, b, compareTupleAnnotation);
      case 'VoidTypeAnnotation':
      case 'BooleanTypeAnnotation':
      case 'BooleanLiteralTypeAnnotation':
      case 'StringTypeAnnotation':
      case 'StringLiteralTypeAnnotation':
      case 'NumberTypeAnnotation':
      case 'NumericLiteralTypeAnnotation':
      case 'FunctionTypeAnnotation':
        return false;
      default:
        return null;
    }
  }

  function compareUnionAnnotation (a: Node, b: Node): ?boolean {
    switch (b.type) {
      case 'NullableTypeAnnotation':
        return compareUnionAnnotation(a, b.typeAnnotation);
      case 'AnyTypeAnnotation':
      case 'MixedTypeAnnotation':
        return null;
      default:
        return unionComparer(a, b, compareAnnotations);
    }
  }

  function compareNullableAnnotation (a: Node, b: Node): ?boolean {
    switch (b.type) {
      case 'TypeAnnotation':
        return compareNullableAnnotation(a, b.typeAnnotation);
      case 'NullableTypeAnnotation':
      case 'VoidTypeAnnotation':
        return null;
    }
    if (compareAnnotations(a.typeAnnotation, b) === true) {
      return true;
    }
    else {
      return null;
    }
  }

  function arrayExpressionToTupleAnnotation (path: NodePath): TypeAnnotation {
    const elements = path.get('elements');
    return t.tupleTypeAnnotation(elements.map(element => getAnnotation(element)));
  }

  function checkStaticUnion ({path, types}) {
    let falseCount = 0;
    let nullCount = 0;
    for (let type of types) {
      const result = staticCheckAnnotation(path, type);
      if (result === true) {
        return true;
      }
      else if (result === false) {
        falseCount++;
      }
      else {
        nullCount++;
      }
    }
    if (falseCount === types.length) {
      return false;
    }
    else {
      return null;
    }
  }

  function checkStaticObject ({path, type}) {
  }

  function checkStaticNullable ({path, type}): ?boolean {
    const annotation = getAnnotation(path);
    if (annotation.type === 'VoidTypeAnnotation' || annotation.type === 'NullableTypeAnnotation') {
      return true;
    }
    else {
      return staticCheckAnnotation(path, type);
    }
  }

  function checkNullable ({input, type, scope}): ?Node {
    const check = checkAnnotation(input, type, scope);
    if (!check) {
      return;
    }
    return t.logicalExpression(
      "||",
      checks.undefined({input}).expression,
      check
    );
  }

  function checkUnion ({input, types, scope}): ?Node {
    const checks = types.map(type => checkAnnotation(input, type, scope)).filter(identity);
    return checks.reduce((last, check, index) => {
      if (last == null) {
        return check;
      }
      return t.logicalExpression(
        "||",
        last,
        check
      );
    }, null);
  }

  function checkArray ({input, types, scope}): Node {
    if (types.length === 0) {
      return checkIsArray({input}).expression;
    }
    else if (types.length === 1) {
      const item = t.identifier('item');
      const type = types[0];
      const check = checkAnnotation(item, type, scope);
      if (!check) {
        return checkIsArray({input}).expression;
      }
      return t.logicalExpression(
        '&&',
        checkIsArray({input}).expression,
        t.callExpression(
          t.memberExpression(input, t.identifier('every')),
          [t.functionExpression(null, [item], t.blockStatement([
            t.returnStatement(check)
          ]))]
        )
      );
    }
    else {
      // This is a tuple
      const checks = types.map(
        (type, index) => checkAnnotation(
          t.memberExpression(
            input,
            t.numericLiteral(index),
            true
          ),
          type,
          scope
        )
      ).filter(identity);

      const checkLength = t.binaryExpression(
        '>=',
        t.memberExpression(
          input,
          t.identifier('length')
        ),
        t.numericLiteral(types.length)
      );

      return checks.reduce((last, check, index) => {
        return t.logicalExpression(
          "&&",
          last,
          check
        );
      }, t.logicalExpression(
        '&&',
        checkIsArray({input}).expression,
        checkLength
      ));
    }
  }

  function checkTuple ({input, types, scope}): Node {
    if (types.length === 0) {
      return checkIsArray({input}).expression;
    }

    // This is a tuple
    const checks = types.map(
      (type, index) => checkAnnotation(
        t.memberExpression(
          input,
          t.numericLiteral(index),
          true
        ),
        type,
        scope
      )
    ).filter(identity);

    const checkLength = t.binaryExpression(
      '>=',
      t.memberExpression(
        input,
        t.identifier('length')
      ),
      t.numericLiteral(types.length)
    );

    return checks.reduce((last, check, index) => {
      return t.logicalExpression(
        "&&",
        last,
        check
      );
    }, t.logicalExpression(
      '&&',
      checkIsArray({input}).expression,
      checkLength
    ));
  }

  function checkObject ({input, properties, scope}): Node {
    return properties.reduce((expr, prop, index) => {
      const target = t.memberExpression(input, prop.key);
      let check = checkAnnotation(target, prop.value, scope);
      if (check) {
        if (prop.optional) {
          check = t.logicalExpression(
            '||',
            checks.undefined({input: target}).expression,
            check
          );
        }
        return t.logicalExpression(
          "&&",
          expr,
          check
        );
      }
      else {
        return expr;
      }
    }, checkIsObject({input}).expression);
  }

  function createTypeAliasChecks (path: NodePath): Node {
    const {node, scope} = path;
    const {id, right: annotation} = node;
    const input = t.identifier('input');
    const check = checkAnnotation(input, annotation, scope) || t.booleanLiteral(true);
    const declaration = declareTypeChecker({id, check});
    declaration.isTypeChecker = true;
    return declaration;
  }


  function createInterfaceChecks (path: NodePath): Node {
    const {node, scope} = path;
    const {id, body: annotation} = node;
    const input = t.identifier('input');
    const check = node.extends.reduce(
      (check, extender) => {
        return t.logicalExpression(
          '&&',
          check,
          checkAnnotation(input, t.genericTypeAnnotation(extender.id), path.scope)
        );
        return check;
      },
      checkAnnotation(input, annotation, scope) || t.booleanLiteral(true)
    );

    const declaration = declareTypeChecker({id, check});
    declaration.isTypeChecker = true;
    return declaration;
  }

  function checkAnnotation (input: Node, annotation: TypeAnnotation, scope: Scope): ?Node {
    switch (annotation.type) {
      case 'TypeAnnotation':
        return checkAnnotation(input, annotation.typeAnnotation, scope);
      case 'GenericTypeAnnotation':
        if (annotation.id.name === 'Array') {
          return checks.array({input, types: annotation.typeParameters ? annotation.typeParameters.params : [], scope});
        }
        else if (annotation.id.name === 'Function') {
          return checks.function({input}).expression;
        }
        else if (isTypeChecker(annotation.id, scope)) {
          return checks.type({input, type: annotation.id}).expression;
        }
        else if (isPolymorphicType(annotation.id, scope)) {
          return;
        }
        else {
          return checks.instanceof({input, type: createTypeExpression(annotation.id)}).expression;
        }
      case 'TupleTypeAnnotation':
        return checks.tuple({input, types: annotation.types, scope});
      case 'NumberTypeAnnotation':
      case 'NumericLiteralTypeAnnotation':
        return checks.number({input}).expression;
      case 'BooleanTypeAnnotation':
      case 'BooleanLiteralTypeAnnotation':
        return checks.boolean({input}).expression;
      case 'StringTypeAnnotation':
      case 'StringLiteralTypeAnnotation':
        return checks.string({input}).expression;
      case 'UnionTypeAnnotation':
        return checks.union({input, types: annotation.types, scope});
      case 'ObjectTypeAnnotation':
        return checks.object({input, properties: annotation.properties, scope});
      case 'ArrayTypeAnnotation':
        return checks.array({input, types: [annotation.elementType]});
      case 'FunctionTypeAnnotation':
        return checks.function({input, params: annotation.params, returnType: annotation.returnType});
      case 'MixedTypeAnnotation':
        return checks.mixed({input});
      case 'AnyTypeAnnotation':
        return checks.any({input});
      case 'NullableTypeAnnotation':
        return checks.nullable({input, type: annotation.typeAnnotation, scope}).expression;
      case 'VoidTypeAnnotation':
        return checks.undefined({input}).expression;
      default:
        //console.log(annotation);
        throw new Error('Unknown type: ' + annotation.type);
    }
  }

  function staticCheckAnnotation (path: NodePath, annotation: TypeAnnotation): ?boolean {
    const other = getAnnotation(path);

    switch (annotation.type) {
      case 'TypeAnnotation':
        return staticCheckAnnotation(path, annotation.typeAnnotation);
      case 'GenericTypeAnnotation':
        if (isTypeChecker(annotation.id, path.scope)) {
          return staticChecks.type({path, type: annotation.id});
        }
        else if (isPolymorphicType(annotation.id, path.scope)) {
          return;
        }
        else {
          return staticChecks.instanceof({path, type: createTypeExpression(annotation.id)});
        }
    }

    return compareAnnotations(annotation, other);
  }

  /**
   * Get the type annotation for a given node.
   */
  function getAnnotation (path: NodePath): TypeAnnotation {
    let annotation = getAnnotationShallow(path);
    while (annotation && annotation.type === 'TypeAnnotation') {
      annotation = annotation.typeAnnotation;
    }
    return annotation || t.anyTypeAnnotation();
  }

  function getAnnotationShallow (path: NodePath): ?TypeAnnotation {
    const {node, scope} = path;
    if (node.type === 'TypeAlias') {
      return node.right;
    }
    else if (!node.typeAnnotation && !node.savedTypeAnnotation && !node.returnType) {
      switch (path.type) {
        case 'Identifier':
          const id = scope.getBindingIdentifier(node.name);
          if (!id) {
            break;
          }
          if (id.savedTypeAnnotation) {
            return id.savedTypeAnnotation;
          }
          else if (id.returnType) {
            return id.returnType;
          }
          else if (id.typeAnnotation) {
            return id.typeAnnotation;
          }
          else if (isPolymorphicType(id, scope)) {
            return t.anyTypeAnnotation();
          }
          else {
            const binding = scope.getBinding(node.name);
            const violation = getConstantViolationsBefore(binding, path).pop();
            if (violation) {
              return getAnnotation(violation);
            }
          }
          return path.getTypeAnnotation();
        case 'NumericLiteral':
        case 'StringLiteral':
        case 'BooleanLiteral':
          return path.getTypeAnnotation();
        case 'CallExpression':
          const callee = path.get('callee');
          if (callee.type === 'Identifier') {
            const fn = getFunctionForIdentifier(callee);
            if (fn) {
              return getAnnotation(fn);
            }
          }
          break;
        case 'AssignmentExpression':
          return getAssignmentExpressionAnnotation(path);
        case 'MemberExpression':
          return getMemberExpressionAnnotation(path);
        case 'ArrayExpression':
          return getArrayExpressionAnnotation(path);
        case 'ObjectExpression':
          return getObjectExpressionAnnotation(path);
        case 'BinaryExpression':
          return getBinaryExpressionAnnotation(path);
        case 'BinaryExpression':
          return getBinaryExpressionAnnotation(path);
        case 'LogicalExpression':
          return getLogicalExpressionAnnotation(path);
        case 'ConditionalExpression':
          return getConditionalExpressionAnnotation(path);
        default:
          return path.getTypeAnnotation();

      }
    }
    return node.savedTypeAnnotation || node.returnType || node.typeAnnotation || path.getTypeAnnotation();
  }

  function getObjectMethodAnnotation (path: NodePath): ?TypeAnnotation {
    const {node} = path;
    return t.functionTypeAnnotation(
      null,
      node.params.map(param => param.savedTypeAnnotation || param.typeAnnotation),
      null,
      node.savedTypeAnnotation || node.returnType || node.typeAnnotation || t.anyTypeAnnotation()
    );
  }

  function getAssignmentExpressionAnnotation (path: NodePath): ?TypeAnnotation {
    if (path.node.operator === '=') {
      return getAnnotation(path.get('right'));
    }
  }

  function getBinaryExpressionAnnotation (path: NodePath): TypeAnnotation {
    const {node} = path;
    if (isBooleanExpression(node)) {
      return t.booleanTypeAnnotation();
    }
    else {
      return t.anyTypeAnnotation();
    }
  }

  function getLogicalExpressionAnnotation (path: NodePath): TypeAnnotation {
    const {node} = path;
    if (isBooleanExpression(node)) {
      return t.booleanTypeAnnotation();
    }
    else {
      let left = path.get('left');
      let right = path.get('right');
      switch (node.operator) {
        case '&&':
        case '||':
          ([left, right] = [getAnnotation(left), getAnnotation(right)]);
          if (t.isUnionTypeAnnotation(left)) {
            if (t.isUnionTypeAnnotation(right)) {
              return t.unionTypeAnnotation(left.types.concat(right.types));
            }
            else {
              return t.unionTypeAnnotation(left.types.concat(right));
            }
          }
          else {
            return t.unionTypeAnnotation([left, right]);
          }
      }
      return t.anyTypeAnnotation();
    }
  }


  function getConditionalExpressionAnnotation (path: NodePath): TypeAnnotation {
    const {node} = path;
    const consequent = getAnnotation(path.get('consequent'));
    const alternate = getAnnotation(path.get('alternate'));
    if (t.isUnionTypeAnnotation(consequent)) {
      if (t.isUnionTypeAnnotation(alternate)) {
        return t.unionTypeAnnotation(consequent.types.concat(alternate.types));
      }
      else {
        return t.unionTypeAnnotation(consequent.types.concat(alternate));
      }
    }
    else {
      return t.unionTypeAnnotation([consequent, alternate]);
    }
  }

  function getArrayExpressionAnnotation (path: NodePath): TypeAnnotation {
    return t.genericTypeAnnotation(
      t.identifier('Array'),
      path.get('elements').map(getAnnotation)
    );
  }

  function getObjectExpressionAnnotation (path: NodePath): TypeAnnotation {
    const annotation = t.objectTypeAnnotation(
      path.get('properties').map(property => {
        if (property.computed) {
          return;
        }
        switch (property.type) {
          case 'ObjectMethod':
            return t.objectTypeProperty(
              t.identifier(property.node.key.name),
              getObjectMethodAnnotation(property)
            );
          case 'ObjectProperty':
            return t.objectTypeProperty(
              t.identifier(property.node.key.name),
              property.node.value.savedTypeAnnotation || property.node.value.typeAnnotation || t.anyTypeAnnotation()
            );
        }
      }).filter(identity)
    );
    //console.log(generate(annotation).code);
    return annotation;
  }

  function getMemberExpressionAnnotation (path: NodePath): TypeAnnotation {
    if (path.node.computed) {
      return getComputedMemberExpressionAnnotation(path);
    }
    const object = path.get('object');
    const {node: id} = path.get('property');
    const {name} = id;
    let annotation = getAnnotation(object);
    if (annotation.type === 'NullableTypeAnnotation') {
      annotation = annotation.typeAnnotation;
    }
    if (annotation.type === 'GenericTypeAnnotation') {
      const target = path.scope.getBinding(annotation.id.name);
      if (target) {
        annotation = getAnnotation(target.path);
      }
    }
    switch (annotation.type) {
      case 'ObjectTypeAnnotation':
        for (let {key, value} of annotation.properties) {
          if (key.name === id.name) {
            return value;
          }
        }
        break;
    }
    return path.getTypeAnnotation();
  }

  function getComputedMemberExpressionAnnotation (path: NodePath): TypeAnnotation {
    const object = path.get('object');
    const property = path.get('property');
    let objectAnnotation = getAnnotation(object);
    if (objectAnnotation.type === 'TypeAnnotation' || objectAnnotation.type === 'NullableTypeAnnotation') {
      objectAnnotation = objectAnnotation.typeAnnotation;
    }
    let propertyAnnotation = getAnnotation(property);
    if (propertyAnnotation.type === 'TypeAnnotation' || propertyAnnotation.type === 'NullableTypeAnnotation') {
      propertyAnnotation = propertyAnnotation.typeAnnotation;
    }
    const {confident, value} = property.evaluate();
    if (!confident) {
      return path.getTypeAnnotation();
    }
    switch (objectAnnotation.type) {
      case 'TupleTypeAnnotation':
        if (objectAnnotation.types.length === 0) {
          break;
        }
        else if (typeof value === 'number') {
          if (!objectAnnotation.types[value]) {
            throw new SyntaxError(`Invalid computed member expression for tuple: ` + humanReadableType(objectAnnotation, path.scope))
          }
          return objectAnnotation.types[value];
        }
        else {
          throw new SyntaxError(`Invalid computed member expression for tuple: ` + humanReadableType(objectAnnotation, path.scope));
        }
        break;
    }
    return path.getTypeAnnotation();
  }

  function getFunctionForIdentifier (path: NodePath): boolean|Node {
    if (path.type !== 'Identifier') {
      return false;
    }
    const ref = path.scope.getBinding(path.node.name);
    if (!ref) {
      return false;
    }
    return t.isFunction(ref.path.parent) && ref.path.parentPath;
  }

  /**
   * Returns `true` if the annotation is definitely for an array,
   * otherwise `false`.
   */
  function isStrictlyArrayAnnotation (annotation: TypeAnnotation): boolean {
    switch (annotation.type) {
      case 'TypeAnnotation':
        return isStrictlyArrayAnnotation(annotation.typeAnnotation);
      case 'GenericTypeAnnotation':
        return annotation.id.name === 'Array';
      case 'UnionTypeAnnotation':
        return annotation.types.every(isStrictlyArrayAnnotation);
      default:
        return false;
    }
  }

  /**
   * Returns `true` if the annotation is compatible with a number,
   * `false` if it definitely isn't, or `null` if we're not sure.
   */
  function maybeNumberAnnotation (annotation: TypeAnnotation): ?boolean {
    switch (annotation.type) {
      case 'TypeAnnotation':
      case 'NullableTypeAnnotation':
        return maybeNumberAnnotation(annotation.typeAnnotation);
      case 'NumberTypeAnnotation':
      case 'NumericLiteralTypeAnnotation':
        return true;
      case 'GenericTypeAnnotation':
        switch (annotation.id.name) {
          case 'Array':
          case 'Function':
          case 'Object':
          case 'String':
          case 'Boolean':
          case 'Date':
          case 'RegExp':
            return false;
          default:
            return null;
        }
      case 'UnionTypeAnnotation':
        let falseCount = 0;
        for (let type of annotation.types) {
          const result = maybeNumberAnnotation(type);
          if (result === true) {
            return true;
          }
          else if (result === false) {
            falseCount++;
          }
        }
        if (falseCount === annotation.types.length) {
          return false;
        }
        else {
          return null;
        }
      case 'AnyTypeAnnotation':
      case 'MixedTypeAnnotation':
        return null;
      default:
        return false;
    }
  }

  /**
   * Returns `true` if the annotation is compatible with a string,
   * `false` if it definitely isn't, or `null` if we're not sure.
   */
  function maybeStringAnnotation (annotation: TypeAnnotation): ?boolean {
    switch (annotation.type) {
      case 'TypeAnnotation':
      case 'NullableTypeAnnotation':
        return maybeStringAnnotation(annotation.typeAnnotation);
      case 'StringTypeAnnotation':
      case 'StringLiteralTypeAnnotation':
        return true;
      case 'GenericTypeAnnotation':
        switch (annotation.id.name) {
          case 'Array':
          case 'Function':
          case 'Object':
          case 'Number':
          case 'Boolean':
          case 'Date':
          case 'RegExp':
            return false;
          default:
            return null;
        }
      case 'UnionTypeAnnotation':
        let falseCount = 0;
        for (let type of annotation.types) {
          const result = maybeStringAnnotation(type);
          if (result === true) {
            return true;
          }
          else if (result === false) {
            falseCount++;
          }
        }
        if (falseCount === annotation.types.length) {
          return false;
        }
        else {
          return null;
        }
      case 'AnyTypeAnnotation':
      case 'MixedTypeAnnotation':
        return null;
      default:
        return false;
    }
  }


  /**
   * Returns `true` if the annotation is compatible with a boolean,
   * `false` if it definitely isn't, or `null` if we're not sure.
   */
  function maybeBooleanAnnotation (annotation: TypeAnnotation): ?boolean {
    switch (annotation.type) {
      case 'TypeAnnotation':
      case 'NullableTypeAnnotation':
        return maybeBooleanAnnotation(annotation.typeAnnotation);
      case 'BooleanTypeAnnotation':
      case 'BooleanLiteralTypeAnnotation':
        return true;
      case 'GenericTypeAnnotation':
        switch (annotation.id.name) {
          case 'Array':
          case 'Function':
          case 'Object':
          case 'String':
          case 'Number':
          case 'Date':
          case 'RegExp':
            return false;
          default:
            return null;
        }
      case 'UnionTypeAnnotation':
        let falseCount = 0;
        for (let type of annotation.types) {
          const result = maybeBooleanAnnotation(type);
          if (result === true) {
            return true;
          }
          else if (result === false) {
            falseCount++;
          }
        }
        if (falseCount === annotation.types.length) {
          return false;
        }
        else {
          return null;
        }
      case 'AnyTypeAnnotation':
      case 'MixedTypeAnnotation':
        return null;
      default:
        return false;
    }
  }


  /**
   * Returns `true` if the annotation is compatible with a function,
   * `false` if it definitely isn't, or `null` if we're not sure.
   */
  function maybeFunctionAnnotation (annotation: TypeAnnotation): ?boolean {
    switch (annotation.type) {
      case 'TypeAnnotation':
      case 'NullableTypeAnnotation':
        return maybeFunctionAnnotation(annotation.typeAnnotation);
      case 'FunctionTypeAnnotation':
        return true;
      case 'GenericTypeAnnotation':
        switch (annotation.id.name) {
          case 'Array':
          case 'Number':
          case 'Object':
          case 'String':
          case 'Boolean':
          case 'Date':
          case 'RegExp':
            return false;
          default:
            return null;
        }
      case 'UnionTypeAnnotation':
        let falseCount = 0;
        for (let type of annotation.types) {
          const result = maybeFunctionAnnotation(type);
          if (result === true) {
            return true;
          }
          else if (result === false) {
            falseCount++;
          }
        }
        if (falseCount === annotation.types.length) {
          return false;
        }
        else {
          return null;
        }
      case 'AnyTypeAnnotation':
      case 'MixedTypeAnnotation':
        return null;
      default:
        return false;
    }
  }

  /**
   * Returns `true` if the annotation is compatible with an undefined or null type,
   * `false` if it definitely isn't, or `null` if we're not sure.
   */
  function maybeNullableAnnotation (annotation: TypeAnnotation): ?boolean {
    switch (annotation.type) {
      case 'NullableTypeAnnotation':
      case 'VoidTypeAnnotation':
      case 'MixedTypeAnnotation':
        return true;
      case 'TypeAnnotation':
        return maybeNullableAnnotation(annotation.typeAnnotation);
      case 'GenericTypeAnnotation':
        switch (annotation.id.name) {
          case 'Array':
          case 'Number':
          case 'Object':
          case 'String':
          case 'Boolean':
          case 'Date':
          case 'RegExp':
            return false;
          default:
            return null;
        }
      case 'UnionTypeAnnotation':
        let falseCount = 0;
        for (let type of annotation.types) {
          const result = maybeNullableAnnotation(type);
          if (result === true) {
            return true;
          }
          else if (result === false) {
            falseCount++;
          }
        }
        if (falseCount === annotation.types.length) {
          return false;
        }
        else {
          return null;
        }
      default:
        return false;
    }
  }

  /**
   * Returns `true` if the annotation is compatible with an object type,
   * `false` if it definitely isn't, or `null` if we're not sure.
   */
  function maybeInstanceOfAnnotation (annotation: TypeAnnotation, expected: Identifier): ?boolean {
    switch (annotation.type) {
      case 'TypeAnnotation':
      case 'NullableTypeAnnotation':
        return maybeInstanceOfAnnotation(annotation.typeAnnotation);
      case 'GenericTypeAnnotation':
        if (annotation.id.name === expected.name) {
          return true;
        }
        else {
          return null;
        }
      case 'UnionTypeAnnotation':
        let falseCount = 0;
        for (let type of annotation.types) {
          const result = maybeInstanceOfAnnotation(type, expected);
          if (result === true) {
            return true;
          }
          else if (result === false) {
            falseCount++;
          }
        }
        if (falseCount === annotation.types.length) {
          return false;
        }
        else {
          return null;
        }
      case 'VoidTypeAnnotation':
      case 'BooleanTypeAnnotation':
      case 'BooleanLiteralTypeAnnotation':
      case 'StringTypeAnnotation':
      case 'StringLiteralTypeAnnotation':
      case 'NumberTypeAnnotation':
      case 'NumericLiteralTypeAnnotation':
      case 'FunctionTypeAnnotation':
        return false;
      default:
        return null;
    }
  }

  /**
   * Returns `true` if the annotation is compatible with an array,
   * `false` if it definitely isn't, or `null` if we're not sure.
   */
  function maybeArrayAnnotation (annotation: TypeAnnotation): ?boolean {
    switch (annotation.type) {
      case 'TypeAnnotation':
      case 'NullableTypeAnnotation':
        return maybeArrayAnnotation(annotation.typeAnnotation);
      case 'TupleTypeAnnotation':
      case 'ArrayTypeAnnotation':
        return true;
      case 'GenericTypeAnnotation':
        return annotation.id.name === 'Array' ? true : null;
      case 'UnionTypeAnnotation':
        let falseCount = 0;
        for (let type of annotation.types) {
          const result = maybeArrayAnnotation(type);
          if (result === true) {
            return true;
          }
          else if (result === false) {
            falseCount++;
          }
        }
        if (falseCount === annotation.types.length) {
          return false;
        }
        else {
          return null;
        }
      case 'AnyTypeAnnotation':
      case 'MixedTypeAnnotation':
        return null;
      default:
        return false;
    }
  }

  /**
   * Returns `true` if the annotation is compatible with a tuple,
   * `false` if it definitely isn't, or `null` if we're not sure.
   */
  function maybeTupleAnnotation (annotation: TypeAnnotation): ?boolean {
    switch (annotation.type) {
      case 'TypeAnnotation':
      case 'NullableTypeAnnotation':
        return maybeTupleAnnotation(annotation.typeAnnotation);
      case 'TupleTypeAnnotation':
        return true;
      case 'UnionTypeAnnotation':
        let falseCount = 0;
        for (let type of annotation.types) {
          const result = maybeTupleAnnotation(type);
          if (result === true) {
            return true;
          }
          else if (result === false) {
            falseCount++;
          }
        }
        if (falseCount === annotation.types.length) {
          return false;
        }
        else {
          return null;
        }
      case 'GenericTypeAnnotation':
      case 'AnyTypeAnnotation':
      case 'ArrayTypeAnnotation':
      case 'MixedTypeAnnotation':
        return null;
      default:
        return false;
    }
  }

  function humanReadableType (annotation: TypeAnnotation, scope: Scope): string {
    switch (annotation.type) {
      case 'TypeAnnotation':
        return humanReadableType(annotation.typeAnnotation, scope);
      case 'GenericTypeAnnotation':
        if (annotation.id.name === 'Array') {
          return humanReadableArray(annotation, scope);
        }
        else if (annotation.id.name === 'Function') {
          return `a function`;
        }
        else if (isTypeChecker(annotation.id, scope)) {
          return `${annotation.id.name} shaped object`;
        }
        else {
          return `an instance of ${getTypeName(annotation.id)}`;
        }
      case 'TupleTypeAnnotation':
        return humanReadableTuple(annotation, scope);
      case 'NumberTypeAnnotation':
      case 'NumericLiteralTypeAnnotation':
        return "a number";
      case 'BooleanTypeAnnotation':
      case 'BooleanLiteralTypeAnnotation':
        return "a boolean";
      case 'StringTypeAnnotation':
      case 'StringLiteralTypeAnnotation':
        return "a string";
      case 'UnionTypeAnnotation':
        return joinSentence(annotation.types.map(type => humanReadableType(type, scope)), [', ', 'or']);
      case 'ObjectTypeAnnotation':
        return humanReadableObject(annotation, scope);
      case 'ArrayTypeAnnotation':
        return generate(annotation).code;
      case 'FunctionTypeAnnotation':
        return 'a function';
      case 'MixedTypeAnnotation':
        return "a mixed value";
      case 'AnyTypeAnnotation':
        return "any value";
      case 'NullableTypeAnnotation':
        return `optional ${humanReadableType(annotation.typeAnnotation, scope)}`;
      case 'VoidTypeAnnotation':
        return `void`;
      default:
        throw new Error('Unknown type: ' + annotation.type);
    }
  }

  function humanReadableObject (annotation: TypeAnnotation, scope: Scope): string {
    if (annotation.properties.length === 0) {
      return `an object`;
    }
    else {
      const shape = generate(annotation).code;
      return `an object with shape ${shape}`;
    }
  }

  function humanReadableArray (annotation: TypeAnnotation, scope: Scope): string {
    return generate(annotation).code;
  }

  function humanReadableTuple (annotation: TypeAnnotation, scope: Scope): string {
    return generate(annotation).code;
  }

  function isTypeChecker (id: Identifier|QualifiedTypeIdentifier, scope: Scope): boolean {
    const binding = scope.getBinding(id.name);
    if (binding === undefined) {
      return false;
    }
    const {path} = binding;
    return path != null && (path.type === 'TypeAlias' || path.type === 'ImportSpecifier' || (path.type === 'VariableDeclaration' && path.node.isTypeChecker));
  }

  function isPolymorphicType (id: Identifier|QualifiedTypeIdentifier, scope: Scope): boolean {
    const binding = scope.getBinding(id.name);
    if (binding !== undefined) {
      return false;
    }
    let {path} = scope;
    while (path && path.type !== 'Program') {
      const {node} = path;
      if (t.isFunction(node) && node.typeParameters) {
        for (let param of node.typeParameters.params) {
          param.isPolymorphicType = true;
          if (param.name === id.name) {
            return true;
          }
        }
      }
      path = path.parent;
    }
    return false;
  }

  function getPolymorphicType (id: Identifier|QualifiedTypeIdentifier, scope: Scope): ?Node {
    const binding = scope.getBinding(id.name);
    if (binding !== undefined) {
      return false;
    }
    let {path} = scope;
    while (path && path.type !== 'Program') {
      const {node} = path;
      if (t.isFunction(node) && node.typeParameters) {
        for (let param of node.typeParameters.params) {
          param.isPolymorphicType = true;
          if (param.name === id.name) {
            return param;
          }
        }
      }
      path = path.parent;
    }
    return null;
  }

  function collectParamChecks (path: NodePath): Array<Node> {
    return path.get('params').map((param) => {
      const {node} = param;
      if (node.type === 'AssignmentPattern') {
        if (node.left.typeAnnotation) {
          return createDefaultParamGuard(param);
        }
      }
      else if (node.type === 'RestElement') {
        if (node.typeAnnotation) {
          return createRestParamGuard(param);
        }
      }
      else if (node.typeAnnotation) {
        return createParamGuard(param);
      }
    }).filter(identity);
  }

  function createParamGuard (path: NodePath): ?Node {
    const {node, scope} = path;

    node.hasBeenTypeChecked = true;
    node.savedTypeAnnotation = node.typeAnnotation;
    let check = checkAnnotation(node, node.typeAnnotation, scope);
    if (!check) {
      return;
    }
    if (node.optional) {
      check = t.logicalExpression(
        '||',
        checks.undefined({input: node}).expression,
        check
      );
    }
    const message = paramTypeErrorMessage(node, scope);
    return guard({
      check,
      message
    });
  }

  /**
   * Get any constant violations before a given node.
   * @fixme this is a copy of the internal babel api and relies on a private method.
   */
  function getConstantViolationsBefore (binding, path, functions) {
    const violations = binding.constantViolations.slice();
    violations.unshift(binding.path);
    return violations.filter(violation => {
      violation = violation.resolve();
      const status = violation._guessExecutionStatusRelativeTo(path);
      if (functions && status === "function") {
        functions.push(violation);
      }
      return status === "before";
    });
  }

  function createDefaultParamGuard (path: NodePath): ?Node {
    const {node, scope} = path;
    const {left: id, right: value} = node;
    const ok = staticCheckAnnotation(path.get('right'), id.typeAnnotation);
    if (ok === false) {
      throw new SyntaxError(`Invalid default value for argument "${id.name}", expected ${humanReadableType(id.typeAnnotation, scope)}.`);
    }
    return createParamGuard(path.get('left'));
  }

  function createRestParamGuard (path: NodePath): ?Node {
    const {node, scope} = path;
    const {argument: id} = node;
    id.hasBeenTypeChecked = true;
    node.savedTypeAnnotation = node.typeAnnotation;
    if (!isStrictlyArrayAnnotation(node.typeAnnotation)) {
      throw new SyntaxError(`Invalid type annotation for rest argument "${id.name}", expected an Array, got: ${humanReadableType(node.typeAnnotation, scope)}.`);
    }
    let check = checkAnnotation(id, node.typeAnnotation, scope);
    if (!check) {
      return;
    }
    if (node.optional) {
      check = t.logicalExpression(
        '||',
        checks.undefined({input: id}).expression,
        check
      );
    }
    const message = paramTypeErrorMessage(id, scope, node.typeAnnotation);
    return guard({
      check,
      message
    });
  }

  function returnTypeErrorMessage (path: NodePath, fn: Node, id: ?Identifier): Node {
    const {node, scope} = path;
    const name = fn.id ? fn.id.name : '';
    const message = `Function ${name ? `"${name}" ` : ''}return value violates contract, expected ${humanReadableType(fn.returnType, scope)} got `;

    return t.binaryExpression(
      '+',
      t.stringLiteral(message),
      node.argument ? readableName({input: id || node.argument}).expression : t.stringLiteral('undefined')
    );
  }

  function paramTypeErrorMessage (node: Node, scope: Scope, typeAnnotation: TypeAnnotation = node.typeAnnotation): Node {
    const name = node.name;
    const message = `Value of ${node.optional ? 'optional ' : ''}argument "${name}" violates contract, expected ${humanReadableType(typeAnnotation, scope)} got `;

    return t.binaryExpression(
      '+',
      t.stringLiteral(message),
      readableName({input: node}).expression
    );
  }

  function varTypeErrorMessage (node: Node, scope: Scope, annotation?: TypeAnnotation): Node {
    const name = node.name;
    const message = `Value of variable "${name}" violates contract, expected ${humanReadableType(annotation || node.typeAnnotation, scope)} got `;
    return t.binaryExpression(
      '+',
      t.stringLiteral(message),
      readableName({input: node}).expression
    );
  }

  /**
   * Determine whether the given node can produce purely boolean results.
   */
  function isBooleanExpression (node: Node) {
    if (node.type === 'BinaryExpression' && BOOLEAN_BINARY_OPERATORS.indexOf(node.operator) > -1) {
      return true;
    }
    else if (node.type === 'LogicalExpression') {
      return isBooleanExpression(node.left) && isBooleanExpression(node.right);
    }
    else {
      return false;
    }
  }

  /**
   * Convert type specifier to expression.
   */
  function createTypeExpression (node: Node) : Object {
    if (node.type == 'Identifier') {
      return node;
    }
    else if (node.type == 'QualifiedTypeIdentifier') {
      return t.memberExpression(
        createTypeExpression(node.qualification),
        createTypeExpression(node.id)
      );
    }

    throw this.errorWithNode(`Unsupported type: ${node.type}`);
  }

  /**
   * Get name of a type as a string.
   */
  function getTypeName (node: Node): string {
    if(node.type == 'Identifier') {
      return node.name
    }
    else if(node.type == 'QualifiedTypeIdentifier') {
      return getTypeName(node.qualification) + '.' + getTypeName(node.id);
    }

    throw this.errorWithNode(`Unsupported type: ${node.type}`);
  }

  /**
   * Naturally join a list of terms in a sentence.
   */
  function joinSentence (terms: Array<string>, joiners: Array<string, string> = [', ', 'and']): string {
    if (terms.length === 0) {
      return '';
    }
    else if (terms.length === 1) {
      return terms[0];
    }
    else if (terms.length === 2) {
      return `${terms[0]} ${joiners[1]} ${terms[1]}`;
    }
    else {
      const last = terms.pop();
      return `${terms.join(joiners[0])} ${joiners[1]} ${last}`;
    }
  }


  /**
   * Union two arrays.
   */
  function union (arr1: Array, arr2: Array): Array {
    for (let i = 0; i < arr2.length; i++) {
      let item = arr2[i];
      if (arr1.indexOf(item) === -1) {
        arr1.push(item);
      }
    }
    return arr1;
  }

  /**
   * Determine whether the given annotation allows any value.
   */
  function allowsAny (annotation: TypeAnnotation): boolean {
    if (annotation.type === 'TypeAnnotation' || annotation.type === 'NullableTypeAnnotation') {
      return allowsAny(annotation.typeAnnotation);
    }
    else if (annotation.type === 'AnyTypeAnnotation' || annotation.type === 'MixedTypeAnnotation') {
      return true;
    }
    else if (annotation.type === 'UnionTypeAnnotation') {
      return annotation.types.some(allowsAny);
    }
    else {
      return false;
    }
  }

  /**
   * Determine whether a given node is nully (null or undefined).
   */
  function isNodeNully (node: ?Node): boolean {
    if (node == null) {
      return true;
    }
    else if (node.type === 'Identifier' && node.name === 'undefined') {
      return true;
    }
    else if (node.type === 'Literal' && node.value === null) {
      return true;
    }
    else if (node.type === 'UnaryExpression' && node.operator === 'void') {
      return true;
    }
    else {
      return false;
    }
  }


  /**
   * A function that returns its first argument, useful when filtering.
   */
  function identity <T> (input: T): T {
    return input;
  }
}
