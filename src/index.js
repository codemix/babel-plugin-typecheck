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


  return {
    visitor: {
      TypeAlias (path: Object, file: Object) {
        path.replaceWith(createTypeAliasChecks(path));
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
      object: template(`input != null && typeof input === 'object`),
      undefined: template(`input === undefined`),
      null: template(`input === null`),
      nullOrUndefined: template(`input == null`),
      instanceof: template(`input instanceof type`),
      type: template(`type(input)`),
      union: checkUnion,
      array: checkArray
    };
  }

  function checkUnion ({input, types, scope}): Object {
    const checks = types.map(type => checkAnnotation(input, type, scope));
    return checks.reduce((last, check, index) => {
      if (last === null) {
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
      return t.logicalExpression(
        '&&',
        checkIsArray(input).expression,
        t.callExpression(
          t.memberExpression(input, t.identifier('every')),
          [t.functionExpression(null, [item], t.blockStatement([
            t.returnStatement(checkAnnotation(item, type, scope))
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
      );

      const checkLength = t.binaryExpression(
        '>=',
        t.memberExpression(
          input,
          t.identifier('length')
        ),
        t.numberLiteral(checks.length)
      );

      return checks.reduce((last, check, index) => {
        if (last === null) {
          return check;
        }
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

  function createTypeAliasChecks (path: Object) {
    const {node, scope} = path;

    const checker = template(`
      let id = function id (input) {
        return check;
      };
    `);

    const {id, right: annotation} = node;
    const input = t.identifier('input');
    const check = checkAnnotation(input, annotation, scope);

    const declaration = checker({id, check});
    declaration.isTypeChecker = true;
    return declaration;
  }

  function checkAnnotation (input: Object, annotation: Object, scope: Object): Object {
    switch (annotation.type) {
      case 'GenericTypeAnnotation':
        if (annotation.id.name === 'Array') {
          return checks.array({input, types: annotation.typeParameters ? annotation.typeParameters.params : [], scope});
        }
        else if (isTypeChecker(annotation.id, scope)) {
          return checks.type({input, type: annotation.id}).expression;
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
   * Determing whether a given node is nully (null or undefined).
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