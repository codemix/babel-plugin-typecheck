import fs from 'fs';
import {parse, transform, traverse} from 'babel-core';

if (process.env.NODE_WATCH) {
  var typecheck = require('../src').default;
}
else if (process.env.TYPECHECK_USE_LIBCHECKED) {
  var typecheck = require('../lib-checked').default;
}
else {
  var typecheck = require('../lib').default;
}

describe('Typecheck', function () {
  ok('symbols', Symbol('foo'));
  failWith(`Value of argument "input" violates contract, expected Symbol got string`, 'symbols', 'wat');
  ok('export-typed-var', 'foo');
  ok('bug-48-export-star', 'wat');
  ok('typeof', {name: 'bob'});
  failWith('Value of argument "input" violates contract, expected typeof user got Object', 'typeof', {name: false});
  ok('typeof-class', 'bob');
  failWith('Function "demo" return value violates contract, expected typeof user got string', 'typeof-class', false);

  ok('intersection', {name: 'bob', address: '123 Fake Street'});
  failWith('Value of argument "input" violates contract, expected Nameable & Locatable got Object', 'intersection', {name: 'bob', address: false});

  ok('set-entries', new Set([1, 2, 3]));
  failWith('Value of argument "input" violates contract, expected Set<number> got Set', 'set-entries', new Set([1, 'b', 3]));

  ok('map-keys', new Map([['a', 1], ['b', 2], ['c', 3]]));
  ok('map-values', new Map([['a', 1], ['b', 2], ['c', 3]]));

  ok('map-contents', new Map([['a', 1], ['b', 2], ['c', 3]]));
  failWith('Value of argument "input" violates contract, expected Map<string, number> got Map', 'map-contents', new Map([['a', 1], ['b', 2], ['c', 'nope']]));
  ok('interface', {name: 'hello world'});
  ok('interface-extends', {name: 'hello world', age: 123});
  ok('interface-multi-extends', {name: 'hello world', age: 123, isActive: true});
  ok('class-implements', {name: 'hello world', age: 123, isActive: true});
  ok('class-type-params', 'hello world');
  ok('class-type-params', ['hello world']);

  ok('array-type-annotation', ['foo', 'bar']);
  failWith('Value of argument "input" violates contract, expected string[] got Array', 'array-type-annotation', ['foo', 123]);

  ok('infer-member-expression-from-object', {name: "bob"});
  ok('logical-expression', 'foo');
  ok('logical-or-expression', 'foo');
  ok('infer-member-expression', {name: "bob"});

  ok('infer-member-expression-from-typealias', {name: "bob"});

  ok('infer-nested-member-expression-from-typealias', {name: "bob", location: {address: "123 Fake Street"}});
  failStatic("bad-infer-nested-member-expression-from-typealias", {name: "bob", location: {address: "123 Fake Street"}});

  failStatic("bad-binary-return-value");
  ok("var-declarations", ["abc", "123"])


  ok("tuples", [123, "foobar"]);
  ok("tuples-assignment-expression", [123, "foobar"]);

  failStatic("bad-tuples", [123, "foobar"]);
  ok("return-regexp");

  ok("conditional-return-value");

  failStatic("bad-conditional-return-value");

  failWith("Function \"demo\" return value violates contract, expected number | string got Object", "conditional-return-value", {a: 123});


  ok("assignment-expression", [1, 2, 3]);
  failStatic("bad-array-return-value");

  failStatic("bad-function-return-value");

  ok("type-aliases", "foo", "bar", {foo: "foo", bar: 123});
  ok("generic-function", 123);
  ok("fancy-generic-function", Buffer(123), (value) => value);
  ok("return-object-types", {greeting: "hello world", id: 123});
  failWith("Function \"demo\" return value violates contract, expected { greeting: string; id: number; } got Object", "return-object-types", {foo: "bar"});

  ok("nested-object-types", {greeting: "hello world", id: 123, nested: {left: 10, right: 20}});
  failWith("Value of argument \"input\" violates contract, expected { greeting: string; id: number; nested: { left: number; right: number; }; } got Object", "nested-object-types", {foo: "bar"});
  failWith("Value of argument \"input\" violates contract, expected { greeting: string; id: number; nested: { left: number; right: number; }; } got Object", "nested-object-types", {greeting: "hello world", id: 123, nested: {left: true, right: false}});
  failWith("Value of argument \"input\" violates contract, expected { greeting: string; id: number; nested: { left: number; right: number; }; } got Object", "nested-object-types", {greeting: "hello world", id: 123, nested: {left: 10}});
  failWith("Value of argument \"input\" violates contract, expected { greeting: string; id: number; nested: { left: number; right: number; }; } got Object", "nested-object-types", {greeting: "hello world", id: "123", nested: {left: 10, right: 20}});

  ok("complex-object-types", {greeting: "hello world", id: 123});
  failWith("Value of argument \"input\" violates contract, expected { greeting: string; id: number; } got Object", "complex-object-types", {foo: "bar"});
  failWith("Value of argument \"input\" violates contract, expected { greeting: string; id: number; } got string", "complex-object-types", "foo");

  ok("any-return-value");
  ok("callexpr-return-value");
  ok("binary-return-value");
  ok("mixed-return-value");
  ok("string-arguments", "hello world");
  ok("multiple-arguments", "hello world", 123);
  ok("const-tracking");
  ok("const-tracking-with-new");
  ok("const-tracking-with-new-extended");

  failWith("Value of argument \"input\" violates contract, expected string got undefined", "string-arguments");
  failWith("Value of argument \"input\" violates contract, expected string got number", "string-arguments", 123);

  failStatic("bad-const-tracking");
  failStatic("bad-return-value");
  failStatic("bad-default-arguments");
  failStatic("missing-return");
  ok("missing-return-with-nullable");
  ok("missing-return-with-mixed");


  ok("class-method");


  ok("poly-args", "hello world", /a/);
  ok("poly-args", ["hello world"], /b/);
  failWith("Value of argument \"arg\" violates contract, expected string | Array<string> got number", "poly-args", 123);
  failWith("Value of argument \"fn\" violates contract, expected Function | RegExp got number", "poly-args", "hello", 123);

  ok("bug-7-class-support");
  ok("bug-8-class-support");


  ok("optional-properties", {greeting: "hello world", id: 123});
  ok("optional-properties", {greeting: "hello world"});
  failWith("Value of argument \"input\" violates contract, expected { greeting: string; id?: number; } got Object", "optional-properties", {greeting: "hello world", id: "123"});
  failWith("Value of argument \"input\" violates contract, expected { greeting: string; id?: number; } got Object", "optional-properties", {greeting: "hello world", id: null});
  failWith("Value of argument \"input\" violates contract, expected { greeting: string; id?: number; } got Object", "optional-properties", {id: 123});
  failWith("Value of argument \"input\" violates contract, expected { greeting: string; id?: number; } got Object", "optional-properties", {foo: "bar"});
  failWith("Value of argument \"input\" violates contract, expected { greeting: string; id?: number; } got string", "optional-properties", "foo");

  ok("optional-arguments", "hello world");
  ok("optional-arguments", "hello world", 123);
  failWith("Value of optional argument \"bar\" violates contract, expected number got string", "optional-arguments", "hello world", "123");
  failWith("Value of optional argument \"bar\" violates contract, expected number got null", "optional-arguments", "hello world", null);

  ok("default-arguments", "hello world");
  ok("default-arguments", "hello world", 123);
  failWith("Value of argument \"bar\" violates contract, expected number got string", "default-arguments", "hello world", "123");
  failWith("Value of argument \"bar\" violates contract, expected number got null", "default-arguments", "hello world", null);

  ok("qualified-types", {})
  failWith("Value of argument \"foo\" violates contract, expected T.Object | T.Array got string", "qualified-types", "hello")

  ok("var-declarations", ["abc", "123"])
  failWith("Value of variable \"a\" violates contract, expected Array got string", "var-declarations", "abc")
  failWith("Value of variable \"b\" violates contract, expected string got number", "var-declarations", ["abc", 123])

  ok("var-declarations-2", ["abc", "123"])
  ok("var-declarations-2", ["abc", "1"])
  failWith("Value of variable \"a\" violates contract, expected Array got string", "var-declarations-2", "abc")
  failWith("Value of variable \"b\" violates contract, expected string got number", "var-declarations-2", ["abc", 123])

  ok("arrow-function", 123);
  ok("arrow-function-2", 123);

  failWith("Value of argument \"arg\" violates contract, expected number got string", "arrow-function", "abc")
  failWith("Value of argument \"arg\" violates contract, expected number got string", "arrow-function-2", "abc")

  ok("bug-30-conditional-return");

  ok("rest-params");
  ok("rest-params", 1);
  ok("rest-params", 10, 20);
  failStatic("bad-rest-params");
  failStatic("bad-rest-params-2");

  ok("export-type", {name: "Bob", age: 45});
  ok("import-type", {name: "Bob", age: 45});
  ok("import-multiple-types", [{name: "Bob", age: 45}]);
  ok('conditional-expression', 'foo');
});

function load (basename) {
  return loadInternal(basename).exports.default;
}

function loadInternal (basename) {
  const filename = `${__dirname}/fixtures/${basename}.js`;
  const source = fs.readFileSync(filename, 'utf8');
  const transformed = transform(source, {
    filename: filename,
    presets: [
      "stage-1",
      "es2015"
    ],
    plugins: [
      typecheck,
      'transform-flow-strip-types',
      //'transform-es2015-instanceof'
    ]
  });
  const context = {
    exports: {}
  };
  if (process.env.TYPECHECK_SAVE_TRANSFORMED) {
    fs.writeFileSync(`${__dirname}/fixtures/${basename}.js.transformed`, transformed.code, 'utf8');
  }
  const loaded = new Function('module', 'exports', 'require', transformed.code);
  loaded(context, context.exports, (path) => {
    if (/^\.\//.test(path)) {
      const module = loadInternal(path.slice(2));
      return module.exports;
    }
    else {
      return require(path);
    }
  });
  return context;
}


function ok (basename, ...args) {
  it(`should load '${basename}'`, function () {
    load(basename)(...args);
  });
}

function fail (basename, ...args) {
  it(`should not load '${basename}'`, function () {
    let failed = false;
    try {
      load(basename)(...args);
    }
    catch (e) {
      failed = true;
      console.log(e);
    }
    if (!failed) {
      throw new Error(`Test '${basename}' should have failed but did not.`);
    }
  });
}

function failWith (errorMessage, basename, ...args) {
  it(`should not load '${basename}'`, function () {
    let failed = false;
    let message;
    try {
      load(basename)(...args);
    }
    catch (e) {
      failed = true;
      message = e.message;
    }
    if (!failed) {
      throw new Error(`Test '${basename}' should have failed but did not.`);
    }
    // ignore differences in whitespace in comparison.
    if (message.replace(/\s+/g, ' ') !== errorMessage.replace(/\s+/g, ' ')) {
      throw new Error(`Test '${basename}' failed with ${message} instead of ${errorMessage}.`);
    }
  });
}


function failStatic (basename, ...args) {
  it(`should refuse to load '${basename}'`, function () {
    let failed = false;
    try {
      load(basename)(...args);
    }
    catch (e) {
      if (e instanceof SyntaxError) {
        failed = true;
        //console.log(e.toString());
      }
      else {
        throw e;
      }
    }
    if (!failed) {
      throw new Error(`Test '${basename}' should have failed static verification but did not.`);
    }
  });
}