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
  // constants used when statically verifying types
  const TYPE_INVALID = 0;
  const TYPE_VALID = 1;
  const TYPE_UNKNOWN = 2;

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
  const checkIsObject: (() => Node) = expression(`input != null && typeof input === 'object'`);
  const checkNotNull: (() => Node) = expression(`input != null`);
  const checkEquals: (() => Node) = expression(`input === expected`);

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

  const readableName: (() => Node) = expression(`
    input === null ? 'null' : typeof input === 'object' && input.constructor ? input.constructor.name || '[Unknown Object]' : typeof input
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

  const PRAGMA_IGNORE_STATEMENT = /typecheck:\s*ignore\s+statement/i;
  const PRAGMA_IGNORE_FILE = /typecheck:\s*ignore\s+file/i;

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
        path.replaceWith(t.exportNamedDeclaration(
          createTypeAliasChecks(path.get('declaration')),
          [],
          null
        ));
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

    Function: {
      enter (path: NodePath): void {
        if (maybeSkip(path)) {
          return;
        }

        const {node, scope} = path;
        const paramChecks = collectParamChecks(path);
        if (node.type === "ArrowFunctionExpression" && node.expression) {
          node.expression = false;
          node.body = t.blockStatement([t.returnStatement(node.body)]);
        }
        node.body.body.unshift(...paramChecks);
        node.savedTypeAnnotation = node.returnType;
        node.returnCount = 0;
      },
      exit (path: NodePath): void {
        const {node, scope} = path;
        const isVoid = node.savedTypeAnnotation ? maybeNullableAnnotation(node.savedTypeAnnotation) : null;
        if (!node.returnCount && isVoid === false) {
          throw path.buildCodeFrameError(`Function ${node.id ? `"${node.id.name}" ` : ''}did not return a value, expected ${humanReadableType(node.savedTypeAnnotation)}`);
        }
      }
    },

    ReturnStatement (path: NodePath): void {
      if (maybeSkip(path)) {
        return;
      }
      const {node, parent, scope} = path;
      const fn = path.getFunctionParent();
      if (!fn) {
        return;
      }
      fn.node.returnCount++;
      if (node.isTypeChecked) {
        return;
      }
      const {returnType} = fn.node;
      if (!returnType) {
        return;
      }
      if (!node.argument) {
        if (maybeNullableAnnotation(returnType) === false) {
          throw path.buildCodeFrameError(`Function ${fn.node.id ? `"${fn.node.id.name}" ` : ''}did not return a value, expected ${humanReadableType(returnType)}`);
        }
        return;
      }
      let id;
      if (node.argument.type === 'Identifier' || t.isLiteral(node.argument)) {
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
        throw path.buildCodeFrameError(`Invalid return type, expected ${humanReadableType(returnType)} got ${humanReadableType(getAnnotation(path.get('argument')))}`);
      }
      const check = checkAnnotation(id, returnType, scope);
      if (!check) {
        return;
      }
      if (parent.type !== 'BlockStatement' && parent.type !== 'Program') {
        const block = [];
        if (node.argument.type !== 'Identifier' && !t.isLiteral(node.argument)) {
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
          message: returnTypeErrorMessage(path, fn.node, id)
        }));
        path.replaceWith(t.blockStatement(block));
      }
      else {
        if (node.argument.type !== 'Identifier' && !t.isLiteral(node.argument)) {
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
          message: returnTypeErrorMessage(path, fn.node, id)
        }));
      }
    },

    VariableDeclaration (path: NodePath): void {
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
          throw path.buildCodeFrameError(`Invalid assignment value, expected ${humanReadableType(id.typeAnnotation)} got ${humanReadableType(getAnnotation(declarations[i]))}`);
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
        else if (path.parent.type === 'ExportNamedDeclaration' || path.parent.type === 'ExportDefaultDeclaration' || path.parent.type === 'ExportAllDeclaration' || path.parentPath.isForXStatement()) {
          path.parentPath.insertAfter(check);
        }
        else {
          path.replaceWith(t.blockStatement([node, check]));
        }
      }
    },

    AssignmentExpression (path: NodePath): void {
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
        annotation = getAnnotation(right);
        if (allowsAny(annotation)) {
          return;
        }
      }
      const ok = staticCheckAnnotation(right, annotation);
      if (ok === true) {
        return;
      }
      else if (ok === false) {
        throw path.buildCodeFrameError(`Invalid assignment value, expected ${humanReadableType(annotation)} got ${humanReadableType(getAnnotation(right))}`);
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
  };


  return {
    visitor: {
      Program (path: NodePath) {
        for (let child of path.get('body')) {
          if (maybeSkipFile(child)) {
            return;
          }
        }
        path.traverse(visitors);
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

  function createChecks (): Object {
    return {
      number: expression(`typeof input === 'number'`),
      numericLiteral: checkNumericLiteral,
      boolean: expression(`typeof input === 'boolean'`),
      booleanLiteral: checkBooleanLiteral,
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
      tuple: checkTuple,
      object: checkObject,
      nullable: checkNullable,
      typeof: checkTypeof
    };
  }

  function createStaticChecks (): Object {
    return {
      symbol (path: NodePath): ?boolean {
        return maybeSymbolAnnotation(getAnnotation(path));
      },
      instanceof ({path, type}): ?boolean {
        const {node, scope} = path;
        if (type.name === 'Object' && node.type === 'ObjectExpression' && !scope.hasBinding('Object')) {
          return true;
        }
        else if (type.name === 'Map' && !scope.hasBinding('Map')) {
          return null;
        }
        else if (type.name === 'Set' && !scope.hasBinding('Set')) {
          return null;
        }
        return maybeInstanceOfAnnotation(getAnnotation(path), type);
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
      case 'StringLiteralTypeAnnotation':
        return compareStringLiteralAnnotations(a, b);
      case 'NumberTypeAnnotation':
        return maybeNumberAnnotation(b);
      case 'NumericLiteralTypeAnnotation':
        return compareNumericLiteralAnnotations(a, b);
      case 'BooleanTypeAnnotation':
        return maybeBooleanAnnotation(b);
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
    if (b.type === 'StringLiteralTypeAnnotation') {
      return a.value === b.value;
    }
    else {
      return maybeStringAnnotation(b);
    }
  }

  function compareBooleanLiteralAnnotations (a: BooleanLiteralTypeAnnotation, b: TypeAnnotation): ?boolean {
    if (b.type === 'BooleanLiteralTypeAnnotation') {
      return a.value === b.value;
    }
    else {
      return maybeBooleanAnnotation(b);
    }
  }

  function compareNumericLiteralAnnotations (a: NumericLiteralTypeAnnotation, b: TypeAnnotation): ?boolean {
    if (b.type === 'NumericLiteralTypeAnnotation') {
      return a.value === b.value;
    }
    else {
      return maybeNumberAnnotation(b);
    }
  }

  function unionComparer (a: TypeAnnotation, b: TypeAnnotation, comparator: (a:TypeAnnotation, b:TypeAnnotation) => ?boolean): ?boolean {
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
      case 'FunctonTypeParam':
      case 'NullableTypeAnnotation':
        return compareObjectAnnotation(a, b.typeAnnotation);
      case 'UnionTypeAnnotation':
        return unionComparer(a, b, compareObjectAnnotation);
      case 'IntersectionTypeAnnotation':
        return intersectionComparer(a, b, compareObjectAnnotation);
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

    // We're comparing two object annotations.
    let allTrue = true;
    for (let aprop of a.properties) {
      let found = false;
      for (let bprop of b.properties) {
        if (bprop.key.name === aprop.key.name) {
          const result = compareAnnotations(aprop.value, bprop.value);
          if (result === false) {
            return false;
          }
          else {
            found = result;
          }
          break;
        }
      }
      if (found === false) {
        return false;
      }
      allTrue = allTrue && found === true;
    }
    return allTrue ? true : null;
  }

  function compareArrayAnnotation (a: Node, b: Node): ?boolean {
    switch (b.type) {
      case 'TypeAnnotation':
      case 'FunctonTypeParam':
      case 'NullableTypeAnnotation':
        return compareArrayAnnotation(a, b.typeAnnotation);
      case 'UnionTypeAnnotation':
        return unionComparer(a, b, compareArrayAnnotation);
      case 'IntersectionTypeAnnotation':
        return intersectionComparer(a, b, compareArrayAnnotation);
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
      case 'FunctonTypeParam':
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
      case 'FunctonTypeParam':
      case 'NullableTypeAnnotation':
        return compareTupleAnnotation(a, b.typeAnnotation);
      case 'UnionTypeAnnotation':
        return unionComparer(a, b, compareTupleAnnotation);
      case 'IntersectionTypeAnnotation':
        return intersectionComparer(a, b, compareTupleAnnotation);
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
      case 'FunctonTypeParam':
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

  function checkObject ({input, properties, scope}): Node {
    const check = properties.reduce((expr, prop, index) => {
      const target = t.memberExpression(input, prop.key);
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
    }, checkIsObject({input}));

    return check;
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
      case 'FunctonTypeParam':
        return checkAnnotation(input, annotation.typeAnnotation, scope);
      case 'TypeofTypeAnnotation':
        return checks.typeof({input, annotation: annotation.argument, scope});
      case 'GenericTypeAnnotation':
        if (annotation.id.name === 'Array') {
          return checks.array({input, types: annotation.typeParameters ? annotation.typeParameters.params : [], scope});
        }
        else if (annotation.id.name === 'Map' && !scope.hasBinding('Map')) {
          return checks.map({input, types: annotation.typeParameters ? annotation.typeParameters.params : [], scope});
        }
        else if (annotation.id.name === 'Set' && !scope.hasBinding('Set')) {
          return checks.set({input, types: annotation.typeParameters ? annotation.typeParameters.params : [], scope});
        }
        else if (annotation.id.name === 'Function') {
          return checks.function({input});
        }
        else if (annotation.id.name === 'Symbol') {
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
        return checks.object({input, properties: annotation.properties, indexers: annotation.indexers, scope});
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
        return checks.void({input});
    }
  }

  function staticCheckAnnotation (path: NodePath, annotation: TypeAnnotation): ?boolean {
    const other = getAnnotation(path);
    switch (annotation.type) {
      case 'TypeAnnotation':
      case 'FunctonTypeParam':
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
          return staticChecks.instanceof({path, type: createTypeExpression(annotation.id)});
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
      else {
        console.log(e.stack);
      }
    }
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
    else if (node.type === 'ClassProperty' && node.typeAnnotation) {
      return getClassPropertyAnnotation(path);
    }
    else if (node.type === 'ClassMethod' && node.returnType) {
      return getClassMethodAnnotation(path);
    }
    else if (node.type === 'ObjectProperty' && node.typeAnnotation) {
      return getObjectPropertyAnnotation(path);
    }
    else if (node.type === 'ObjectMethod' && node.returnType) {
      return getObjectMethodAnnotation(path);
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
          return path.getTypeAnnotation();
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
        case 'BinaryExpression':
          return getBinaryExpressionAnnotation(path);
        case 'LogicalExpression':
          return getLogicalExpressionAnnotation(path);
        case 'ConditionalExpression':
          return getConditionalExpressionAnnotation(path);
        case 'ObjectMethod':
          return getObjectMethodAnnotation(path);
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

  function getObjectPropertyAnnotation (path: NodePath): ?TypeAnnotation {
    const {node} = path;
    const annotation = node.typeAnnotation || (node.value ? node.value.savedTypeAnnotation || node.value.typeAnnotation : t.anyTypeAnnotation());
    return t.objectTypeProperty(
      t.identifier(node.key.name),
      annotation || t.anyTypeAnnotation()
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
    while (parent) {
      switch (parent.type) {
        case 'ClassDeclaration':
          return getAnnotation(parent);
        case 'ObjectProperty':
          console.log('FIXME', parent);
          break;
        case 'FunctionDeclaration':
          break;
      }
      parent = parent.parentPath;
    }
  }

  function getClassDeclarationAnnotation (path: NodePath): ?TypeAnnotation {
    const body = path.get('body').get('body').map(getAnnotation);
    return t.objectTypeAnnotation(body);
  }

  function getAssignmentExpressionAnnotation (path: NodePath): ?TypeAnnotation {
    if (path.node.operator === '=') {
      return getAnnotation(path.get('right'));
    }
  }

  function getClassPropertyAnnotation (path: NodePath): ?TypeAnnotation {
    const {node} = path;
    const annotation = node.typeAnnotation || (node.value ? node.value.savedTypeAnnotation || node.value.typeAnnotation : t.anyTypeAnnotation());
    return t.objectTypeProperty(
      t.identifier(node.key.name),
      annotation || t.anyTypeAnnotation()
    );
  }

  function getClassMethodAnnotation (path: NodePath): ?TypeAnnotation {
    const {node} = path;
    if (node.kind === 'get') {
      return t.objectTypeProperty(
        t.identifier(node.key.name),
        node.savedTypeAnnotation || node.returnType || node.typeAnnotation || t.anyTypeAnnotation()
      );
    }
    else if (node.kind === 'set') {
      return t.objectTypeProperty(
        t.identifier(node.key.name),
        node.params.map(param => param.savedTypeAnnotation || param.typeAnnotation).shift() || t.anyTypeAnnotation()
      );
    }
    else {
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
      path.get('properties').map(property => {
        if (property.computed) {
          return;
        }
        else {
          return getAnnotation(property);
        }
      }).filter(identity)
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
      if (annotation === null) {
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
          for (let {key, value} of annotation.properties) {
            if (key.name === id.name) {
              return value;
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
      case 'FunctonTypeParam':
        return isStrictlyArrayAnnotation(annotation.typeAnnotation);
      case 'GenericTypeAnnotation':
        return annotation.id.name === 'Array';
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
      case 'FunctonTypeParam':
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
      case 'FunctonTypeParam':
      case 'NullableTypeAnnotation':
        return maybeStringAnnotation(annotation.typeAnnotation);
      case 'StringTypeAnnotation':
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
      case 'FunctonTypeParam':
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
      case 'FunctonTypeParam':
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
      case 'FunctonTypeParam':
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
      case 'MixedTypeAnnotation':
        return true;
      case 'TypeAnnotation':
      case 'FunctonTypeParam':
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
      case 'FunctonTypeParam':
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
      case 'FunctonTypeParam':
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
   * Returns `true` if the annotation is compatible with a tuple,
   * `false` if it definitely isn't, or `null` if we're not sure.
   */
  function maybeTupleAnnotation (annotation: TypeAnnotation): ?boolean {
    switch (annotation.type) {
      case 'TypeAnnotation':
      case 'FunctonTypeParam':
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

  function humanReadableType (annotation: TypeAnnotation): string {
    switch (annotation.type) {
      case 'TypeAnnotation':
      case 'FunctonTypeParam':
        return humanReadableType(annotation.typeAnnotation);

      case 'FunctionTypeAnnotation':
        // @fixme babel doesn't seem to like generating FunctionTypeAnnotations yet
        return `(${annotation.params.map(humanReadableType).join(', ')}) => ${humanReadableType(annotation.returnType)}`;
      default:
        return generate(annotation).code;
    }
  }

  function getTypeChecker (id: Identifier|QualifiedTypeIdentifier, scope: Scope): NodePath|false {
    const binding = scope.getBinding(id.name);
    if (binding === undefined) {
      return false;
    }
    const {path} = binding;
    if (path == null) {
      return false;
    }
    else if (path.type === 'TypeAlias') {
      return path;
    }
    else if (path.type === 'VariableDeclaration' && path.node.isTypeChecker) {
      return path.get('declarations')[0];
    }
    else if (path.isImportSpecifier() && path.parent.importKind === 'type') {
      return path;
    }
    return false;
  }

  function isTypeChecker (id: Identifier|QualifiedTypeIdentifier, scope: Scope): boolean {
    const binding = scope.getBinding(id.name);
    if (binding === undefined) {
      return false;
    }
    const {path} = binding;
    if (path == null) {
      return false;
    }
    else if (path.type === 'TypeAlias' || (path.type === 'VariableDeclaration' && path.node.isTypeChecker)) {
      return true;
    }
    else if (path.isImportSpecifier() && path.parent.importKind === 'type') {
      return true;
    }
    return false;
  }

  function isPolymorphicType (id: Identifier|QualifiedTypeIdentifier, scope: Scope): boolean {
    const binding = scope.getBinding(id.name);
    if (binding !== undefined) {
      return false;
    }
    let {path} = scope;
    while (path && path.type !== 'Program') {
      const {node} = path;
      if ((t.isFunction(node) || t.isClass(node)) && node.typeParameters) {
        for (let param of node.typeParameters.params) {
          param.isPolymorphicType = true;
          if (param.name === id.name) {
            return true;
          }
        }
      }
      path = path.parentPath;
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

  function collectParamChecks (path: NodePath): Node[] {
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
        checks.undefined({input: node}),
        check
      );
    }
    const message = paramTypeErrorMessage(node, scope);
    return guard({
      check,
      message
    });
  }

  function createDefaultParamGuard (path: NodePath): ?Node {
    const {node, scope} = path;
    const {left: id, right: value} = node;
    const ok = staticCheckAnnotation(path.get('right'), id.typeAnnotation);
    if (ok === false) {
      throw path.buildCodeFrameError(`Invalid default value for argument "${id.name}", expected ${humanReadableType(id.typeAnnotation)}.`);
    }
    return createParamGuard(path.get('left'));
  }

  function createRestParamGuard (path: NodePath): ?Node {
    const {node, scope} = path;
    const {argument: id} = node;
    id.hasBeenTypeChecked = true;
    node.savedTypeAnnotation = node.typeAnnotation;
    if (!isStrictlyArrayAnnotation(node.typeAnnotation)) {
      throw path.buildCodeFrameError(`Invalid type annotation for rest argument "${id.name}", expected an Array, got: ${humanReadableType(node.typeAnnotation)}.`);
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
    const message = paramTypeErrorMessage(id, scope, node.typeAnnotation);
    return guard({
      check,
      message
    });
  }

  function returnTypeErrorMessage (path: NodePath, fn: Node, id: ?Identifier|Literal): Node {
    const {node, scope} = path;
    const name = fn.id ? fn.id.name : '';
    const message = `Function ${name ? `"${name}" ` : ''}return value violates contract, expected ${humanReadableType(fn.returnType)} got `;

    return t.binaryExpression(
      '+',
      t.stringLiteral(message),
      node.argument ? readableName({input: id || node.argument}) : t.stringLiteral('undefined')
    );
  }

  function paramTypeErrorMessage (node: Node, scope: Scope, typeAnnotation: TypeAnnotation = node.typeAnnotation): Node {
    const name = node.name;
    const message = `Value of ${node.optional ? 'optional ' : ''}argument "${name}" violates contract, expected ${humanReadableType(typeAnnotation)} got `;

    return t.binaryExpression(
      '+',
      t.stringLiteral(message),
      readableName({input: node})
    );
  }

  function varTypeErrorMessage (node: Node, scope: Scope, annotation?: TypeAnnotation): Node {
    if (node.type === 'Identifier') {
      const name = node.name;
      const message = `Value of variable "${name}" violates contract, expected ${humanReadableType(annotation || node.typeAnnotation)} got `;
      return t.binaryExpression(
        '+',
        t.stringLiteral(message),
        readableName({input: node})
      );
    }
    else {
      const message = `Value of "${generate(node).code}" violates contract, expected ${humanReadableType(annotation || node.typeAnnotation)} got `;
      return t.binaryExpression(
        '+',
        t.stringLiteral(message),
        readableName({input: node})
      );
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
   * Determine whether the file should be skipped, based on the comments attached to the given node.
   */
  function maybeSkipFile (path: NodePath): boolean {
    if (path.node.leadingComments && path.node.leadingComments.length) {
      return path.node.leadingComments.some(comment => PRAGMA_IGNORE_FILE.test(comment.value));
    }
    return false;
  }

  /**
   * Maybe skip the given path if it has a relevant pragma.
   */
  function maybeSkip (path: NodePath): boolean {
    const {node} = path;
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
