import typecheck from '../lib';
import fs from 'fs';
import {parse, transform, traverse} from 'babel';

describe('Typecheck', function () {
  ok("return-object-types", {greeting: "hello world", id: 123});
  failWith("Function 'demo' return value violates contract, expected Object with properties greeting and id got Object", "return-object-types", {foo: "bar"});

  ok("nested-object-types", {greeting: "hello world", id: 123, nested: {left: 10, right: 20}});
  failWith("Value of argument 'input' violates contract, expected Object with properties greeting, id and nested got Object", "nested-object-types", {foo: "bar"});
  failWith("Value of argument 'input' violates contract, expected Object with properties greeting, id and nested got Object", "nested-object-types", {greeting: "hello world", id: 123, nested: {left: true, right: false}});
  failWith("Value of argument 'input' violates contract, expected Object with properties greeting, id and nested got Object", "nested-object-types", {greeting: "hello world", id: 123, nested: {left: 10}});
  failWith("Value of argument 'input' violates contract, expected Object with properties greeting, id and nested got Object", "nested-object-types", {greeting: "hello world", id: "123", nested: {left: 10, right: 20}});

  ok("complex-object-types", {greeting: "hello world", id: 123});
  failWith("Value of argument 'input' violates contract, expected Object with properties greeting and id got Object", "complex-object-types", {foo: "bar"});
  failWith("Value of argument 'input' violates contract, expected Object with properties greeting and id got string", "complex-object-types", "foo");

  ok("conditional-return-value");
  ok("any-return-value");
  ok("callexpr-return-value");
  ok("binary-return-value");
  failStatic("bad-binary-return-value");
  ok("mixed-return-value");
  ok("string-arguments", "hello world");
  ok("multiple-arguments", "hello world", 123);
  ok("const-tracking");
  ok("const-tracking-with-new");
  ok("const-tracking-with-new-extended");

  failWith("Value of argument 'input' violates contract, expected string got undefined", "string-arguments");
  failWith("Value of argument 'input' violates contract, expected string got number", "string-arguments", 123);

  failStatic("bad-const-tracking");
  failStatic("bad-return-value");
  failStatic("bad-default-arguments");

  ok("class-method");


  ok("poly-args", "hello world", /a/);
  ok("poly-args", ["hello world"], /b/);
  failWith("Value of argument 'arg' violates contract, expected string or array got number", "poly-args", 123);
  failWith("Value of argument 'fn' violates contract, expected function or RegExp got number", "poly-args", "hello", 123);

  ok("bug-7-class-support");
  ok("bug-8-class-support");

  failWith("Function 'demo' return value violates contract, expected number or string got Object", "conditional-return-value", {a: 123});

  ok("optional-properties", {greeting: "hello world", id: 123});
  ok("optional-properties", {greeting: "hello world"});
  failWith("Value of argument 'input' violates contract, expected Object with properties greeting and id got Object", "optional-properties", {greeting: "hello world", id: "123"});
  failWith("Value of argument 'input' violates contract, expected Object with properties greeting and id got Object", "optional-properties", {greeting: "hello world", id: null});
  failWith("Value of argument 'input' violates contract, expected Object with properties greeting and id got Object", "optional-properties", {id: 123});
  failWith("Value of argument 'input' violates contract, expected Object with properties greeting and id got Object", "optional-properties", {foo: "bar"});
  failWith("Value of argument 'input' violates contract, expected Object with properties greeting and id got string", "optional-properties", "foo");

  ok("optional-arguments", "hello world");
  ok("optional-arguments", "hello world", 123);
  failWith("Value of optional argument 'bar' violates contract, expected number or undefined got string", "optional-arguments", "hello world", "123");
  failWith("Value of optional argument 'bar' violates contract, expected number or undefined got null", "optional-arguments", "hello world", null);

  ok("default-arguments", "hello world");
  ok("default-arguments", "hello world", 123);
  failWith("Value of argument 'bar' violates contract, expected number got string", "default-arguments", "hello world", "123");
  failWith("Value of argument 'bar' violates contract, expected number got null", "default-arguments", "hello world", null);

  ok("qualified-types", {})
  failWith("Value of argument 'foo' violates contract, expected T.Object or T.Array got string", "qualified-types", "hello")

  ok("var-declarations", ["abc", "123"])
  failWith("Value of variable 'a' violates contract, expected array got string", "var-declarations", "abc")
  failWith("Value of variable 'b' violates contract, expected string got number", "var-declarations", ["abc", 123])

});



function load (basename) {
  const filename = `${__dirname}/fixtures/${basename}.js`;
  const source = fs.readFileSync(filename, 'utf8');
  const transformed = transform(source, {
    plugins: [typecheck]
  });
  const context = {
    exports: {}
  };
  const loaded = new Function('module', 'exports', transformed.code);
  loaded(context, context.exports);
  return context.exports;
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
    if (message !== errorMessage) {
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
      failed = e instanceof SyntaxError;
    }
    if (!failed) {
      throw new Error(`Test '${basename}' should have failed static verification but did not.`);
    }
  });
}