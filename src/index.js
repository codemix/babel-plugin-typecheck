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
  const BOOLEAN_BINARY_OPERATORS = [
    '==',
    '===',
    '>=',
    '<=',
    '>',
    '<',
    'instanceof'
  ];

  const checks = createChecks();

  const checkIsArray = template(`Array.isArray(input)`);
  const checkIsObject = template(`input != null && typeof input === 'object'`);
  const checkNotNull = template(`input != null`);

  const declareTypeChecker = template(`
    let id = function id (input) {
      return check;
    };
  `);

  const guard = template(`
    if (!check) {
      throw new TypeError(message);
    }
  `);

  const thrower = template(`
    if (check) {
      ret;
    }
    else {
      throw new TypeError(message);
    }
  `);

  const stack = [];

  return {
    visitor: {
      TypeAlias (path: Object) {
        path.replaceWith(createTypeAliasChecks(path));
      },

      Function: {
        enter (path: Object) {
          const {node, scope} = path;
          const paramChecks = collectParamChecks(path);
          if (node.type === "ArrowFunctionExpression" && node.expression) {
            node.expression = false;
            node.body = t.blockStatement(t.returnStatement(node.body));
          }
          node.body.body.unshift(...paramChecks);
          stack.push({node, returns: 0});
        },
        exit () {
          const {node, returns} = stack.pop();
          console.log({returns});
        }
      },

      ReturnStatement (path: Object) {
        const {node, parent, scope} = path;
        const {node: {returnType}} = stack[stack.length - 1];
        if (!returnType || node.isTypeChecked) {
          return;
        }
        stack[stack.length - 1].returns++;
        let id;
        if (node.argument.type === 'Identifier') {
          id = node.argument;
        }
        else {
          id = scope.generateUidIdentifierBasedOnNode(node.argument);
          scope.push({id: id});
          path.insertBefore(t.assignmentExpression(
            '=',
            id,
            node.argument
          ));
        }
        const check = checkAnnotation(id, returnType, scope);
        const ret = t.returnStatement(id);
        ret.isTypeChecked = true;
        if (check) {
          path.replaceWith(thrower({
            check,
            ret,
            message: t.stringLiteral("Return value violates contract.")
          }));
        }
        else {
          path.replaceWith(ret);
        }
        //const check = checkAnnotation(returnType, )
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
      any: template(`input != null`),
      union: checkUnion,
      array: checkArray,
      object: checkObject
    };
  }

  function checkUnion ({input, types, scope}): ?Object {
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

  function checkArray ({input, types, scope}): Object {
    if (types.length === 0) {
      return checkIsArray(input).expression;
    }
    else if (types.length === 1) {
      const item = t.identifier('item');
      const type = types[0];
      const check = checkAnnotation(item, type, scope);
      if (!check) {
        return checkIsArray(input).expression;
      }
      return t.logicalExpression(
        '&&',
        checkIsArray(input).expression,
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
            t.numberLiteral(index),
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
        t.numberLiteral(types.length)
      );

      return checks.reduce((last, check, index) => {
        return t.logicalExpression(
          "&&",
          last,
          check
        );
      }, t.logicalExpression(
        '&&',
        checkIsArray(input).expression,
        checkLength
      ));
    }
  }

  function checkObject ({input, properties, scope}): Object {
    return properties.reduce((expr, prop, index) => {
      const check = checkAnnotation(t.memberExpression(input, prop.key), prop.value, scope);
      if (check) {
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

  function createTypeAliasChecks (path: Object) {
    const {node, scope} = path;
    const {id, right: annotation} = node;
    const input = t.identifier('input');
    const check = checkAnnotation(input, annotation, scope) || t.booleanLiteral(true);
    const declaration = declareTypeChecker({id, check});
    declaration.isTypeChecker = true;
    return declaration;
  }

  function checkAnnotation (input: Object, annotation: Object, scope: Object): Object {
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
        else if (isGenericType(annotation.id, scope)) {
          return;
        }
        else {
          return checks.instanceof({input, type: annotation.id}).expression;
        }
      case 'NumberTypeAnnotation':
      case 'NumberLiteralTypeAnnotation':
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
      case 'MixedTypeAnnotation':
        return checks.mixed({input});
      case 'AnyTypeAnnotation':
        return checks.any({input}).expression;
      default:
        throw new Error('Unknown type: ' + annotation.type);
    }
  }

  function isTypeChecker (id: Object, scope: Object): Boolean {
    const binding = scope.getBinding(id.name);
    if (binding === undefined) {
      return false;
    }
    const {path} = binding;
    return path != null && path.type === 'VariableDeclaration' && path.node.isTypeChecker;
  }

  function isGenericType (id: Object, scope: Object): Boolean {
    const binding = scope.getBinding(id.name);
    if (binding !== undefined) {
      return false;
    }
    let {path} = scope;
    while (path && path.type !== 'Program') {
      const {node} = path;
      if (t.isFunction(node) && node.typeParameters) {
        for (let param of node.typeParameters.params) {
          if (param.name === id.name) {
            return true;
          }
        }
      }
      path = path.parent;
    }
    return false;
  }

  function collectParamChecks ({node, scope}): Array {
    return node.params.map(param => {
      if (!param.typeAnnotation) {
        return;
      }
      return createParamGuard(param, scope);
    }).filter(identity);
  }

  function createParamGuard (node: Object, scope: Object): ?Object {
    const check = checkAnnotation(node, node.typeAnnotation, scope);
    if (!check) {
      return;
    }
    const message = t.stringLiteral(
      `Argument "${node.name}" violates contract.`
    );
    return guard({
      check,
      message
    });
  }

  /**
   * Determine whether the given node can produce purely boolean results.
   */
  function isBooleanExpression (node: Object) {
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
   * Determine whether a given node is nully (null or undefined).
   */
  function isNodeNully (node: ?Object): boolean {
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
  function identity (input: any): any {
    return input;
  }
}