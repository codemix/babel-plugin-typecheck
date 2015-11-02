import generate from "babel-generator";

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
    const id = (function () {
      function id (input) {
        return check;
      }

      id[Symbol.hasInstance] = id;
      return id;
    })();
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

  const readableName = template(`
    input === null ? 'null' : typeof input === 'object' && input.constructor ? input.constructor.name || '[Unknown Object]' : typeof input
  `);

  const stack = [];

  return {
    visitor: {
      TypeAlias (path: Object) {
        path.replaceWith(createTypeAliasChecks(path));
      },

      ExportNamedDeclaration: {
        enter (path: Object) {
          const {node, scope} = path;
          if (node.declaration.type === 'TypeAlias') {
            path.replaceWith(t.exportNamedDeclaration(
              createTypeAliasChecks({node: node.declaration, scope}),
              [],
              null
            ));
          }
        }
      },

      ImportDeclaration: {
        enter (path: Object) {
          const {node, scope} = path;
          if (node.importKind === 'type') {
            // @fixme
            console.log(node);
          }
          else if (node.importKind === 'typeof') {
            // @fixme
          }
        }
      },

      Function: {
        enter (path: Object) {
          const {node, scope} = path;
          const paramChecks = collectParamChecks(path);
          if (node.type === "ArrowFunctionExpression" && node.expression) {
            node.expression = false;
            node.body = t.blockStatement([t.returnStatement(node.body)]);
          }
          node.body.body.unshift(...paramChecks);
          stack.push({node, returns: 0});
        },
        exit () {
          const {node, returns} = stack.pop();
          console.log({returns});
        }
      },

      ReturnStatement: {
        enter (path: Object) {
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

          let id;
          if (node.argument.type === 'Identifier') {
            id = node.argument;
          }
          else {
            id = scope.generateUidIdentifierBasedOnNode(node.argument);
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
              message: returnTypeErrorMessage(path, fn)
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
              message: returnTypeErrorMessage(path, fn)
            }));
          }
        }
      },

      VariableDeclaration: {
        enter (path: Object) {
          const {node, scope} = path;
          const collected = [];
          for (let declaration of node.declarations) {
            const {id, init} = declaration;
            if (!id.typeAnnotation || id.hasBeenTypeChecked) {
              continue;
            }
            id.hasBeenTypeChecked = true;
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
        }
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
      object: checkObject,
      nullable: checkNullable
    };
  }

  function checkNullable ({input, type, scope}): ?Object {
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
        checkIsArray({input}).expression,
        checkLength
      ));
    }
  }

  function checkObject ({input, properties, scope}): Object {
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
          return checks.instanceof({input, type: createTypeExpression(annotation.id)}).expression;
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
      case 'FunctionTypeAnnotation':
        return checks.function({input, params: annotation.params, returnType: annotation.returnType});
      case 'MixedTypeAnnotation':
        return checks.mixed({input});
      case 'AnyTypeAnnotation':
        return checks.any({input}).expression;
      case 'NullableTypeAnnotation':
        return checks.nullable({input, type: annotation.typeAnnotation, scope}).expression;
      default:
        console.log(annotation);
        throw new Error('Unknown type: ' + annotation.type);
    }
  }

  function humanReadableType (annotation: Object, scope: Object): string {
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
      case 'NumberTypeAnnotation':
      case 'NumberLiteralTypeAnnotation':
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
      case 'FunctionTypeAnnotation':
        return 'a function';
      case 'MixedTypeAnnotation':
        return "a mixed value";
      case 'AnyTypeAnnotation':
        return "any value";
      case 'NullableTypeAnnotation':
        return "an optional";
      default:
        throw new Error('Unknown type: ' + annotation.type);
    }
  }

  function humanReadableObject (annotation: Object, scope: Object): string {
    if (annotation.properties.length === 0) {
      return `an object`;
    }
    else {
      const shape = generate(annotation).code;
      return `an object with shape ${shape}`;
    }
  }

  function humanReadableArray (annotation: Object, scope: Object): string {
    return generate(annotation).code;
  }

  function isTypeChecker (id: Object, scope: Object): Boolean {
    const binding = scope.getBinding(id.name);
    if (binding === undefined) {
      return false;
    }
    const {path} = binding;
    return path != null && (path.type === 'TypeAlias' || (path.type === 'VariableDeclaration' && path.node.isTypeChecker));
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
      if (param.type === 'AssignmentPattern') {
        if (param.left.typeAnnotation) {
          return createDefaultParamGuard(param, scope);
        }
      }
      else if (param.type === 'RestElement') {
        if (param.typeAnnotation) {
          return createRestParamGuard(param, scope);
        }
      }
      else if (param.typeAnnotation) {
        return createParamGuard(param, scope);
      }
    }).filter(identity);
  }

  function createParamGuard (node: Object, scope: Object): ?Object {
    node.hasBeenTypeChecked = true;
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

  function createDefaultParamGuard (node: Object, scope: Object): ?Object {
    const {left: id, right: value} = node;
    return createParamGuard(id, scope);
  }

  function createRestParamGuard (node: Object, scope: Object): ?Object {
    const {argument: id} = node;
    id.hasBeenTypeChecked = true;
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

  function returnTypeErrorMessage (path: Object, fn: Object): Object {
    const {node, scope} = path;
    const name = fn.id ? fn.id.name : '';
    const message = `Function ${name ? `"${name}" ` : ''}return value violates contract, expected ${humanReadableType(fn.returnType, scope)} got `;

    return t.binaryExpression(
      '+',
      t.stringLiteral(message),
      node.argument ? readableName({input: node.argument}).expression : t.stringLiteral('undefined')
    );
  }

  function paramTypeErrorMessage (node: Object, scope: Object, typeAnnotation: Object = node.typeAnnotation): Object {
    const name = node.name;
    const message = `Value of ${node.optional ? 'optional ' : ''}argument "${name}" violates contract, expected ${humanReadableType(typeAnnotation, scope)} got `;

    return t.binaryExpression(
      '+',
      t.stringLiteral(message),
      readableName({input: node}).expression
    );
  }

  function varTypeErrorMessage (node: Object, scope: Object): Object {
    const name = node.name;
    const message = `Value of variable "${name}" violates contract, expected ${humanReadableType(node.typeAnnotation, scope)} got `;

    return t.binaryExpression(
      '+',
      t.stringLiteral(message),
      readableName({input: node}).expression
    );
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
   * Convert type specifier to expression.
   */
  function createTypeExpression (node: Object) : Object {
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
  function getTypeName (node: Object): string {
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