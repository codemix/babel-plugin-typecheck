/**
 * # Typecheck Transformer
 */
export default function build (babel: Object): Object {
  const {Transformer, types: t, traverse} = babel;

  // constants used when statically verifying types
  const TYPE_INVALID = 0;
  const TYPE_VALID = 1;
  const TYPE_UNKNOWN = 2;

  // the functions which will visit the AST nodes.
  const visitors = {
    enter: enterNode,
    exit: exitNode
  };

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

  return new Transformer("typecheck", {
    Program (node: Object, parent: Object, scope: Object) {
      this.traverse(visitors, {
        constants: scope.getAllBindingsOfKind("const"),
        subject: node,
        genericTypes: [],
        returnCount: 0
      });
    },
    Function (node: Object, parent: Object, scope: Object) {
      const genericTypes = [];
      if (node.typeParameters != null && node.typeParameters.type === 'TypeParameterDeclaration') {
        genericTypes.push(...node.typeParameters.params.map(param => param.name));
      }
      const argumentGuards = createArgumentGuards(node, genericTypes);
      const returnTypes = extractReturnTypes(node);

      if (argumentGuards.length > 0 || returnTypes.length > 0) {
        if (node.type === "ArrowFunctionExpression" && node.expression) {
          node.expression = false;
          node.body = t.blockStatement(t.returnStatement(node.body));
        }
        const state = {
          constants: scope.getAllBindingsOfKind("const"),
          subject: node,
          argumentGuards: argumentGuards,
          returnTypes: returnTypes,
          genericTypes: genericTypes,
          returnCount: 0
        };
        this.traverse(visitors, state);

        if (state.returnCount === 0 && returnTypes.length > 0 && !~returnTypes.indexOf('null')) {
          throw this.errorWithNode(`Function does not return a value.`);
        }
      }
      else {
        this.traverse(visitors, {
          constants: scope.getAllBindingsOfKind("const"),
          subject: node,
          genericTypes: genericTypes,
          returnCount: 0
        });
      }
    }
  });


  /**
   * Extract the possible types from the given type annotation.
   */
  function extractAnnotationTypes (annotation: Object): Array<Object|string> {
    switch (annotation.type) {
      case "TypeAnnotation":
        return extractAnnotationTypes(annotation.typeAnnotation);
      case "UnionTypeAnnotation":
        return annotation.types.reduce((types, type) => union(types, extractAnnotationTypes(type)), []);
      case "NullableTypeAnnotation":
        return union(["null"], extractAnnotationTypes(annotation.typeAnnotation));
      case "MixedTypeAnnotation":
        return ["mixed"];
      case "GenericTypeAnnotation":
        if(annotation.id.type == 'Identifier') {
          if (annotation.id.name === 'any') {
            return ["any"];
          }
          else if (annotation.id.name === 'Function') {
            return ["function"];
          }
          else if (annotation.id.name === 'Object') {
            return ["object"];
          }
          else if (annotation.id.name === 'Array') {
            return ["array"];
          }
        }
        return [annotation.id];
      case "ObjectTypeAnnotation":
        if (annotation.properties.length > 0) {
          return [annotation];
        }
        else {
          return ["object"];
        }
      case "StringTypeAnnotation":
        return ["string"];
      case "BooleanTypeAnnotation":
        return ["boolean"];
      case "NumberTypeAnnotation":
        return ["number"];
      case "VoidTypeAnnotation":
        return ["undefined"];
      case "AnyTypeAnnotation":
        return ["any"];
      case "FunctionTypeAnnotation":
        return ["function"];
      default:
        throw new SyntaxError(`Unsupported annotation type: ${annotation.type}`);
    }
  }


  /**
   * Create guards for the typed arguments of the function.
   */
  function createArgumentGuards (node: Object, genericTypes: Array = []): Array<Object> {
    return node.params.reduce(
      (guards, param) => {
        if (param.type === "AssignmentPattern" && param.left.typeAnnotation) {
          guards.push(createDefaultArgumentGuard(param, extractAnnotationTypes(param.left.typeAnnotation), genericTypes));
        }
        else if (param.type === "RestElement" && param.typeAnnotation) {
          const types = extractAnnotationTypes(param.typeAnnotation);
          if (!types.includes("array") || types.some(t => t !== "array"))
            throw new SyntaxError(`Annotation for rest argument '...${param.argument.name}' must be an array type`);
        }
        else if (param.typeAnnotation) {
          guards.push(createArgumentGuard(param, extractAnnotationTypes(param.typeAnnotation), genericTypes));
        }
        return guards;
      },
      []
    )
    .filter(identity); // remove blank nodes
  }


  /**
   * Create a guard for an individual argument.
   */
  function createArgumentGuard (param: Object, types: Array<Object|string>, genericTypes: Array = []): ?Object {
    if (types.indexOf('any') > -1 || types.indexOf('mixed') > -1) {
      return null;
    }
    if (param.optional) {
      types = types.concat("undefined");
    }
    const test = createIfTest(param, types, genericTypes);
    if (!test) {
      return null;
    }
    return t.ifStatement(
      test,
      t.throwStatement(
        t.newExpression(
          t.identifier("TypeError"),
          [t.binaryExpression("+",
            t.literal(`Value of ${param.optional ? 'optional argument' : 'argument'} '${param.name}' violates contract, expected ${createTypeNameList(types)} got `),
            createReadableTypeName(param)
          )]
        )
      )
    );
  }


  /**
   * Create a guard for a default paramter.
   */
  function createDefaultArgumentGuard (param: Object, types: Array<Object|string>, genericTypes: Array = []): Object {
    const validated = staticallyVerifyDefaultArgumentType(param, types);
    if (validated === TYPE_INVALID) {
      throw new SyntaxError(`Default value for argument '${param.left.name}' violates contract, expected ${createTypeNameList(types)}`);
    }
    return createArgumentGuard(param.left, types, genericTypes);
  }


  /**
   * Create guards for a variable declaration statement.
   */
  function createVariableGuards (node : Object, genericTypes: Array = []) : Array<Object> {
    let guards = []
    node.declarations.forEach(declaration => {
      if (declaration.id.typeAnnotation) {
        guards.push(createVariableGuard(declaration.id, extractAnnotationTypes(declaration.id.typeAnnotation), genericTypes));
      }
    })
    return guards.filter(identity);
  }


  /**
   * Create a guard for a variable identifier.
   */
  function createVariableGuard (id: Object, types: Array<Object|string>, genericTypes: Array = []) {
    if (types.indexOf('any') > -1 || types.indexOf('mixed') > -1) {
      return null;
    }
    const test = createIfTest(id, types, genericTypes);
    if (!test) {
      return null;
    }
    return t.ifStatement(
      test,
      t.throwStatement(
        t.newExpression(
          t.identifier("TypeError"),
          [t.binaryExpression("+",
            t.literal(`Value of variable '${id.name}' violates contract, expected ${createTypeNameList(types)} got `),
            createReadableTypeName(id)
          )]
        )
      )
    );
  }


  /**
   * Create a logical expression that checks that the subject node
   * has one of the given types.
   */
  function createIfTest (subject, types, genericTypes: Array = []) {
    return types.reduce((last, type, index) => {
      const test = createTypeTest(subject, type, genericTypes);
      if (!test) {
        if (last && types[index - 1] === "null") {
          return null;
        }
        return last;
      }
      if (last === null) {
        return test;
      }
      return t.logicalExpression(
        "&&",
        last,
        test
      );
    }, null);
  }

  /**
   * Turn a list of types into an english sentence.
   */
  function createTypeNameList (types: Array<string|Object>, separator: string = "or"): string {
    return joinSentence(types.reduce((names, type) => {
      if (typeof type === 'object') {
        if (type.type === 'ObjectTypeProperty') {
          return [type.key.name];
        }
        else if (type.type === 'ObjectTypeAnnotation') {
          if (type.properties.length > 1) {
            names.push(`Object with properties ${joinSentence(type.properties.map(item => item.key.name), 'and')}`)
          }
          else if (type.properties.length === 1) {
            names.push(`Object with a ${type.properties[0].key.name} property`);
          }
          else {
            names.push('Object with no properties');
          }
        }
        else {
          names.push(getTypeName(type));
        }
      }
      else {
        names.push(type);
      }
      return names;
    }, []), separator);
  }

  /**
   * Get name of a type as a string.
   */
  function getTypeName (node): string {
    if(node.type == 'Identifier') {
      return node.name
    }
    else if(node.type == 'QualifiedTypeIdentifier') {
      return getTypeName(node.qualification) + '.' + getTypeName(node.id);
    }

    throw this.errorWithNode(`Unsupported type: ${node.type}`);
  }

  /**
   * Join a list of terms as an English sentence.
   */
  function joinSentence (terms: Array<string>, separator: string = "or"): string {
    if (terms.length < 2) {
      return terms[0] || 'any';
    }
    else {
      const last = terms.pop();
      return `${terms.join(', ')} ${separator} ${last}`;
    }
  }

  /**
   * Creates an expression which can return a readable type name for an identifier.
   */
  function createReadableTypeName (identifier: Object): Object {
    return t.conditionalExpression(
      t.binaryExpression(
        "===",
        identifier,
        t.literal(null)
      ),
      t.literal("null"),
      t.conditionalExpression(
        t.logicalExpression(
          "&&",
          t.binaryExpression(
            "instanceof",
            identifier,
            t.identifier("Object")
          ),
          t.memberExpression(
            identifier,
            t.identifier("constructor")
          )
        ),
        t.memberExpression(
          t.memberExpression(identifier, t.identifier("constructor")),
          t.identifier("name")
        ),
        t.unaryExpression("typeof", identifier)
      )
    );
  }

  /**
   * Create an expression that can validate that the given
   * subject node has the given type.
   */
  function createTypeTest (subject:Object, type: Object|string, genericTypes: Array = []): ?Object {
    if (type === "null") {
      return t.binaryExpression(
        "!=",
        subject,
        t.literal(null)
      );
    }
    else if (type === "array") {
      return t.unaryExpression(
        "!",
        t.callExpression(
          t.memberExpression(
            t.identifier("Array"),
            t.identifier("isArray")
          ),
          [subject]
        )
      );
    }
    else if (type === "object") {
      return t.logicalExpression(
        "||",
        t.binaryExpression(
          "===",
          subject,
          t.literal(null)
        ),
        t.binaryExpression(
          "!==",
          t.unaryExpression(
            "typeof",
            subject,
            true
          ),
          t.literal("object")
        )
      );
    }
    else if (typeof type === 'string') {
      return t.binaryExpression(
        "!==",
        t.unaryExpression(
          "typeof",
          subject,
          true
        ),
        t.literal(type)
      );
    }
    else if (type.type === 'ObjectTypeAnnotation') {
      return t.logicalExpression(
        "||",
        t.logicalExpression(
          "||",
          t.binaryExpression(
            "===",
            subject,
            t.literal(null)
          ),
          t.binaryExpression(
            "!==",
            t.unaryExpression('typeof', subject),
            t.literal('object')
          )
        ),
        type.properties.reduce((expr, prop) => {
          const key = prop.key;
          const valueTypes = extractAnnotationTypes(prop.value);
          if (prop.optional)
            valueTypes.push("undefined");
          const test = createIfTest(t.memberExpression(subject, key), valueTypes, genericTypes);
          if (!test) {
            return expr;
          }
          if (expr === null) {
            return test;
          }
          else {
            return t.logicalExpression(
              "||",
              expr,
              test
            );
          }
          expr = t.literal(true);
          return expr;
        }, null)
      );
    }
    else if (type.type === 'Identifier' && ~genericTypes.indexOf(type.name)) {
      return null;
    }
    else {
      return t.unaryExpression(
        "!",
        t.binaryExpression(
          "instanceof",
          subject,
          createTypeExpression(type)
        )
      );
    }
  }

  /**
   * Convert type specifier to expression.
   */
  function createTypeExpression (node: Object) : Object {
    if(node.type == 'Identifier') {
      return node;
    }
    else if(node.type == 'QualifiedTypeIdentifier') {
      return t.memberExpression(
        createTypeExpression(node.qualification),
        createTypeExpression(node.id)
      );
    }

    throw this.errorWithNode(`Unsupported type: ${node.type}`);
  }

  /**
   * Extract a list of permissible return types for the function.
   */
  function extractReturnTypes (node: Object): Array<Object|string> {
    if (node.returnType) {
      const types = extractAnnotationTypes(node.returnType);
      if (types.indexOf('any') === -1 && types.indexOf('mixed') === -1) {
        return types;
      }
    }
    return [];
  }


  /**
   * Create a runtime type guard for a return statement.
   */
  function createReturnTypeGuard (ref: Object, node: Object, scope: Object, state: Object): ?Object {
    const test = createIfTest(ref, state.returnTypes, state.genericTypes);
    if (!test) {
      return null;
    }
    return t.ifStatement(
      test,
      t.throwStatement(
        t.newExpression(
          t.identifier("TypeError"),
          [t.binaryExpression("+",
            t.literal(`Function ${state.subject.id ? `'${state.subject.id.name}' ` : ''}return value violates contract, expected ${createTypeNameList(state.returnTypes)} got `),
            createReadableTypeName(ref)
          )]
        )
      )
    );
  }


  /**
   * Attempt to statically verify that the default value of an argument matches the annotated type.
   */
  function staticallyVerifyDefaultArgumentType (node: Object, types: Array<Object|string>): number|Object {
    return staticallyVerifyType(node.right, types);
  }


  /**
   * Attempt to statically verify the return type of a node.
   */
  function staticallyVerifyReturnType (node: Object, types: Array<Object|string>): number|Object {
    return staticallyVerifyType(node.argument, types);
  }


  /**
   * Statically verify that the given node is one of the given types.
   */
  function staticallyVerifyType (node: Object, types: Array<Object|string>): number|Object {
    if (isNodeNully(node)) {
      return (types.indexOf("null") > -1 || types.indexOf("undefined") > -1)
             ? TYPE_VALID
             : TYPE_INVALID;
    }
    else if (node.type === "Literal") {
      if (node.regex) {
        return (types.indexOf("object") > -1 || types.some(identifierMatcher("RegExp")))
               ? TYPE_VALID
               : TYPE_INVALID;
      }
      else {
        return types.indexOf(typeof node.value) > -1
               ? TYPE_VALID
               : TYPE_INVALID;
      }
    }
    else if (node.type === "ObjectExpression") {
      return types.indexOf("object") > -1 || types.indexOf("shape") > -1
             ? TYPE_VALID
             : TYPE_INVALID;
    }
    else if (node.type === "ArrayExpression") {
      return (types.indexOf("array") > -1 || types.indexOf("object") > -1)
             ? TYPE_VALID
             : TYPE_INVALID;
    }
    else if (t.isFunction(node)) {
      return (types.indexOf("function") > -1 || types.indexOf("object") > -1)
             ? TYPE_VALID
             : TYPE_INVALID;
    }
    else if (node.type === 'NewExpression' && node.callee.type === 'Identifier') {
      // this is of the form `return new SomeClass()`
      // @fixme it should be possible to do this with non computed member expressions too
      return (types.indexOf("object") > -1 || types.some(identifierMatcher(node.callee.name)))
             ? TYPE_VALID
             : TYPE_UNKNOWN;
    }
    else if (isBooleanExpression(node)) {
      return types.indexOf('boolean') > -1
             ? TYPE_VALID
             : TYPE_INVALID;
    }
    else if (node.type === 'Identifier') {
      // check the scope to see if this is a `const` value
      return node;
    }
    else {
      return TYPE_UNKNOWN; // will produce a runtime type check
    }
  }


  /**
   * Create a reference to the given node.
   */
  function createReferenceTo (traverser, value, scope) {
    if (value === null) {
      return t.literal(null);
    }
    else if (value === undefined) {
      return t.literal(undefined);
    }
    else if (value.type === "Literal") {
      return value;
    }
    else if (value.type === "Identifier") {
      return value;
    }
    else {
      const id = scope.generateUidIdentifierBasedOnNode(value);
      scope.push({id: id});
      traverser.insertBefore(t.expressionStatement(
        t.assignmentExpression(
          "=",
          id,
          value
        )
      ));
      return id;
    }
  }


  /**
   * Return a predicate that matches identifiers with the given name.
   * > Note: This does *no* scope checking.
   */
  function identifierMatcher (name: string): Function {
    return (node: ?Object) => node && node.type === 'Identifier' && node.name === name;
  }


  /**
   * Invoked when `traverse()` enters a particular AST node.
   */
  function enterNode (node: Object, parent: Object, scope: Object, state: Object) {
    if (t.isFunction(node)) {
      // We don't descend into nested functions because the outer traversal
      // will visit them for us and it keeps things a *lot* simpler.
      return this.skip();
    }
    else {
      if (state.argumentGuards != null && node === state.subject.body) {
        if (node.type === "BlockStatement") {
          // attach the argument guards to the first block statement in the function body
          return t.blockStatement(
            state.argumentGuards.concat(node.body)
          );
        }
        else {
          // the function body must be expanded to a block prior to this
          throw this.errorWithNode("Unexpanded function body");
        }
      }
    }
  }


  /**
   * Invoked when leaving a visited AST node.
   */
  function exitNode (node: Object, parent: Object, scope: Object, state: Object) {
    if (node.type === 'ReturnStatement') {
      state.returnCount++;
      if (state.returnTypes == null || state.returnTypes.length === 0) {
        // we only care about typed return statements.
        return;
      }
      let validated = staticallyVerifyReturnType(node, state.returnTypes);
      if (typeof validated === 'object' && state.constants[validated.name]) {
        // the return value is a constant, let's see if we can infer the type
        const constant = state.constants[validated.name];
        const declarator = constant.path.parent.declarations[constant.path.key];
        validated = staticallyVerifyType(declarator.init, state.returnTypes);
      }

      if (validated === TYPE_INVALID) {
        throw this.errorWithNode(`Function ${state.subject.id ? `'${state.subject.id.name}' ` : ''}return value violates contract, expected ${createTypeNameList(state.returnTypes)}.`);
      }
      else if (validated === TYPE_VALID) {
        // no need to guard, has been statically verified.
        return;
      }
      else {
        if (parent.type !== 'BlockStatement' && parent.type !== "Program") {
          let ref;
          let block = [];
          if (node.argument === null) {
            ref = t.literal(null);
          }
          else if (node.argument === undefined) {
            ref = t.literal(undefined);
          }
          else if (node.argument.type === "Literal") {
            ref = node.argument;
          }
          else if (node.argument.type === "Identifier") {
            ref = node.argument;
          }
          else {
            ref = scope.generateUidIdentifierBasedOnNode(node.argument);
            scope.push({id: ref});
            block.push(t.expressionStatement(
              t.assignmentExpression(
                "=",
                ref,
                node.argument
              )
            ));
          }
          const guard = createReturnTypeGuard(ref, node, scope, state);
          if (!guard) {
            return;
          }
          block.push(guard);
          block.push(t.returnStatement(ref));
          return t.blockStatement(block);
        }
        else {
          const ref = createReferenceTo(this, node.argument, scope);
          const guard = createReturnTypeGuard(ref, node, scope, state);
          if (!guard) {
            return;
          }
          this.insertBefore(guard);
          return t.returnStatement(ref);
        }
      }
    }
    else if (node.type === 'VariableDeclaration') {
      const variableGuards: Array = createVariableGuards(node, state.genericTypes);
      if (variableGuards.length === 0) {
        return;
      }
      if (parent.type === 'BlockStatement' || parent.type == 'Program') {
        this.insertAfter(variableGuards);
      }
      else if (
        parent.type === 'ForStatement' ||
        parent.type === 'ForOfStatement' ||
        parent.type === 'ForInStatement') {
        parent.body = t.blockStatement([].concat(variableGuards, parent.body.body));
      }
      // Can't insert type check here.
    }
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