'use strict';

Object.defineProperty(exports, '__esModule', {
  value: true
});
/**
 * # Typecheck Transformer
 */
exports['default'] = build;

function build(babel) {
  var Transformer = babel.Transformer;
  var t = babel.types;
  var traverse = babel.traverse;
  var Scope = babel.Scope;

  // constants used when statically verifying types
  var TYPE_INVALID = 0;
  var TYPE_VALID = 1;
  var TYPE_UNKNOWN = 2;

  // the functions which will visit the AST nodes.
  var visitors = {
    enter: enterNode,
    exit: exitNode
  };

  /**
   * Binary Operators that can only produce boolean results.
   */
  var BOOLEAN_BINARY_OPERATORS = ['==', '===', '>=', '<=', '>', '<', 'instanceof'];

  // the configuration for the transformer
  return new Transformer('typecheck', {
    Function: function Function(node, parent, scope) {
      try {
        var argumentGuards = createArgumentGuards(node);
        var returnTypes = extractReturnTypes(node);
        if (argumentGuards.length > 0 || returnTypes.length > 0) {
          this.traverse(visitors, {
            constants: scope.getAllBindingsOfKind('const'),
            subject: node,
            argumentGuards: argumentGuards,
            returnTypes: returnTypes
          });
        }
      } catch (e) {
        if (e instanceof SyntaxError) {
          throw this.errorWithNode(e.message);
        } else {
          throw e;
        }
      }
    }
  });

  /**
   * Extract the possible types from the given type annotation.
   */
  function extractAnnotationTypes(_x) {
    var _again = true;

    _function: while (_again) {
      _again = false;
      var annotation = _x;

      switch (annotation.type) {
        case 'TypeAnnotation':
          _x = annotation.typeAnnotation;
          _again = true;
          continue _function;

        case 'UnionTypeAnnotation':
          return annotation.types.reduce(function (types, type) {
            return union(types, extractAnnotationTypes(type));
          }, []);
        case 'NullableTypeAnnotation':
          return union(['null'], extractAnnotationTypes(annotation.typeAnnotation));
        case 'GenericTypeAnnotation':
          if (annotation.id.name === 'mixed') {
            return ['mixed'];
          } else if (annotation.id.name === 'any') {
            return ['any'];
          } else if (annotation.id.name === 'Function') {
            return ['function'];
          } else if (annotation.id.name === 'Object') {
            return ['object'];
          } else if (annotation.id.name === 'Array') {
            return ['array'];
          }
          return [annotation.id];
        case 'ObjectTypeAnnotation':
          return ['object'];
        case 'StringTypeAnnotation':
          return ['string'];
        case 'BooleanTypeAnnotation':
          return ['boolean'];
        case 'NumberTypeAnnotation':
          return ['number'];
        case 'VoidTypeAnnotation':
          return ['undefined'];
        case 'AnyTypeAnnotation':
          return ['any'];
        default:
          throw new SyntaxError('Unsupported type annotation type: ' + annotation.type);
      }
    }
  }

  /**
   * Create guards for the typed arguments of the function.
   */
  function createArgumentGuards(node) {
    return node.params.reduce(function (guards, param) {
      if (param.type === 'AssignmentPattern' && param.left.typeAnnotation) {
        guards.push(createDefaultArgumentGuard(param, extractAnnotationTypes(param.left.typeAnnotation)));
      } else if (param.typeAnnotation) {
        guards.push(createArgumentGuard(param, extractAnnotationTypes(param.typeAnnotation)));
      }
      return guards;
    }, []).filter(identity); // remove blank nodes
  }

  /**
   * Create a guard for an individual argument.
   */
  function createArgumentGuard(param, types) {
    if (types.indexOf('any') > -1 || types.indexOf('mixed') > -1) {
      return null;
    }
    return t.ifStatement(createIfTest(param, types), t.throwStatement(t.newExpression(t.identifier('TypeError'), [t.literal('Value of argument \'' + param.name + '\' violates contract.')])));
  }

  /**
   * Create a guard for a default paramter.
   */
  function createDefaultArgumentGuard(param, types) {
    var validated = staticallyVerifyDefaultArgumentType(param, types);
    if (validated === TYPE_INVALID) {
      throw new SyntaxError('Default value for argument \'' + param.left.name + '\' violates contract.');
    }
    return createArgumentGuard(param.left, types);
  }

  /**
   * Create a logical expression that checks that the subject node
   * has one of the given types.
   */
  function createIfTest(subject, types) {
    return types.reduce(function (last, type, index) {
      if (index === 0) {
        return createTypeTest(subject, type);
      }
      return t.logicalExpression('&&', last, createTypeTest(subject, type));
    }, null);
  }

  /**
   * Create an expression that can validate that the given
   * subject node has the given type.
   */
  function createTypeTest(subject, type) {
    if (type === 'null') {
      return t.binaryExpression('!=', subject, t.literal(null));
    } else if (type === 'array') {
      return t.unaryExpression('!', t.callExpression(t.memberExpression(t.identifier('Array'), t.identifier('isArray')), [subject]));
    } else if (typeof type === 'string') {
      return t.binaryExpression('!==', t.unaryExpression('typeof', subject, true), t.literal(type));
    } else {
      return t.unaryExpression('!', t.binaryExpression('instanceof', subject, type));
    }
    return type;
  }

  /**
   * Extract a list of permissible return types for the function.
   */
  function extractReturnTypes(node) {
    if (node.returnType) {
      var types = extractAnnotationTypes(node.returnType);
      if (types.indexOf('any') === -1 && types.indexOf('mixed') === -1) {
        return types;
      }
    }
    return [];
  }

  /**
   * Create a runtime type guard for a return statement.
   */
  function createReturnTypeGuard(ref, node, scope, state) {
    return t.ifStatement(createIfTest(ref, state.returnTypes), t.throwStatement(t.newExpression(t.identifier('TypeError'), [t.literal('Function ' + (state.subject.id ? '\'' + state.subject.id.name + '\' ' : '') + 'return value violates contract.')])));
  }

  /**
   * Attempt to statically verify that the default value of an argument matches the annotated type.
   */
  function staticallyVerifyDefaultArgumentType(node, types) {
    return staticallyVerifyType(node.right, types);
  }

  /**
   * Attempt to statically verify the return type of a node.
   */
  function staticallyVerifyReturnType(node, types) {
    return staticallyVerifyType(node.argument, types);
  }

  /**
   * Statically verify that the given node is one of the given types.
   */
  function staticallyVerifyType(node, types) {
    if (isNodeNully(node)) {
      return types.indexOf('null') > -1 || types.indexOf('undefined') > -1 ? TYPE_VALID : TYPE_INVALID;
    } else if (node.type === 'Literal') {
      if (node.regex) {
        return types.indexOf('object') > -1 || types.some(identifierMatcher('RegExp')) ? TYPE_VALID : TYPE_INVALID;
      } else {
        return types.indexOf(typeof node.value) > -1 ? TYPE_VALID : TYPE_INVALID;
      }
    } else if (node.type === 'ObjectExpression') {
      return types.indexOf('object') > -1 ? TYPE_VALID : TYPE_INVALID;
    } else if (node.type === 'ArrayExpression') {
      return types.indexOf('array') > -1 || types.indexOf('object') > -1 ? TYPE_VALID : TYPE_INVALID;
    } else if (t.isFunction(node)) {
      return types.indexOf('function') > -1 || types.indexOf('object') > -1 ? TYPE_VALID : TYPE_INVALID;
    } else if (node.type === 'NewExpression' && node.callee.type === 'Identifier') {
      // this is of the form `return new SomeClass()`
      // @fixme it should be possible to do this with non computed member expressions too
      return types.indexOf('object') > -1 || types.some(identifierMatcher(node.callee.name)) ? TYPE_VALID : TYPE_UNKNOWN;
    } else if (isBooleanExpression(node)) {
      return types.indexOf('boolean') > -1 ? TYPE_VALID : TYPE_INVALID;
    } else if (node.type === 'Identifier') {
      // check the scope to see if this is a `const` value
      return node;
    } else {
      return TYPE_UNKNOWN; // will produce a runtime type check
    }
  }

  /**
   * Create a reference to the given node.
   */
  function createReferenceTo(traverser, value, scope) {
    if (value === null) {
      return t.literal(null);
    } else if (value === undefined) {
      return t.literal(undefined);
    } else if (value.type === 'Literal') {
      return value;
    } else if (value.type === 'Identifier') {
      return value;
    } else {
      var id = scope.generateUidBasedOnNode(value);
      scope.push({ id: id });
      traverser.insertBefore(t.expressionStatement(t.assignmentExpression('=', id, value)));
      return id;
    }
  }

  /**
   * Return a predicate that matches identifiers with the given name.
   * > Note: This does *no* scope checking.
   */
  function identifierMatcher(name) {
    return function (node) {
      return node && node.type === 'Identifier' && node.name === name;
    };
  }

  /**
   * Invoked when `traverse()` enters a particular AST node.
   */
  function enterNode(node, parent, scope, state) {
    if (t.isFunction(node)) {
      // We don't descend into nested functions because the outer traversal
      // will visit them for us and it keeps things a *lot* simpler.
      return this.skip();
    } else if (node.type === 'BlockStatement' && parent === state.subject && state.argumentGuards.length > 0) {
      // attach the argument guards to the first block statement in the function body
      return t.blockStatement(state.argumentGuards.concat(node.body));
    }
  }

  /**
   * Invoked when leaving a visited AST node.
   */
  function exitNode(node, parent, scope, state) {
    if (node.type !== 'ReturnStatement') {
      // we only care about return statements.
      return;
    }
    var validated = staticallyVerifyReturnType(node, state.returnTypes);
    if (typeof validated === 'object' && state.constants[validated.name]) {
      // the return value is a constant, let's see if we can infer the type
      var constant = state.constants[validated.name];
      var declarator = constant.path.parent.declarations[constant.path.key];
      validated = staticallyVerifyType(declarator.init, state.returnTypes);
    }

    if (validated === TYPE_INVALID) {
      throw this.errorWithNode('Function ' + (state.subject.id ? '\'' + state.subject.id.name + '\' ' : '') + 'return value violates contract.');
    } else if (validated === TYPE_VALID) {
      // no need to guard, has been statically verified.
      return;
    } else {
      var ref = createReferenceTo(this, node.argument, scope);
      this.insertBefore(createReturnTypeGuard(ref, node, scope, state));
      return t.returnStatement(ref);
    }
  }

  /**
   * Determine whether the given node can produce purely boolean results.
   */
  function isBooleanExpression(_x2) {
    var _left;

    var _again2 = true;

    _function2: while (_again2) {
      _again2 = false;
      var node = _x2;

      if (node.type === 'BinaryExpression' && BOOLEAN_BINARY_OPERATORS.indexOf(node.operator) > -1) {
        return true;
      } else if (node.type === 'LogicalExpression') {
        if (!(_left = isBooleanExpression(node.left))) {
          return _left;
        }

        _x2 = node.right;
        _again2 = true;
        continue _function2;
      } else {
        return false;
      }
    }
  }

  /**
   * Union two arrays.
   */
  function union(arr1, arr2) {
    for (var i = 0; i < arr2.length; i++) {
      var item = arr2[i];
      if (arr1.indexOf(item) === -1) {
        arr1.push(item);
      }
    }
    return arr1;
  }

  /**
   * Determing whether a given node is nully (null or undefined).
   */
  function isNodeNully(node) {
    if (node == null) {
      return true;
    } else if (node.type === 'Identifier' && node.name === 'undefined') {
      return true;
    } else if (node.type === 'Literal' && node.value === null) {
      return true;
    } else if (node.type === 'UnaryExpression' && node.operator === 'void') {
      return true;
    } else {
      return false;
    }
  }

  /**
   * A function that returns its first argument, useful when filtering.
   */
  function identity(input) {
    return input;
  }
}

module.exports = exports['default'];