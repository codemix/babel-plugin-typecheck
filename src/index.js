import generate from "babel-generator";

type Node = {
  type: string;
};

type Literal = {
  type: 'StringLiteral' | 'BooleanLiteral' | 'NumericLiteral' | 'NullLiteral' | 'RegExpLiteral'
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

type VisitorContext = {
  inspect: Identifier;
};

interface StringLiteralTypeAnnotation extends TypeAnnotation {
  type: 'StringLiteralTypeAnnotation';
}

interface NumericLiteralTypeAnnotation extends TypeAnnotation {
  type: 'NumericLiteralTypeAnnotation';
}

interface BooleanLiteralTypeAnnotation extends TypeAnnotation {
  type: 'BooleanLiteralTypeAnnotation';
}

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
  /**
   * Binary Operators that can only produce boolean results.
   */
  const BOOLEAN_BINARY_OPERATORS: string[] = [
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

  const checkIsArray: (() => Node) = expression(`Array.isArray(input)`);
  const checkIsMap: (() => Node) = expression(`input instanceof Map`);
  const checkIsSet: (() => Node) = expression(`input instanceof Set`);
  const checkIsClass: (() => Node) = expression(`typeof input === 'function' && input.prototype && input.prototype.constructor === input`);
  const checkIsGenerator: (() => Node) = expression(`typeof input === 'function' && input.generator`);
  const checkIsIterable: (() => Node) = expression(`input && (typeof input[Symbol.iterator] === 'function' || Array.isArray(input))`);
  const checkIsObject: (() => Node) = expression(`input != null && typeof input === 'object'`);
  const checkNotNull: (() => Node) = expression(`input != null`);
  const checkEquals: (() => Node) = expression(`input === expected`);

  const declareTypeChecker: (() => Node) = template(`
    const id = (function () {
      function id (input) {
        return check;
      };
      Object.defineProperty(id, Symbol.hasInstance, {
        value: function (input) {
          return id(input);
        }
      });
      return id;
    })();
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

  const guardInline: (() => Node) = expression(`
    (id => {
      if (!check) {
        throw new TypeError(message);
      }
      return id;
    })(input)
  `);

  const guardFn: (() => Node) = expression(`
    function name (id) {
      if (!check) {
        throw new TypeError(message);
      }
      return id;
    }
  `);

  const readableName: (() => Node) = expression(`
    inspect(input)
  `);
  const checkMapKeys: (() => Node) = expression(`
    input instanceof Map && Array.from(input.keys()).every(key => keyCheck)
  `);

  const checkMapValues: (() => Node) = expression(`
    input instanceof Map && Array.from(input.values()).every(value => valueCheck)
  `);

  const checkMapEntries: (() => Node) = expression(`
    input instanceof Map && Array.from(input).every(([key, value]) => keyCheck && valueCheck)
  `);

  const checkSetEntries: (() => Node) = expression(`
    input instanceof Set && Array.from(input).every(value => valueCheck)
  `);

  const checkObjectIndexers: (() => Node) = expression(`
    Object.keys(input).every(key => {
      const value = input[key];
      if (~fixedKeys.indexOf(key)) {
        return true;
      }
      else {
        return check;
      }
    });
  `);

  const checkObjectIndexersNoFixed: (() => Node) = expression(`
    Object.keys(input).every(key => {
      const value = input[key];
      return check;
    });
  `);

  const propType: (() => Node) = expression(`
    (function(props, name, component) {
      var prop = props[name];
      if(!check) {
        return new Error(
          "Invalid prop \`" + name + "\` supplied to \`" + component
          + "\`.\\n\\nExpected:\\n" + expected + "\\n\\nGot:\\n" + got + "\\n\\n"
        );
      }
    })
  `);

  const PRAGMA_IGNORE_STATEMENT = /typecheck:\s*ignore\s+statement/i;
  const PRAGMA_IGNORE_FILE = /typecheck:\s*ignore\s+file/i;
  function skipEnvironment(comments, opts) {
    if (!opts.only) {
      return false;
    }
    const envs = pragmaEnvironments(comments);
    return !opts.only.some(env => envs[env]);
  }

  function pragmaEnvironments(comments) {
    const pragma = /@typecheck:\s*(.+)/;
    const environments = {};
    comments.forEach(comment => {
      const m = comment.value.match(pragma);
      if (m) {
        m[1].split(',').forEach(env => environments[env.trim()] = true);
      }
    })
    return environments;
  }

  const visitors = {
    Statement (path: NodePath): void {
      maybeSkip(path);
    },
    TypeAlias (path: NodePath): void {
      if (maybeSkip(path)) {
        return;
      }
      path.replaceWith(createTypeAliasChecks(path));
    },

    InterfaceDeclaration (path: NodePath): void {
      if (maybeSkip(path)) {
        return;
      }
      path.replaceWith(createInterfaceChecks(path));
    },

    ExportNamedDeclaration (path: NodePath): void {
      if (maybeSkip(path)) {
        return;
      }
      const {node, scope} = path;
      if (node.declaration && node.declaration.type === 'TypeAlias') {
        const declaration = path.get('declaration');
        declaration.replaceWith(createTypeAliasChecks(declaration));
        node.exportKind = 'value';
      }
    },

    ImportDeclaration (path: NodePath): void {
      if (maybeSkip(path)) {
        return;
      }
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

    ArrowFunctionExpression (path: NodePath) {
      // Look for destructuring args with annotations.

      const params: NodePath[] = path.get('params');
      for (let param of params) {
        if (param.isObjectPattern() && param.node.typeAnnotation) {
          const {scope} = path.get('body');
          const id = scope.generateUidIdentifier(`arg${param.key}`);
          const pattern = param.node;
          param.replaceWith(id);
          if (path.node.expression) {
            const block = t.blockStatement([
              t.variableDeclaration('var', [
                t.variableDeclarator(pattern, id)
              ]),
              t.returnStatement(path.get('body').node)
            ]);
            path.node.body = block;
            path.node.expression = false;
          }
          else {
            path.get('body.body')[0].insertBefore(t.variableDeclaration('var', [
              t.variableDeclarator(pattern, id)
            ]));
          }
        }
      }
    },

    Function: {
      enter (path: NodePath, context: VisitorContext): void {
        if (maybeSkip(path)) {
          return;
        }

        const {node, scope} = path;
        const paramChecks = collectParamChecks(path, context);
        if (node.type === "ArrowFunctionExpression" && node.expression) {
          node.expression = false;
          node.body = t.blockStatement([t.returnStatement(node.body)]);
        }
        if (node.returnType) {
          createFunctionReturnGuard(path, context);
          createFunctionYieldGuards(path, context);
        }
        node.body.body.unshift(...paramChecks);
        node.savedTypeAnnotation = node.returnType;
        node.returnCount = 0;
        node.yieldCount = 0;
      },
      exit (path: NodePath): void {
        const {node, scope} = path;
        const isVoid = node.savedTypeAnnotation ? maybeNullableAnnotation(node.savedTypeAnnotation) : null;
        if (!node.returnCount && isVoid === false) {
          let annotation = node.savedTypeAnnotation;
          if (annotation.type === 'TypeAnnotation') {
            annotation = annotation.typeAnnotation;
          }
          if (node.generator && isGeneratorAnnotation(annotation) && annotation.typeParameters && annotation.typeParameters.params.length > 1) {
            annotation = annotation.typeParameters.params[1];
          }
          throw path.buildCodeFrameError(
            buildErrorMessage(
              `Function ${node.id ? `"${node.id.name}" ` : ''}did not return a value.`,
              annotation
            )
          );
        }
        if (node.nextGuardCount) {
          path.get('body').get('body')[0].insertBefore(node.nextGuard);
        }
        if (node.yieldGuardCount) {
          path.get('body').get('body')[0].insertBefore(node.yieldGuard);
        }
        if (node.returnGuardCount) {
          path.get('body').get('body')[0].insertBefore(node.returnGuard);
        }
      }
    },

    YieldExpression (path: NodePath, context: VisitorContext): void {
      const fn = path.getFunctionParent();
      if (!fn) {
        return;
      }
      fn.node.yieldCount++;
      if (!isGeneratorAnnotation(fn.node.returnType) || maybeSkip(path)) {
        return;
      }
      const {node, parent, scope} = path;
      let annotation = fn.node.returnType;
      if (annotation.type === 'NullableTypeAnnotation' || annotation.type === 'TypeAnnotation') {
        annotation = annotation.typeAnnotation;
      }
      if (!annotation.typeParameters || annotation.typeParameters.params.length === 0) {
        return;
      }

      const yieldType = annotation.typeParameters.params[0];
      const nextType = annotation.typeParameters.params[2];
      const ok = staticCheckAnnotation(path.get("argument"), yieldType);
      if (ok === true && !nextType) {
        return;
      }
      else if (ok === false) {
        throw path.buildCodeFrameError(
          buildErrorMessage(
            `Function ${fn.node.id ? `"${fn.node.id.name}" ` : ''}yielded an invalid type.`,
            yieldType,
            getAnnotation(path.get('argument'))
          )
        );
      }
      fn.node.yieldGuardCount++;
      if (fn.node.yieldGuard) {
        const yielder = t.yieldExpression(
          t.callExpression(fn.node.yieldGuardName, [node.argument || t.identifier('undefined')])
        );
        yielder.hasBeenTypeChecked = true;

        if (fn.node.nextGuard) {
          fn.node.nextGuardCount++;
          path.replaceWith(t.callExpression(fn.node.nextGuardName, [yielder]));
        }
        else {
          path.replaceWith(yielder);
        }
      }
      else if (fn.node.nextGuard) {
        fn.node.nextGuardCount++;
        path.replaceWith(t.callExpression(fn.node.nextGuardName, [yielder]));
      }
    },


    ReturnStatement (path: NodePath, context: VisitorContext): void {
      const fn = path.getFunctionParent();
      if (!fn) {
        return;
      }
      fn.node.returnCount++;
      if (maybeSkip(path)) {
        return;
      }
      const {node, parent, scope} = path;
      const {returnType, returnGuardName} = fn.node;
      if (!returnType || !returnGuardName) {
        return;
      }
      if (!node.argument) {
        if (maybeNullableAnnotation(returnType) === false) {
          throw path.buildCodeFrameError(
            buildErrorMessage(
              `Function ${fn.node.id ? `"${fn.node.id.name}" ` : ''}did not return a value.`,
              returnType
            )
          );
        }
        return;
      }
      let annotation = returnType;
      if (annotation.type === 'TypeAnnotation') {
        annotation = annotation.typeAnnotation;
      }
      if (isGeneratorAnnotation(annotation)) {
        annotation = annotation.typeParameters && annotation.typeParameters.params.length > 1 ? annotation.typeParameters.params[1] : t.anyTypeAnnotation();
      }
      else if (node.async && annotation.type === 'GenericTypeAnnotation' && annotation.id.name === 'Promise') {
        annotation = (annotation.typeParameters && annotation.typeParameters[0]) || t.anyTypeAnnotation();
      }
      const ok = staticCheckAnnotation(path.get("argument"), annotation);
      if (ok === true) {
        return;
      }
      else if (ok === false) {
        throw path.buildCodeFrameError(
          buildErrorMessage(
            `Function ${fn.node.id ? `"${fn.node.id.name}" ` : ''}returned an invalid type.`,
            annotation,
            getAnnotation(path.get('argument'))
          )
        );
      }
      fn.node.returnGuardCount++;
      const returner = t.returnStatement(t.callExpression(fn.node.returnGuardName, [node.argument]));
      returner.hasBeenTypeChecked = true;
      path.replaceWith(returner);
    },

    VariableDeclaration (path: NodePath, context: VisitorContext): void {
      if (maybeSkip(path)) {
        return;
      }
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
          throw path.buildCodeFrameError(
            buildErrorMessage(
              `Invalid assignment value for "${id.name}".`,
              id.typeAnnotation,
              getAnnotation(declarations[i])
            )
          );
        }
        const check = checkAnnotation(id, id.typeAnnotation, scope);
        if (check) {
          collected.push(guard({
            check,
            message: varTypeErrorMessage(id, context)
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
        else if (path.parentPath.isForXStatement() || path.parentPath.isForStatement() || path.parentPath.isForInStatement()) {
          let body = path.parentPath.get('body');
          if (body.type !== 'BlockStatement') {
            const block = t.blockStatement([body.node]);
            body.replaceWith(block);
            body = path.parentPath.get('body');
          }
          const children = body.get('body');
          if (children.length === 0) {
            body.replaceWith(check);
          }
          else {
            children[0].insertBefore(check);
          }

        }
        else if (path.parent.type === 'ExportNamedDeclaration' || path.parent.type === 'ExportDefaultDeclaration' || path.parent.type === 'ExportAllDeclaration') {
          path.parentPath.insertAfter(check);
        }
        else {
          path.replaceWith(t.blockStatement([node, check]));
        }
      }
    },

    AssignmentExpression (path: NodePath, context: VisitorContext): void {
      if (maybeSkip(path)) {
        return;
      }
      const {node, scope} = path;
      const left = path.get('left');
      let annotation;
      if (node.hasBeenTypeChecked || node.left.hasBeenTypeChecked) {
        return;
      }
      else if (left.isMemberExpression()) {
        annotation = getAnnotation(left);
      }
      else if (t.isIdentifier(node.left)) {
        const binding = scope.getBinding(node.left.name);
        if (!binding) {
          return;
        }
        else if (binding.path.type !== 'VariableDeclarator') {
          return;
        }
        annotation = left.getTypeAnnotation();
        if (annotation.type === 'AnyTypeAnnotation') {
          const item = binding.path.get('id');
          annotation = item.node.savedTypeAnnotation || item.getTypeAnnotation();
        }
      }
      else {
        return;
      }

      node.hasBeenTypeChecked = true;
      node.left.hasBeenTypeChecked = true;
      const id = node.left;
      const right = path.get('right');
      if (annotation.type === 'AnyTypeAnnotation') {
        return;
      }
      const ok = staticCheckAnnotation(right, annotation);
      if (ok === true) {
        return;
      }
      else if (ok === false) {
        throw path.buildCodeFrameError(
          buildErrorMessage(
            `Invalid assignment value for "${humanReadableType(id)}".`,
            annotation,
            getAnnotation(right)
          )
        );
      }
      const check = checkAnnotation(id, annotation, scope);
      if (!id.typeAnnotation) {
        id.typeAnnotation = annotation;
      }
      id.hasBeenTypeChecked = true;
      if (check) {
        const parent = path.getStatementParent();
        parent.insertAfter(guard({
          check,
          message: varTypeErrorMessage(id, context)
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
    },

    ForOfStatement (path: NodePath, context: VisitorContext): void {
      if (maybeSkip(path)) {
        return;
      }
      const left: NodePath = path.get('left');
      const right: NodePath = path.get('right');
      const rightAnnotation: TypeAnnotation = getAnnotation(right);
      const leftAnnotation: TypeAnnotation = left.isVariableDeclaration() ? getAnnotation(left.get('declarations')[0].get('id')) : getAnnotation(left);
      if (rightAnnotation.type !== 'VoidTypeAnnotation' && rightAnnotation.type !== 'NullLiteralTypeAnnotation') {
        const ok: ?boolean = maybeIterableAnnotation(rightAnnotation);
        if (ok === false) {
          throw path.buildCodeFrameError(`Cannot iterate ${humanReadableType(rightAnnotation)}.`);
        }
      }
      let id: ?Identifier;
      if (right.isIdentifier()) {
        id = right.node;
      }
      else {
        id = path.scope.generateUidIdentifierBasedOnNode(right.node);
        path.scope.push({id});
        const replacement: Node = t.expressionStatement(t.assignmentExpression('=', id, right.node));
        path.insertBefore(replacement);
        right.replaceWith(id);
      }
      path.insertBefore(guard({
        check: checks.iterable({input: id}),
        message: t.binaryExpression(
          '+',
          t.stringLiteral(`Expected ${humanReadableType(right.node)} to be iterable, got `),
          readableName({inspect: context.inspect, input: id})
        )
      }));

      if (rightAnnotation.type !== 'GenericTypeAnnotation' || rightAnnotation.id.name !== 'Iterable' || !rightAnnotation.typeParameters || !rightAnnotation.typeParameters.params.length) {
        return;
      }

      const annotation: TypeAnnotation = rightAnnotation.typeParameters.params[0];
      if (compareAnnotations(annotation, leftAnnotation) === false) {
        throw path.buildCodeFrameError(
          buildErrorMessage(
            `Invalid iterator type.`,
            annotation,
            leftAnnotation
          )
        );
      }
    },

    ClassDeclaration (path: NodePath, context: VisitorContext) {
      // Convert React props to propTypes
      if (!path.node.superClass) {
        return;
      }

      let props: ?NodePath;
      let hasRenderMethod = false;
      for (let memberPath of path.get('body.body')) {
        const classMember = memberPath.node;
        if (t.isClassProperty(classMember)) {
          if (classMember.key.name === 'propTypes' && classMember.static) {
            return;
          }
          else if (classMember.key.name === 'props' && !classMember.static) {
            props = memberPath;
          }
        }
        if (t.isClassMethod(classMember) && classMember.key.name === 'render') {
          hasRenderMethod = true;
        }
      }

      let type: ?Node;
      if (path.node.superTypeParameters) {
        if (path.node.superTypeParameters.params.length !== 3) {
          return;
        }
        type = path.node.superTypeParameters.params[1];
      }
      if (props) {
        type = props.node.typeAnnotation.typeAnnotation;
      }

      if (!type || !hasRenderMethod) {
        return;
      }

      if (t.isGenericTypeAnnotation(type)) {
        const binding = path.scope.getBinding(type.id.name);
        type = getAnnotation(binding.path);
      }
      if (!t.isObjectTypeAnnotation(type)) {
        return;
      }

      // Now we have a class that has a superclass, an instance method called 'render'
      // and some property type annotations. We can be reasonably sure it's a React component.

      const propTypes = t.objectExpression(
        type.properties.map(
          prop => t.objectProperty(
            t.identifier(prop.key.name),
            generatePropType(prop.value, path.scope, context)
          )
        )
      );

      if (path.node.decorators) {
        const property = t.classProperty(t.identifier('propTypes'), propTypes);
        property.static = true;
        props.insertAfter(property);
      }
      else {
        const root:NodePath = path.parentPath.isExportDeclaration() ? path.parentPath : path;
        root.insertAfter(
          t.expressionStatement(
            t.assignmentExpression(
              "=",
              t.memberExpression(path.node.id, t.identifier("propTypes")),
              propTypes
            )
          )
        );
      }
    }
  };

  /**
   * Collect all the type declarations in the given path and add references to them for retreival later.
   */
  function collectTypes (path: NodePath): void {
    path.traverse({
      InterfaceDeclaration (path: NodePath) {
        path.scope.setData(`typechecker:${path.node.id.name}`, path);
      },
      TypeAlias (path: NodePath) {
        path.scope.setData(`typechecker:${path.node.id.name}`, path);
      },
      ImportDeclaration (path: NodePath) {
        if (path.node.importKind !== 'type') {
          return;
        }
        path.get('specifiers')
        .forEach(specifier => {
          const local = specifier.get('local');
          if (local.isIdentifier()) {
            path.scope.setData(`typechecker:${local.node.name}`, specifier);
          }
          else {
            path.scope.setData(`typechecker:${local.node.id.name}`, specifier);
          }
        });
      },
      "Function|Class" (path: NodePath) {
        const node = path.node;
        if (node.typeParameters && node.typeParameters.params) {
          path.get('typeParameters').get('params').forEach(typeParam => {
            path.get('body').scope.setData(`typeparam:${typeParam.node.name}`, typeParam);
          });
        }
      }
    });
  }

  return {
    visitor: {
      Program (path: NodePath, {opts}) {
        if (opts && opts.disable && opts.disable[process.env.NODE_ENV]) {
          return;
        }
        let checkFile = false;
        for (let child of path.get('body')) {
          if (mustCheckFile(child, opts)) {
            checkFile = true;
            break;
          }
        }
        if (!checkFile) {
          for (let child of path.get('body')) {
            if (maybeSkipFile(child, opts)) {
              return;
            }
          }
        }
        collectTypes(path);
        const inspect = path.scope.generateUidIdentifier('inspect');
        const requiresHelpers = {
          inspect: false
        };
        const context = {
          get inspect () {
            requiresHelpers.inspect = true;
            return inspect;
          }
        };
        path.traverse(visitors, context);

        if (requiresHelpers.inspect) {
          const body = path.get('body');
          body[body.length - 1].insertAfter(template(`
            function id (input, depth) {
              const maxDepth = 4;
              const maxKeys = 15;
              if (depth === undefined) {
                depth = 0;
              }
              depth += 1;
              if (input === null) {
                return 'null';
              }
              else if (input === undefined) {
                return 'void';
              }
              else if (typeof input === 'string' || typeof input === 'number' || typeof input === 'boolean') {
                return typeof input;
              }
              else if (Array.isArray(input)) {
                if (input.length > 0) {
                  if (depth > maxDepth) return '[...]';
                  const first = id(input[0], depth);
                  if (input.every(item => id(item, depth) === first)) {
                    return first.trim() + '[]';
                  }
                  else {
                    return '[' + input.slice(0, maxKeys).map(item => id(item, depth)).join(', ') + (input.length >= maxKeys ? ', ...' : '') + ']';
                  }
                }
                else {
                  return 'Array';
                }
              }
              else {
                const keys = Object.keys(input);
                if (!keys.length) {
                  if (input.constructor && input.constructor.name && input.constructor.name !== 'Object') {
                    return input.constructor.name;
                  }
                  else {
                    return 'Object';
                  }
                }
                if (depth > maxDepth) return '{...}';
                const indent = '  '.repeat(depth - 1);
                let entries = keys.slice(0, maxKeys).map(key => {
                  return (/^([A-Z_$][A-Z0-9_$]*)$/i.test(key) ? key : JSON.stringify(key)) + ': ' + id(input[key], depth) + ';';
                }).join('\\n  ' + indent);
                if (keys.length >= maxKeys) {
                  entries += '\\n  ' + indent + '...';
                }
                if (input.constructor && input.constructor.name && input.constructor.name !== 'Object') {
                  return input.constructor.name + ' {\\n  ' + indent + entries + '\\n' + indent + '}';
                }
                else {
                  return '{\\n  ' + indent + entries + '\\n' + indent + '}';
                }
              }
            }
          `)({id: inspect}));
        }
      }
    }
  }

  /**
   * Create a function which can verify the return type for a function.
   */
  function createFunctionReturnGuard (path: NodePath, context: VisitorContext): void {
    const {node, scope} = path;
    let annotation = node.returnType;
    if (annotation.type === 'TypeAnnotation') {
      annotation = annotation.typeAnnotation;
    }
    if (isGeneratorAnnotation(annotation)) {
      annotation = annotation.typeParameters && annotation.typeParameters.params.length > 1 ? annotation.typeParameters.params[1] : t.anyTypeAnnotation();
    }
    else if (node.async && annotation.type === 'GenericTypeAnnotation' && annotation.id.name === 'Promise') {
      annotation = (annotation.typeParameters && annotation.typeParameters[0]) || t.anyTypeAnnotation();
    }
    const name = scope.generateUidIdentifierBasedOnNode(node);
    const id = scope.generateUidIdentifier('id');
    const check = checkAnnotation(id, annotation, scope);
    if (check) {
      node.returnGuard = guardFn({
        id,
        name,
        check,
        message: returnTypeErrorMessage(path, path.node, id, context)
      });
      node.returnGuard.hasBeenTypeChecked = true;
      node.returnGuardName = name;
      node.returnGuardCount = 0;
    }
  }

  function createFunctionYieldGuards (path: NodePath, context: VisitorContext) {
    const {node, scope} = path;
    let annotation = node.returnType;
    if (annotation.type === 'NullableTypeAnnotation' || annotation.type === 'TypeAnnotation') {
      annotation = annotation.typeAnnotation;
    }
    if (!annotation.typeParameters || annotation.typeParameters.params.length === 0) {
      return;
    }
    if (annotation.type === 'TypeAnnotation') {
      annotation = annotation.typeAnnotation;
    }
    if (!isGeneratorAnnotation(annotation)) {
      return;
    }

    const yieldType = annotation.typeParameters.params[0];
    const nextType = annotation.typeParameters.params[2];

    if (yieldType) {
      const name = scope.generateUidIdentifier(`check${node.id ? node.id.name.slice(0, 1).toUpperCase() + node.id.name.slice(1) : ''}Yield`);
      const id = scope.generateUidIdentifier('id');
      const check = checkAnnotation(id, yieldType, scope);
      if (check) {
        node.yieldGuard = guardFn({
          id,
          name,
          check,
          message: yieldTypeErrorMessage(node, yieldType, id, context)
        });
        node.yieldGuardName = name;
        node.yieldGuardCount = 0;
      }
    }


    if (nextType) {
      const name = scope.generateUidIdentifier(`check${node.id ? node.id.name.slice(0, 1).toUpperCase() + node.id.name.slice(1) : ''}Next`);
      const id = scope.generateUidIdentifier('id');
      const check = checkAnnotation(id, nextType, scope);
      if (check) {
        node.nextGuard = guardFn({
          id,
          name,
          check,
          message: yieldNextTypeErrorMessage(node, nextType, id, context)
        });
        node.nextGuardName = name;
        node.nextGuardCount = 0;
      }
    }
  }

  function isThisMemberExpression (path: NodePath): boolean {
    const {node} = path;
    if (node.type === 'ThisExpression') {
      return true;
    }
    else if (node.type === 'MemberExpression') {
      return isThisMemberExpression(path.get('object'));
    }
    else {
      return false;
    }
  }

  function isGeneratorAnnotation (annotation: ?TypeAnnotation): boolean {
    if (!annotation) {
      return false;
    }
    if (annotation.type === 'TypeAnnotation' || annotation.type === 'NullableTypeAnnotation') {
      annotation = annotation.typeAnnotation;
    }
    return annotation.type === 'GenericTypeAnnotation' && annotation.id.name === 'Generator';
  }

  function buildErrorMessage (message: string, expected: TypeAnnotation, got: ?Node) {
    if (got) {
      return message + '\n\nExpected:\n' + humanReadableType(expected) + '\n\nGot:\n' + humanReadableType(got);
    }
    else {
      return message + '\n\nExpected:\n' + humanReadableType(expected);
    }
  }

  function createChecks (): Object {
    return {
      number: expression(`typeof input === 'number'`),
      numericLiteral: checkNumericLiteral,
      boolean: expression(`typeof input === 'boolean'`),
      booleanLiteral: checkBooleanLiteral,
      class: checkClass,
      function: expression(`typeof input === 'function'`),
      string: expression(`typeof input === 'string'`),
      stringLiteral: checkStringLiteral,
      symbol: expression(`typeof input === 'symbol'`),
      undefined: expression(`input === undefined`),
      null: expression(`input === null`),
      void: expression(`input == null`),
      instanceof: expression(`input instanceof type`),
      type: expression(`type(input)`),
      mixed: () => null,
      any: () => null,
      union: checkUnion,
      intersection: checkIntersection,
      array: checkArray,
      map: checkMap,
      set: checkSet,
      generator: checkGenerator,
      iterable: checkIterable,
      tuple: checkTuple,
      object: checkObject,
      nullable: checkNullable,
      typeof: checkTypeof,
      int8: expression(`typeof input === 'number' && !isNaN(input) && input >= -128 && input <= 127 && input === Math.floor(input)`),
      uint8: expression(`typeof input === 'number' && !isNaN(input) && input >= 0 && input <= 255 && input === Math.floor(input)`),
      int16: expression(`typeof input === 'number' && !isNaN(input) && input >= -32768 && input <= 32767 && input === Math.floor(input)`),
      uint16: expression(`typeof input === 'number' && !isNaN(input) && input >= 0 && input <= 65535 && input === Math.floor(input)`),
      int32: expression(`typeof input === 'number' && !isNaN(input) && input >= -2147483648 && input <= 2147483647 && input === Math.floor(input)`),
      uint32: expression(`typeof input === 'number' && !isNaN(input) && input >= 0 && input <= 4294967295 && input === Math.floor(input)`),
      float32: expression(`typeof input === 'number' && !isNaN(input) && input >= -3.40282347e+38 && input <= 3.40282347e+38`),
      float64: expression(`typeof input === 'number' && !isNaN(input)`),
      double: expression(`typeof input === 'number' && !isNaN(input)`)


    };
  }

  function createStaticChecks (): Object {
    return {
      symbol (path: NodePath): ?boolean {
        return maybeSymbolAnnotation(getAnnotation(path));
      },
      instanceof ({path, annotation}): ?boolean {
        const type = createTypeExpression(annotation.id);

        const {node, scope} = path;
        if (type.name === 'Object' && node.type === 'ObjectExpression' && !scope.getBinding('Object')) {
          return true;
        }
        else if (type.name === 'Map' && !scope.getBinding('Map')) {
          return null;
        }
        else if (type.name === 'Set' && !scope.getBinding('Set')) {
          return null;
        }
        else if (type.name === 'Class' && !scope.hasBinding('Class')) {
          return null;
        }
        else if (type.name === 'int8' && !scope.hasBinding('int8')) {
          return null;
        }
        else if (type.name === 'uint8' && !scope.hasBinding('uint8')) {
          return null;
        }
        else if (type.name === 'int16' && !scope.hasBinding('int16')) {
          return null;
        }
        else if (type.name === 'uint16' && !scope.hasBinding('uint16')) {
          return null;
        }
        else if (type.name === 'int32' && !scope.hasBinding('int32')) {
          return null;
        }
        else if (type.name === 'uint32' && !scope.hasBinding('uint32')) {
          return null;
        }
        else if (type.name === 'float32' && !scope.hasBinding('float32')) {
          return null;
        }
        else if (type.name === 'float64' && !scope.hasBinding('float64')) {
          return null;
        }
        else if (type.name === 'double' && !scope.hasBinding('double')) {
          return null;
        }
        return maybeInstanceOfAnnotation(getAnnotation(path), type, annotation.typeParameters ? annotation.typeParameters.params : []);
      },
      type ({path, type}): ?boolean {
        return null;
      },
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
        return maybeStringAnnotation(b);
      case 'StringLiteral':
      case 'StringLiteralTypeAnnotation':
        return compareStringLiteralAnnotations(a, b);
      case 'NumberTypeAnnotation':
        return maybeNumberAnnotation(b);
      case 'NumericLiteral':
      case 'NumericLiteralTypeAnnotation':
        return compareNumericLiteralAnnotations(a, b);
      case 'BooleanTypeAnnotation':
        return maybeBooleanAnnotation(b);
      case 'BooleanLiteral':
      case 'BooleanLiteralTypeAnnotation':
        return compareBooleanLiteralAnnotations(a, b);
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
      case 'IntersectionTypeAnnotation':
        return compareIntersectionAnnotation(a, b);
      case 'NullableTypeAnnotation':
        return compareNullableAnnotation(a, b);
      default:
        return null;
    }
  }

  function compareStringLiteralAnnotations (a: StringLiteralTypeAnnotation, b: TypeAnnotation): ?boolean {
    if (b.type === 'StringLiteralTypeAnnotation' || b.type === 'StringLiteral') {
      return a.value === b.value;
    }
    else {
      return maybeStringAnnotation(b) === false ? false : null;
    }
  }

  function compareBooleanLiteralAnnotations (a: BooleanLiteralTypeAnnotation, b: TypeAnnotation): ?boolean {
    if (b.type === 'BooleanLiteralTypeAnnotation' || b.type === 'BooleanLiteral') {
      return a.value === b.value;
    }
    else {
      return maybeBooleanAnnotation(b) === false ? false : null;
    }
  }

  function compareNumericLiteralAnnotations (a: NumericLiteralTypeAnnotation, b: TypeAnnotation): ?boolean {
    if (b.type === 'NumericLiteralTypeAnnotation' || b.type === 'NumericLiteral') {
      return a.value === b.value;
    }
    else {
      return maybeNumberAnnotation(b) === false ? false : null;
    }
  }

  function unionComparer (a: TypeAnnotation, b: TypeAnnotation, comparator: (a:TypeAnnotation, b:TypeAnnotation) => ?boolean): ?boolean {
    if (!a.types || a.types.length === 0) {
      return null;
    }
    let falseCount = 0;
    let trueCount = 0;
    if (!a.types) {
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

  function intersectionComparer (a: TypeAnnotation, b: TypeAnnotation, comparator: (a:TypeAnnotation, b:TypeAnnotation) => ?boolean): ?boolean {
    let falseCount = 0;
    let trueCount = 0;
    if (!a.types) {
      return null;
    }
    for (let type of a.types) {
      const result = comparator(type, b);
      if (result === true) {
        trueCount++;
      }
      else if (result === false) {
        return false;
      }
    }
    if (trueCount === a.types.length) {
      return true;
    }
    else {
      return null;
    }
  }

  function compareObjectAnnotation (a: Node, b: Node): ?boolean {
    switch (b.type) {
      case 'ObjectTypeAnnotation':
        break;
      case 'TypeAnnotation':
      case 'FunctionTypeParam':
      case 'NullableTypeAnnotation':
        return compareObjectAnnotation(a, b.typeAnnotation);
      case 'UnionTypeAnnotation':
        return unionComparer(a, b, compareObjectAnnotation);
      case 'IntersectionTypeAnnotation':
        return intersectionComparer(a, b, compareObjectAnnotation);
      case 'VoidTypeAnnotation':
      case 'NullLiteralTypeAnnotation':
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

    // We're comparing two object annotations.
    let allTrue = true;
    for (let aprop of a.properties) {
      let found = false;
      for (let bprop of b.properties) {
        if (bprop.key.name === aprop.key.name) {
          const result = compareAnnotations(aprop.value, bprop.value);
          if (result === false && !(aprop.optional && (bprop.optional || maybeNullableAnnotation(bprop.value) === true))) {
            return false;
          }
          else {
            found = result;
          }
          break;
        }
      }
      if (found === false && !aprop.optional) {
        return false;
      }
      allTrue = allTrue && found === true;
    }
    return allTrue ? true : null;
  }

  function compareArrayAnnotation (a: Node, b: Node): ?boolean {
    switch (b.type) {
      case 'TypeAnnotation':
      case 'FunctionTypeParam':
      case 'NullableTypeAnnotation':
        return compareArrayAnnotation(a, b.typeAnnotation);
      case 'UnionTypeAnnotation':
        return unionComparer(a, b, compareArrayAnnotation);
      case 'IntersectionTypeAnnotation':
        return intersectionComparer(a, b, compareArrayAnnotation);
      case 'VoidTypeAnnotation':
      case 'NullLiteralTypeAnnotation':
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
      case 'FunctionTypeParam':
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
      case 'IntersectionTypeAnnotation':
        return intersectionComparer(a, b, compareGenericAnnotation);
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
      case 'FunctionTypeParam':
      case 'NullableTypeAnnotation':
        return compareTupleAnnotation(a, b.typeAnnotation);
      case 'UnionTypeAnnotation':
        return unionComparer(a, b, compareTupleAnnotation);
      case 'IntersectionTypeAnnotation':
        return intersectionComparer(a, b, compareTupleAnnotation);
      case 'VoidTypeAnnotation':
      case 'NullLiteralTypeAnnotation':
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
      case 'FunctionTypeParam':
        return compareNullableAnnotation(a, b.typeAnnotation);
      case 'NullableTypeAnnotation':
      case 'VoidTypeAnnotation':
      case 'NullLiteralTypeAnnotation':
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

  function checkNullable ({input, type, scope}): ?Node {
    const check = checkAnnotation(input, type, scope);
    if (!check) {
      return;
    }
    return t.logicalExpression(
      "||",
      checks.void({input}),
      check
    );
  }

  function checkTypeof ({input, annotation, scope}): ?Node {
    switch (annotation.type) {
      case 'GenericTypeAnnotation':
        const {id} = annotation;
        const path = Object.assign({}, input, {type: id.type, node: id, scope});
        return checkAnnotation(input, getAnnotation(path), scope);
      default:
        return checkAnnotation(input, annotation, scope);
    }
  }

  function checkStringLiteral ({input, annotation}): ?Node {
    return checkEquals({input, expected: t.stringLiteral(annotation.value)});
  }

  function checkNumericLiteral ({input, annotation}): ?Node {
    return checkEquals({input, expected: t.numericLiteral(annotation.value)});
  }

  function checkBooleanLiteral ({input, annotation}): ?Node {
    return checkEquals({input, expected: t.booleanLiteral(annotation.value)});
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


  function checkIntersection ({input, types, scope}): ?Node {
    const checks = types.map(type => checkAnnotation(input, type, scope)).filter(identity);
    return checks.reduce((last, check, index) => {
      if (last == null) {
        return check;
      }
      return t.logicalExpression(
        "&&",
        last,
        check
      );
    }, null);
  }


  function checkMap ({input, types, scope}): Node {
    const [keyType, valueType] = types;
    const key = t.identifier('key');
    const value = t.identifier('value');
    const keyCheck = keyType ? checkAnnotation(key, keyType, scope) : null;
    const valueCheck = valueType ? checkAnnotation(value, valueType, scope) : null;
    if (!keyCheck) {
      if (!valueCheck) {
        return checkIsMap({input});
      }
      else {
        return checkMapValues({input, value, valueCheck});
      }
    }
    else {
      if (!valueCheck) {
        return checkMapKeys({input, key, keyCheck});
      }
      else {
        return checkMapEntries({input, key, value, keyCheck, valueCheck});
      }
    }
  }

  function checkSet ({input, types, scope}): Node {
    const [valueType] = types;
    const value = t.identifier('value');
    const valueCheck = valueType ? checkAnnotation(value, valueType, scope) : null;
    if (!valueCheck) {
      return checkIsSet({input});
    }
    else {
      return checkSetEntries({input, value, valueCheck});
    }
  }

  function checkGenerator ({input, types, scope}): Node {
    return checkIsGenerator({input});
  }

  function checkIterable ({input, types, scope}): Node {
    return checkIsIterable({input});
  }

  function checkClass ({input, types, scope}): Node {
    return checkIsClass({input});
  }

  function checkArray ({input, types, scope}): Node {
    if (!types || types.length === 0) {
      return checkIsArray({input});
    }
    else if (types.length === 1) {
      const item = t.identifier('item');
      const type = types[0];
      const check = checkAnnotation(item, type, scope);
      if (!check) {
        return checkIsArray({input});
      }
      return t.logicalExpression(
        '&&',
        checkIsArray({input}),
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
        checkIsArray({input}),
        checkLength
      ));
    }
  }

  function checkTuple ({input, types, scope}): Node {
    if (types.length === 0) {
      return checkIsArray({input});
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
      checkIsArray({input}),
      checkLength
    ));
  }

  function checkObject ({input, properties, indexers, scope}): Node {
    if (input.type === 'ObjectPattern') {
      return checkObjectPattern({input, properties, scope});
    }
    const propNames = [];
    const check = properties.length === 0 ? checkIsObject({input}) : properties.reduce((expr, prop, index) => {
      const target = prop.key.type === 'Identifier' ? t.memberExpression(input, prop.key) : t.memberExpression(input, prop.key, true);
      propNames.push(prop.key.type === 'Identifier' ? t.stringLiteral(prop.key.name) : prop.key);
      let check = checkAnnotation(target, prop.value, scope);
      if (check) {
        if (prop.optional) {
          check = t.logicalExpression(
            '||',
            checks.undefined({input: target}),
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
    }, checkNotNull({input}));

    if (indexers.length) {
      return indexers.reduceRight((expr, indexer) => {
        if (indexer.value.type === 'AnyTypeAnnotation') {
          return expr;
        }
        const value = scope.generateUidIdentifier(indexer.id.name);
        let check = checkAnnotation(value, indexer.value, scope);
        const fixedKeys = t.arrayExpression(propNames);

        if (check) {
          if (propNames.length) {
            return t.logicalExpression('&&', expr, checkObjectIndexers({input, value, check, fixedKeys}));
          }
          else {
            return t.logicalExpression('&&', expr, checkObjectIndexersNoFixed({input, value, check, fixedKeys}));
          }
        }
        else {
          return expr;
        }
      }, check);
    }

    return check;
  }

  function checkObjectPattern ({input, properties, scope}): ?Node {
    const propNames = properties.reduce((names, prop) => {
      names[prop.key.name] = prop;
      return names;
    }, {});
    const propChecks = {};
    for (let item of input.properties) {
      let {key, value: id} = item;
      let prop = propNames[key.name];
      if (!prop) {
        continue;
      }
      const check = checkAnnotation(id, prop.value, scope);
      if (check) {
        propChecks[key.name] = check;
      }
    }
    return Object.keys(propChecks).reduce((last, name) => {
      const check = propChecks[name];
      if (last === null) {
        return check;
      }
      else {
        return t.logicalExpression('&&', last, check);
      }
    }, null);
  }

  function createTypeAliasChecks (path: NodePath): Node {
    const {node, scope} = path;
    const {id, right: annotation} = node;
    const input = t.identifier('input');
    const check = checkAnnotation(input, annotation, scope) || t.booleanLiteral(true);
    const declaration = declareTypeChecker({id, check});
    declaration.isTypeChecker = true;
    declaration.savedTypeAnnotation = annotation;
    declaration.declarations[0].savedTypeAnnotation = annotation;
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
      case 'FunctionTypeParam':
        return checkAnnotation(input, annotation.typeAnnotation, scope);
      case 'TypeofTypeAnnotation':
        return checks.typeof({input, annotation: annotation.argument, scope});
      case 'GenericTypeAnnotation':
        if (annotation.id.name === 'Array') {
          return checks.array({input, types: annotation.typeParameters ? annotation.typeParameters.params : [], scope});
        }
        else if (annotation.id.name === 'Generator' && !scope.hasBinding('Generator')) {
          return checks.generator({input, types: annotation.typeParameters ? annotation.typeParameters.params : [], scope});
        }
        else if (annotation.id.name === 'Iterable' && !scope.hasBinding('Iterable')) {
          return checks.iterable({input, types: annotation.typeParameters ? annotation.typeParameters.params : [], scope});
        }
        else if (annotation.id.name === 'Map' && !scope.getBinding('Map')) {
          return checks.map({input, types: annotation.typeParameters ? annotation.typeParameters.params : [], scope});
        }
        else if (annotation.id.name === 'Set' && !scope.getBinding('Set')) {
          return checks.set({input, types: annotation.typeParameters ? annotation.typeParameters.params : [], scope});
        }
        else if (annotation.id.name === 'Function') {
          return checks.function({input});
        }
        else if (annotation.id.name === 'Class' && !scope.hasBinding('Class')) {
          return checks.class({input, types: annotation.typeParameters ? annotation.typeParameters.params : [], scope});
        }
        else if (annotation.id.name === 'int8' && !scope.hasBinding('int8')) {
          return checks.int8({input});
        }
        else if (annotation.id.name === 'uint8' && !scope.hasBinding('uint8')) {
          return checks.uint8({input});
        }
        else if (annotation.id.name === 'int16' && !scope.hasBinding('int16')) {
          return checks.int16({input});
        }
        else if (annotation.id.name === 'uint16' && !scope.hasBinding('uint16')) {
          return checks.uint16({input});
        }
        else if (annotation.id.name === 'int32' && !scope.hasBinding('int32')) {
          return checks.int32({input});
        }
        else if (annotation.id.name === 'uint32' && !scope.hasBinding('uint32')) {
          return checks.uint32({input});
        }
        else if (annotation.id.name === 'float32' && !scope.hasBinding('float32')) {
          return checks.float32({input});
        }
        else if (annotation.id.name === 'float64' && !scope.hasBinding('float64')) {
          return checks.float64({input});
        }
        else if (annotation.id.name === 'double' && !scope.hasBinding('double')) {
          return checks.double({input});
        }
        else if (annotation.id.name === 'Symbol' && !scope.getBinding('Symbol')) {
          return checks.symbol({input});
        }
        else if (isTypeChecker(annotation.id, scope)) {
          return checks.type({input, type: annotation.id});
        }
        else if (isPolymorphicType(annotation.id, scope)) {
          return;
        }
        else {
          return checks.instanceof({input, type: createTypeExpression(annotation.id)});
        }
      case 'TupleTypeAnnotation':
        return checks.tuple({input, types: annotation.types, scope});
      case 'NumberTypeAnnotation':
        return checks.number({input});
      case 'NumericLiteralTypeAnnotation':
        return checks.numericLiteral({input, annotation});
      case 'BooleanTypeAnnotation':
        return checks.boolean({input});
      case 'BooleanLiteralTypeAnnotation':
        return checks.booleanLiteral({input, annotation});
      case 'StringTypeAnnotation':
        return checks.string({input});
      case 'StringLiteralTypeAnnotation':
        return checks.stringLiteral({input, annotation});
      case 'UnionTypeAnnotation':
        return checks.union({input, types: annotation.types, scope});
      case 'IntersectionTypeAnnotation':
        return checks.intersection({input, types: annotation.types, scope});
      case 'ObjectTypeAnnotation':
        return checks.object({input, properties: annotation.properties || [], indexers: annotation.indexers, scope});
      case 'ArrayTypeAnnotation':
        return checks.array({input, types: [annotation.elementType || t.anyTypeAnnotation()], scope});
      case 'FunctionTypeAnnotation':
        return checks.function({input, params: annotation.params, returnType: annotation.returnType});
      case 'MixedTypeAnnotation':
        return checks.mixed({input});
      case 'AnyTypeAnnotation':
      case 'ExistentialTypeParam':
        return checks.any({input});
      case 'NullableTypeAnnotation':
        return checks.nullable({input, type: annotation.typeAnnotation, scope});
      case 'VoidTypeAnnotation':
      case 'NullLiteralTypeAnnotation':
        return checks.void({input});
    }
  }

  function staticCheckAnnotation (path: NodePath, annotation: TypeAnnotation): ?boolean {
    const other = getAnnotation(path);
    switch (annotation.type) {
      case 'TypeAnnotation':
      case 'FunctionTypeParam':
        return staticCheckAnnotation(path, annotation.typeAnnotation);
      case 'GenericTypeAnnotation':
        if (isTypeChecker(annotation.id, path.scope)) {
          return staticChecks.type({path, type: annotation.id});
        }
        else if (isPolymorphicType(annotation.id, path.scope)) {
          return;
        }
        else if (annotation.id.name === 'Symbol') {
          return staticChecks.symbol(path);
        }
        else {
          return staticChecks.instanceof({path, annotation});
        }
    }
    return compareAnnotations(annotation, other);
  }

  /**
   * Get the type annotation for a given node.
   */
  function getAnnotation (path: NodePath): TypeAnnotation {
    let annotation;
    try {
      annotation = getAnnotationShallow(path);
    }
    catch (e) {
      if (e instanceof SyntaxError) {
        throw e;
      }
      if (process.env.TYPECHECK_DEBUG) {
        console.error(e.stack);
      }
    }
    while (annotation && annotation.type === 'TypeAnnotation') {
      annotation = annotation.typeAnnotation;
    }
    return annotation || t.anyTypeAnnotation();
  }

  function getAnnotationShallow (path: NodePath): ?TypeAnnotation {
    if (!path || !path.node) {
      return t.voidTypeAnnotation();
    }
    const {node, scope} = path;
    if (node.type === 'TypeAlias') {
      return node.right;
    }
    else if (node.type === 'ClassProperty' && node.typeAnnotation) {
      return getClassPropertyAnnotation(path);
    }
    else if (node.type === 'ClassMethod' && node.returnType) {
      return getClassMethodAnnotation(path);
    }
    else if (node.type === 'ObjectProperty' && node.typeAnnotation) {
      return getObjectPropertyAnnotation(path);
    }
    else if (node.type === 'SpreadProperty' && node.typeAnnotation) {
      return getSpreadPropertyAnnotation(path);
    }
    else if (node.type === 'ObjectMethod' && node.returnType) {
      return getObjectMethodAnnotation(path);
    }
    else if (!node.typeAnnotation && !node.savedTypeAnnotation && !node.returnType) {
      switch (path.type) {
        case 'Identifier':
          const binding = scope.getBinding(node.name);
          if (!binding || !binding.identifier) {
            return path.getTypeAnnotation();
          }
          const id = binding.identifier;
          if (binding.path.type === 'ObjectPattern') {
            return getObjectPatternAnnotation(binding.path, node.name);
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
          return binding.constant ? binding.path.getTypeAnnotation() : path.getTypeAnnotation();
        case 'StringLiteral':
        case 'NumericLiteral':
        case 'BooleanLiteral':
          return createLiteralTypeAnnotation(path);
        case 'CallExpression':
          const callee = path.get('callee');
          if (callee.type === 'Identifier') {
            if (callee.name === 'Symbol') {
              return t.genericTypeAnnotation('Symbol');
            }
            const fn = getFunctionForIdentifier(callee);
            if (fn) {
              return getAnnotation(fn);
            }
          }
          break;
        case 'ThisExpression':
          return getThisExpressionAnnotation(path);
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
        case 'LogicalExpression':
          return getLogicalExpressionAnnotation(path);
        case 'ConditionalExpression':
          return getConditionalExpressionAnnotation(path);
        case 'ObjectMethod':
          return getObjectMethodAnnotation(path);
        case 'SpreadProperty':
          return getSpreadPropertyAnnotation(path);
        case 'ObjectProperty':
          return getObjectPropertyAnnotation(path);
        case 'ClassDeclaration':
          return getClassDeclarationAnnotation(path);
        case 'ClassMethod':
          return getClassMethodAnnotation(path);
        case 'ClassProperty':
          return getClassPropertyAnnotation(path);
        default:
          return path.getTypeAnnotation();

      }
    }
    return node.savedTypeAnnotation || node.returnType || node.typeAnnotation || path.getTypeAnnotation();
  }

  function createLiteralTypeAnnotation (path: NodePath): ?TypeAnnotation {
    let annotation;
    if (path.isStringLiteral()) {
      annotation = t.stringLiteralTypeAnnotation();
    }
    else if (path.isNumericLiteral()) {
      annotation = t.numericLiteralTypeAnnotation();
    }
    else if (path.isBooleanLiteral()) {
      annotation = t.booleanLiteralTypeAnnotation();
    }
    else {
      return path.getTypeAnnotation();
    }
    annotation.value = path.node.value;
    return annotation;
  }

  function getObjectPatternAnnotation (path: NodePath, name: string): ?TypeAnnotation {
    let annotation = keyByName(getAnnotation(path), name);
    let found;
    if (!path.node.properties) {
      return;
    }
    for (let prop of path.get('properties')) {
      if (prop.node.value && prop.node.value.name === name) {
        found = prop.get('key');
        break;
      }
      else if (prop.node.key.type === 'Identifier' && prop.node.key.name === name) {
        found = prop.get('key');
        break;
      }
    }
    if (!annotation || !found) {
      return;
    }
    if (found.type === 'Identifier') {
      annotation.value.authoritative = false;
      return annotation.value;
    }
  }


  function keyByName (node: Node, name: string): ?Node {
    if (!node.properties) {
      return;
    }
    for (let prop of node.properties) {
      if (prop.key && prop.key.name === name) {
        return prop;
      }
    }
  }

  function valueByName (node: Node, name: string): ?Node {
    if (!node.properties) {
      return;
    }
    for (let prop of node.properties) {
      if (prop.value && prop.value.name === name) {
        return prop;
      }
    }
  }

  function getSpreadPropertyAnnotation (path: NodePath): ?TypeAnnotation {
    const {node} = path;
    let annotation = node.typeAnnotation || node.savedTypeAnnotation;
    if (!annotation) {
      annotation = getAnnotation(path.get('argument'));
    }
    return annotation;
  }

  function getObjectPropertyAnnotation (path: NodePath): ?TypeAnnotation {
    const {node} = path;
    let annotation = node.typeAnnotation || node.savedTypeAnnotation;
    if (!annotation) {
      if (node.value) {
        if(node.value.typeAnnotation || node.value.savedTypeAnnotation) {
          annotation = node.value.typeAnnotation || node.value.savedTypeAnnotation;
        }
        else if (node.value.type === 'BooleanLiteral' || node.value.type === 'NumericLiteral' || node.value.type === 'StringLiteral') {
          annotation = t[node.value.type](node.value.value)
        }
        else {
          annotation = t.anyTypeAnnotation()
        }
      }
      else {
        annotation = t.anyTypeAnnotation();
      }
    }
    return t.objectTypeProperty(
      node.key,
      annotation
    );
  }

  function getObjectMethodAnnotation (path: NodePath): ?TypeAnnotation {
    const {node} = path;
    return t.objectTypeProperty(
      t.identifier(node.key.name),
      t.functionTypeAnnotation(
        null,
        node.params.map(param => param.savedTypeAnnotation || param.typeAnnotation),
        null,
        node.savedTypeAnnotation || node.returnType || node.typeAnnotation || t.anyTypeAnnotation()
      )
    );
  }

  function getThisExpressionAnnotation (path: NodePath): ?TypeAnnotation {
    let parent = path.parentPath;
    loop: while (parent) {
      switch (parent.type) {
        case 'ClassDeclaration':
          return getAnnotation(parent);
        case 'ClassBody':
          return getAnnotation(parent.parentPath);
        case 'ClassMethod':
        case 'ClassProperty':
          return getAnnotation(parent.parentPath.parentPath);
        case 'ObjectProperty':
          return getAnnotation(parent.parentPath);
        case 'ObjectMethod':
          return getAnnotation(parent.parentPath);
        case 'FunctionExpression':
          if (parent.parentPath.type === 'ObjectProperty') {
            return getAnnotation(parent.parentPath.parentPath);
          }
          break loop;
        case 'ArrowFunctionExpression':
          parent = parent.parentPath;
          continue;
      }
      if (parent.isFunction()) {
        break;
      }
      parent = parent.parentPath;
    }
    return t.objectTypeAnnotation([]);
  }

  function getClassDeclarationAnnotation (path: NodePath): ?TypeAnnotation {
    const body = path.get('body').get('body').map(getAnnotation).filter(annotation => annotation && annotation.type !== 'AnyTypeAnnotation');
    return t.objectTypeAnnotation(body);
  }

  function getAssignmentExpressionAnnotation (path: NodePath): ?TypeAnnotation {
    if (path.node.operator === '=') {
      return getAnnotation(path.get('right'));
    }
  }

  function getClassPropertyAnnotation (path: NodePath): ?TypeAnnotation {
    const {node} = path;
    if (node.computed) {
      return;
    }
    const annotation = node.typeAnnotation || (node.value ? node.value.savedTypeAnnotation || node.value.typeAnnotation : t.anyTypeAnnotation());
    return t.objectTypeProperty(
      node.key,
      annotation || t.anyTypeAnnotation()
    );
  }

  function getClassMethodAnnotation (path: NodePath): ?TypeAnnotation {
    const {node} = path;
    if (node.computed) {
      return;
    }
    if (node.kind === 'get') {
      return t.objectTypeProperty(
        node.key,
        node.savedTypeAnnotation || node.returnType || node.typeAnnotation || t.anyTypeAnnotation()
      );
    }
    else if (node.kind === 'set') {
      return t.objectTypeProperty(
        node.key,
        node.params.map(param => param.savedTypeAnnotation || param.typeAnnotation).shift() || t.anyTypeAnnotation()
      );
    }
    else {
      return t.objectTypeProperty(
        node.key,
        t.functionTypeAnnotation(
          null,
          node.params.map(param => param.savedTypeAnnotation || param.typeAnnotation || t.anyTypeAnnotation()),
          null,
          node.savedTypeAnnotation || node.returnType || node.typeAnnotation || t.anyTypeAnnotation()
        )
      );
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
      t.typeParameterDeclaration(path.get('elements').map(getAnnotation))
    );
  }

  function getObjectExpressionAnnotation (path: NodePath): TypeAnnotation {
    const annotation = t.objectTypeAnnotation(
      path.get('properties')
      .filter(prop => !prop.node.computed)
      .map(getAnnotation)
      .reduce((properties, prop) => {
        if (t.isObjectTypeProperty(prop)) {
          properties.push(prop);
        }
        else if (t.isObjectTypeAnnotation(prop)) {
          properties.push(...prop.properties);
        }
        return properties;
      }, [])
      .filter(annotation => !t.isAnyTypeAnnotation(annotation.value))
    );
    return annotation;
  }

  function getMemberExpressionAnnotation (path: NodePath): TypeAnnotation {
    if (path.node.computed) {
      return getComputedMemberExpressionAnnotation(path);
    }
    const stack = [];
    let target = path;
    while (target.isMemberExpression()) {
      stack.push(target);
      if (target.node.computed) {
        break;
      }
      target = target.get('object');
    }
    const objectAnnotation = stack.reduceRight((last, target) => {
      let annotation = last;
      if (annotation == null) {
        if (stack.length === 1) {
          annotation = getAnnotation(target.get('object'));
        }
        else {
          return getAnnotation(target);
        }
      }

      switch (annotation.type) {
        case 'AnyTypeAnnotation':
          return annotation;
        case 'NullableTypeAnnotation':
        case 'TypeAnnotation':
          annotation = annotation.typeAnnotation;
      }

      if (annotation.type === 'GenericTypeAnnotation') {
        const typeChecker = getTypeChecker(annotation.id, path.scope);
        if (typeChecker) {
          annotation = getAnnotation(typeChecker);
        }
        else if (isPolymorphicType(annotation.id, path.scope)) {
          annotation = t.anyTypeAnnotation();
        }
        else {
          const binding = path.scope.getBinding(annotation.id.name);
          if (binding) {
            annotation = getAnnotation(binding.path);
          }
        }
      }
      switch (annotation.type) {
        case 'AnyTypeAnnotation':
          return annotation;
        case 'ObjectTypeAnnotation':
          const id = target.get('property').node;
          for (let {key, value} of annotation.properties || []) {
            if (key.name === id.name) {
              return (value.type === 'VoidTypeAnnotation' || value.type === 'NullLiteralTypeAnnotation') ? t.anyTypeAnnotation() : value;
            }
          }
      }
      return t.anyTypeAnnotation();
    }, null);

    return objectAnnotation || path.getTypeAnnotation();
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
            throw path.buildCodeFrameError(`Invalid computed member expression for tuple: ` + humanReadableType(objectAnnotation));
          }
          return objectAnnotation.types[value];
        }
        else {
          throw path.buildCodeFrameError(`Invalid computed member expression for tuple: ` + humanReadableType(objectAnnotation));
        }
        break;
    }
    return path.getTypeAnnotation();
  }

  function getFunctionForIdentifier (path: NodePath): boolean|Node {
    if (path.type !== 'Identifier') {
      return false;
    }
    else if (isTypeChecker(path.node, path.scope) || isPolymorphicType(path.node, path.scope)) {
      return false;
    }
    const ref = path.scope.getBinding(path.node.name);
    if (!ref) {
      return false;
    }
    return t.isFunction(ref.path.parent) && ref.path.parentPath;
  }

  /**
   * Determine whether the given annotation is for an array.
   */
  function isStrictlyArrayAnnotation (annotation: TypeAnnotation): ?boolean {
    switch (annotation.type) {
      case 'ArrayTypeAnnotation':
      case 'TupleTypeAnnotation':
        return true;
      case 'TypeAnnotation':
      case 'FunctionTypeParam':
        return isStrictlyArrayAnnotation(annotation.typeAnnotation);
      case 'GenericTypeAnnotation':
        return annotation.id.name === 'Array' ? true : null;
      case 'UnionTypeAnnotation':
        return annotation.types.every(isStrictlyArrayAnnotation);
      default:
        return false;
    }
  }

  function compareMaybeUnion (annotation: TypeAnnotation, comparator: (node: TypeAnnotation) => ?boolean): ?boolean {
    let falseCount = 0;
    for (let type of annotation.types) {
      const result = comparator(type);
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
  }

  /**
   * Returns `true` if the annotation is compatible with a number,
   * `false` if it definitely isn't, or `null` if we're not sure.
   */
  function maybeNumberAnnotation (annotation: TypeAnnotation): ?boolean {
    switch (annotation.type) {
      case 'TypeAnnotation':
      case 'FunctionTypeParam':
      case 'NullableTypeAnnotation':
        return maybeNumberAnnotation(annotation.typeAnnotation);
      case 'NumberTypeAnnotation':
      case 'NumericLiteralTypeAnnotation':
      case 'NumericLiteral':
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
        return compareMaybeUnion(annotation, maybeNumberAnnotation);
      case 'AnyTypeAnnotation':
      case 'MixedTypeAnnotation':
      case 'IntersectionTypeAnnotation':
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
      case 'FunctionTypeParam':
      case 'NullableTypeAnnotation':
        return maybeStringAnnotation(annotation.typeAnnotation);
      case 'StringTypeAnnotation':
      case 'StringLiteral':
        return true;
      case 'StringLiteralTypeAnnotation':
        return null;
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
      case 'IntersectionTypeAnnotation':
        return null;
      default:
        return false;
    }
  }

/**
   * Returns `true` if the annotation is compatible with a symbol,
   * `false` if it definitely isn't, or `null` if we're not sure.
   */
  function maybeSymbolAnnotation (annotation: TypeAnnotation): ?boolean {
    switch (annotation.type) {
      case 'TypeAnnotation':
      case 'FunctionTypeParam':
      case 'NullableTypeAnnotation':
        return maybeSymbolAnnotation(annotation.typeAnnotation);
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
          case 'Symbol':
            return true;
          default:
            return null;
        }
      case 'UnionTypeAnnotation':
        let falseCount = 0;
        for (let type of annotation.types) {
          const result = maybeSymbolAnnotation(type);
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
      case 'IntersectionTypeAnnotation':
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
      case 'FunctionTypeParam':
      case 'NullableTypeAnnotation':
        return maybeBooleanAnnotation(annotation.typeAnnotation);
      case 'BooleanTypeAnnotation':
      case 'BooleanLiteralTypeAnnotation':
      case 'BooleanLiteral':
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
      case 'IntersectionTypeAnnotation':
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
      case 'FunctionTypeParam':
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
      case 'IntersectionTypeAnnotation':
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
      case 'NullLiteralTypeAnnotation':
      case 'MixedTypeAnnotation':
        return true;
      case 'TypeAnnotation':
      case 'FunctionTypeParam':
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
          case 'Generator':
            if (annotation.typeParameters && annotation.typeParameters.params.length > 1) {
              return maybeNullableAnnotation(annotation.typeParameters.params[1]);
            }
            else {
              return null;
            }
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
  function maybeInstanceOfAnnotation (annotation: TypeAnnotation, expected: Identifier, typeParameters: TypeAnnotation[]): ?boolean {
    switch (annotation.type) {
      case 'TypeAnnotation':
      case 'FunctionTypeParam':
      case 'NullableTypeAnnotation':
        return maybeInstanceOfAnnotation(annotation.typeAnnotation, expected, typeParameters);
      case 'GenericTypeAnnotation':
        if (annotation.id.name === expected.name) {
          if (typeParameters.length === 0) {
            return true;
          }
          if (annotation.typeParameters && annotation.typeParameters.params.length) {
            let trueCount = 0;
            let nullCount = 0;
            for (let i = 0; i < typeParameters.length && i < annotation.typeParameters.params.length; i++) {
              const result = compareAnnotations(typeParameters[i], annotation.typeParameters.params[i]);
              if (result === false) {
                return false;
              }
              else if (result === true) {
                trueCount++;
              }
              else {
                nullCount++;
              }
            }
            return trueCount > 0 && nullCount === 0 ? true : null;
          }
        }
        return null;
      case 'UnionTypeAnnotation':
        let falseCount = 0;
        for (let type of annotation.types) {
          const result = maybeInstanceOfAnnotation(type, expected, typeParameters);
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
      case 'NullLiteralTypeAnnotation':
        if (expected.name === 'Array' || expected.name === 'RegExp' || expected.name === 'Error' || expected.name === 'Function' || expected.name === 'String' || expected.name === 'Object') {
          return false;
        }
        else {
          return null;
        }
      case 'BooleanTypeAnnotation':
      case 'BooleanLiteralTypeAnnotation':
      case 'StringTypeAnnotation':
      case 'StringLiteralTypeAnnotation':
      case 'NumberTypeAnnotation':
      case 'NumericLiteralTypeAnnotation':
        if (expected.name === 'Array' || expected.name === 'RegExp' || expected.name === 'Error' || expected.name === 'Function') {
          return false;
        }
        else {
          return null;
        }
      case 'FunctionTypeAnnotation':
        if (expected.name === 'Function') {
          return true;
        }
        else {
          return null;
        }
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
      case 'FunctionTypeParam':
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
      case 'IntersectionTypeAnnotation':
        return null;
      default:
        return false;
    }
  }

  /**
   * Returns `true` if the annotation is compatible with an iterable,
   * `false` if it definitely isn't, or `null` if we're not sure.
   */
  function maybeIterableAnnotation (annotation: TypeAnnotation): ?boolean {
    switch (annotation.type) {
      case 'TypeAnnotation':
      case 'FunctionTypeParam':
      case 'NullableTypeAnnotation':
        return maybeIterableAnnotation(annotation.typeAnnotation);
      case 'TupleTypeAnnotation':
      case 'ArrayTypeAnnotation':
        return true;
      case 'GenericTypeAnnotation':
        return annotation.id.name === 'Iterable' ? true : null;
      case 'UnionTypeAnnotation':
        let falseCount = 0;
        for (let type of annotation.types) {
          const result = maybeIterableAnnotation(type);
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
      case 'BooleanTypeAnnotation':
      case 'BooleanLiteralTypeAnnotation':
      case 'NumericLiteralTypeAnnotation':
      case 'NumberTypeAnnotation':
      case 'VoidTypeAnnotation':
      case 'NullLiteralTypeAnnotation':
        return false;
      default:
        return null;
    }
  }

  /**
   * Returns `true` if the annotation is compatible with a tuple,
   * `false` if it definitely isn't, or `null` if we're not sure.
   */
  function maybeTupleAnnotation (annotation: TypeAnnotation): ?boolean {
    switch (annotation.type) {
      case 'TypeAnnotation':
      case 'FunctionTypeParam':
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
      case 'IntersectionTypeAnnotation':
        return null;
      default:
        return false;
    }
  }

  function humanReadableType (annotation: Node|TypeAnnotation): string {
    switch (annotation.type) {
      case 'TypeAnnotation':
      case 'FunctionTypeParam':
        return humanReadableType(annotation.typeAnnotation);

      case 'FunctionTypeAnnotation':
        // @fixme babel doesn't seem to like generating FunctionTypeAnnotations yet
        return `(${annotation.params.map(humanReadableType).join(', ')}) => ${humanReadableType(annotation.returnType)}`;
      case 'GenericTypeAnnotation':
        const path = getNodePath(annotation);
        const checker = path && getTypeChecker(annotation.id, path.scope);
        if (checker && checker.node.savedTypeAnnotation) {
          return humanReadableType(checker.node.savedTypeAnnotation);
        }
        else {
          return generate(annotation).code;
        }
      default:
        return generate(annotation).code;
    }
  }

  /**
   * Get the path directly from a node.
   */
  function getNodePath (node: Node): ?NodePath {
    if (node._paths && node._paths.length) {
      return node._paths[0];
    }
    else {
      return null;
    }
  }

  function getTypeChecker (id: Identifier|QualifiedTypeIdentifier, scope: Scope): NodePath|false {
    const checker = scope.getData(`typechecker:${id.name}`);
    if (checker) {
      return checker;
    }
    return false;
  }

  function isTypeChecker (id: Identifier|QualifiedTypeIdentifier, scope: Scope): boolean {
    return scope.getData(`typechecker:${id.name}`) !== undefined;
  }

  function isPolymorphicType (id: Identifier|QualifiedTypeIdentifier, scope: Scope): boolean {
    return scope.getData(`typeparam:${id.name}`) !== undefined;
  }

  function getPolymorphicType (id: Identifier|QualifiedTypeIdentifier, scope: Scope): ?Node {
    const path = scope.getData(`typeparam:${id.name}`);
    if (path) {
      return path.node;
    }
  }

  function collectParamChecks (path: NodePath, context: VisitorContext): Node[] {
    return path.get('params').map((param) => {
      const {node} = param;
      if (node.type === 'AssignmentPattern') {
        if (node.left.typeAnnotation) {
          return createDefaultParamGuard(param, context);
        }
      }
      else if (node.type === 'RestElement') {
        if (node.typeAnnotation) {
          return createRestParamGuard(param, context);
        }
      }
      else if (node.typeAnnotation) {
        return createParamGuard(param, context);
      }
    }).filter(identity);
  }

  function createParamGuard (path: NodePath, context: VisitorContext): ?Node {
    const {node, scope} = path;
    node.hasBeenTypeChecked = true;
    node.savedTypeAnnotation = node.typeAnnotation;
    let checkable;
    if (node.type === 'ObjectPattern') {
      node.name = path.key;
      checkable = t.memberExpression(t.identifier('arguments'), t.numericLiteral(path.key), true);
    }
    else {
      checkable = node;
    }
    let check = checkAnnotation(checkable, node.typeAnnotation, scope);
    if (!check) {
      return;
    }
    if (node.optional) {
      check = t.logicalExpression(
        '||',
        checks.undefined({input: checkable}),
        check
      );
    }
    const message = paramTypeErrorMessage(checkable, context, node.typeAnnotation);
    return guard({
      check,
      message
    });
  }

  function createDefaultParamGuard (path: NodePath, context: VisitorContext): ?Node {
    const {node, scope} = path;
    const {left: id, right: value} = node;
    const ok = staticCheckAnnotation(path.get('right'), id.typeAnnotation);
    if (ok === false) {
      throw path.buildCodeFrameError(
        buildErrorMessage(
          `Invalid default value for argument "${id.name}".`,
          id.typeAnnotation,
          getAnnotation(path.get('right'))
        )
      );
    }
    return createParamGuard(path.get('left'), context);
  }

  function createRestParamGuard (path: NodePath, context: VisitorContext): ?Node {
    const {node, scope} = path;
    const {argument: id} = node;
    id.hasBeenTypeChecked = true;
    node.savedTypeAnnotation = node.typeAnnotation;
    if (isStrictlyArrayAnnotation(node.typeAnnotation) === false) {
      throw path.buildCodeFrameError(
        buildErrorMessage(
          `Invalid type annotation for rest argument "${id.name}".`,
          t.genericTypeAnnotation(t.identifier('Array')),
          node.typeAnnotation
        )
      );
    }
    let check = checkAnnotation(id, node.typeAnnotation, scope);
    if (!check) {
      return;
    }
    if (node.optional) {
      check = t.logicalExpression(
        '||',
        checks.undefined({input: id}),
        check
      );
    }
    const message = paramTypeErrorMessage(id, context, node.typeAnnotation);
    return guard({
      check,
      message
    });
  }

  function returnTypeErrorMessage (path: NodePath, fn: Node, id: ?Identifier|Literal, context: VisitorContext): Node {
    const {node, scope} = path;
    const name = fn.id ? fn.id.name : '';
    let annotation = fn.returnType;
    if (annotation.type === 'TypeAnnotation') {
      annotation = annotation.typeAnnotation;
    }
    if (fn.generator && isGeneratorAnnotation(annotation) && annotation.typeParameters && annotation.typeParameters.params.length > 1) {
      annotation = annotation.typeParameters.params[1];
    }
    const message = `Function ${name ? `"${name}" ` : ''}return value violates contract.\n\nExpected:\n${humanReadableType(annotation)}\n\nGot:\n`;

    return t.binaryExpression(
      '+',
      t.stringLiteral(message),
      id ? readableName({inspect: context.inspect, input: id}) : node.argument ? readableName({inspect: context.inspect, input: node.argument}) : t.stringLiteral('undefined')
    );
  }

  function yieldTypeErrorMessage (fn: Node, annotation: TypeAnnotation, id: Identifier|Literal, context: VisitorContext): Node {
    const name = fn.id ? fn.id.name : '';
    const message = `Function ${name ? `"${name}" ` : ''}yielded an invalid value.\n\nExpected:\n${humanReadableType(annotation)}\n\nGot:\n`;

    return t.binaryExpression(
      '+',
      t.stringLiteral(message),
      readableName({inspect: context.inspect, input: id})
    );
  }
  function yieldNextTypeErrorMessage (fn: Node, annotation: TypeAnnotation, id: Identifier|Literal, context: VisitorContext): Node {
    const name = fn.id ? fn.id.name : '';
    const message = `Generator ${name ? `"${name}" ` : ''}received an invalid next value.\n\nExpected:\n${humanReadableType(annotation)}\n\nGot:\n`;

    return t.binaryExpression(
      '+',
      t.stringLiteral(message),
      readableName({inspect: context.inspect, input: id})
    );
  }

  function paramTypeErrorMessage (node: Node, context: VisitorContext, typeAnnotation: TypeAnnotation = node.typeAnnotation): Node {
    let name = node.name;
    if (node.type === 'MemberExpression' && node.object.name === 'arguments') {
      name = node.property.value;
    }
    const message = `Value of ${node.optional ? 'optional ' : ''}argument ${JSON.stringify(name)} violates contract.\n\nExpected:\n${humanReadableType(typeAnnotation)}\n\nGot:\n`;

    return t.binaryExpression(
      '+',
      t.stringLiteral(message),
      readableName({inspect: context.inspect, input: node})
    );
  }

  function varTypeErrorMessage (node: Node, context: VisitorContext): Node {
    const annotation: TypeAnnotation = node.typeAnnotation;
    if (node.type === 'Identifier') {
      const name = node.name;
      const message = `Value of variable "${name}" violates contract.\n\nExpected:\n${humanReadableType(annotation)}\n\nGot:\n`;
      return t.binaryExpression(
        '+',
        t.stringLiteral(message),
        readableName({inspect: context.inspect, input: node})
      );
    }
    else {
      const message = `Value of "${humanReadableType(node)}" violates contract.\n\nExpected:\n${humanReadableType(annotation)}\n\nGot:\n`;
      return t.binaryExpression(
        '+',
        t.stringLiteral(message),
        readableName({inspect: context.inspect, input: node})
      );
    }
  }

  /**
   * Create a React property validator
   */
  function generatePropType (annotation: TypeAnnotation, scope: Scope, context: VisitorContext) {
    const prop = t.identifier('prop');
    const check = checkAnnotation(prop, annotation, scope);
    if (check) {
      return propType({
        check,
        prop,
        expected: t.stringLiteral(humanReadableType(annotation)),
        got: readableName({inspect: context.inspect, input: prop})
      });
    } else {
      return t.functionExpression(null, [], t.blockStatement([]));
    }
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
   * Determine whether the file should be checked
   */
  function mustCheckFile(path: NodePath, opts): boolean {
    if (path.node.leadingComments && path.node.leadingComments.length) {
      return opts.only && !skipEnvironment(path.node.leadingComments, opts);
    }
    return false;
  }
  /**
   * Determine whether the file should be skipped, based on the comments attached to the given node.
   */
  function maybeSkipFile (path: NodePath, opts): boolean {
    if (path.node.leadingComments && path.node.leadingComments.length) {
      if (skipEnvironment(path.node.leadingComments, opts)) {
        return true;
      }
      return path.node.leadingComments.some(comment => PRAGMA_IGNORE_FILE.test(comment.value));
    }
    return false;
  }

  /**
   * Maybe skip the given path if it has a relevant pragma.
   */
  function maybeSkip (path: NodePath): boolean {
    const {node} = path;
    if (node.hasBeenTypeChecked) {
      return true;
    }
    if (node.leadingComments && node.leadingComments.length) {
      const comment = node.leadingComments[node.leadingComments.length - 1];
      if (PRAGMA_IGNORE_STATEMENT.test(comment.value)) {
        path.skip();
        return true;
      }
    }
    return false;
  }

  /**
   * A function that returns its first argument, useful when filtering.
   */
  function identity <T> (input: T): T {
    return input;
  }

  function getExpression (node: Node): Node {
    return t.isExpressionStatement(node) ? node.expression : node;
  }

  function expression (input: string): Function {
    const fn: Function = template(input);
    return function (...args) {
      const node: Node = fn(...args);
      return getExpression(node);
    };
  }
}
