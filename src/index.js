/**
 * # Typecheck Transformer
 */
export default function build (babel: Object): Object {
  const {Transformer, types: t, traverse, Scope} = babel;

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
    Function (node: Object, parent: Object, scope: Scope) {
      try {
        const argumentGuards = createArgumentGuards(node);
        const returnTypes = extractReturnTypes(node);
        if (argumentGuards.length > 0 || returnTypes.length > 0) {
          this.traverse(visitors, {
            constants: scope.getAllBindingsOfKind("const"),
            subject: node,
            argumentGuards: argumentGuards,
            returnTypes: returnTypes
          });
        }
      }
      catch (e) {
        if (e instanceof SyntaxError) {
          throw this.errorWithNode(e.message);
        }
        else {
          throw e;
        }
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
        return [annotation.id];
      case "ObjectTypeAnnotation":
        return ["object"];
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
      default:
        throw new SyntaxError(`Unsupported type annotation type: ${annotation.type}`);
    }
  }


  /**
   * Create guards for the typed arguments of the function.
   */
  function createArgumentGuards (node: Object): Array<Object|string> {
    return node.params.reduce(
      (guards, param) => {
        if (param.type === "AssignmentPattern" && param.left.typeAnnotation) {
          guards.push(createDefaultArgumentGuard(param, extractAnnotationTypes(param.left.typeAnnotation)));
        }
        else if (param.typeAnnotation) {
          guards.push(createArgumentGuard(param, extractAnnotationTypes(param.typeAnnotation)));
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
  function createArgumentGuard (param: Object, types: Array<Object|string>): ?Object {
    if (types.indexOf('any') > -1 || types.indexOf('mixed') > -1) {
      return null;
    }
    return t.ifStatement(
      createIfTest(param, types),
      t.throwStatement(
        t.newExpression(
          t.identifier("TypeError"),
          [t.literal(`Value of argument '${param.name}' violates contract.`)]
        )
      )
    );
  }


  /**
   * Create a guard for a default paramter.
   */
  function createDefaultArgumentGuard (param: Object, types: Array<Object|string>): Object {
    const validated = staticallyVerifyDefaultArgumentType(param, types);
    if (validated === TYPE_INVALID) {
      throw new SyntaxError(`Default value for argument '${param.left.name}' violates contract.`);
    }
    return createArgumentGuard(param.left, types);
  }


  /**
   * Create a logical expression that checks that the subject node
   * has one of the given types.
   */
  function createIfTest (subject, types) {
    return types.reduce((last, type, index) => {
      if (index === 0) {
        return createTypeTest(subject, type);
      }
      return t.logicalExpression(
        "&&",
        last,
        createTypeTest(subject, type)
      );
    }, null);
  }


  /**
   * Create an expression that can validate that the given
   * subject node has the given type.
   */
  function createTypeTest (subject:Object, type: Object|string): Object {
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
    else {
      return t.unaryExpression(
        "!",
        t.binaryExpression(
          "instanceof",
          subject,
          type
        )
      );
    }
    return type;
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
  function createReturnTypeGuard (ref: Object, node: Object, scope: Scope, state: Object): Object {
    return t.ifStatement(
      createIfTest(ref, state.returnTypes),
      t.throwStatement(
        t.newExpression(
          t.identifier("TypeError"),
          [t.literal(`Function ${state.subject.id ? `'${state.subject.id.name}' ` : ''}return value violates contract.`)]
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
      return types.indexOf("object") > -1
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
  function enterNode (node: Object, parent: Object, scope: Scope, state: Object) {
    if (t.isFunction(node)) {
      // We don't descend into nested functions because the outer traversal
      // will visit them for us and it keeps things a *lot* simpler.
      return this.skip();
    }
    else if (node.type === "BlockStatement" && parent === state.subject && state.argumentGuards.length > 0) {
      // attach the argument guards to the first block statement in the function body
      return t.blockStatement(
        state.argumentGuards.concat(node.body)
      );
    }
  }


  /**
   * Invoked when leaving a visited AST node.
   */
  function exitNode (node: Object, parent: Object, scope: Scope, state: Object) {
    if (node.type !== 'ReturnStatement' || state.returnTypes.length === 0) {
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
      throw this.errorWithNode(`Function ${state.subject.id ? `'${state.subject.id.name}' ` : ''}return value violates contract.`);
    }
    else if (validated === TYPE_VALID) {
      // no need to guard, has been statically verified.
      return;
    }
    else {
      const ref = createReferenceTo(this, node.argument, scope);
      this.insertBefore(createReturnTypeGuard(ref, node, scope, state));
      return t.returnStatement(ref);
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