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

  ok('react-decorator', {bar: 'bar'});
  ok('react-parameterized', {bar: 'bar'});
  failWith(`
    Invalid prop \`bar\` supplied to \`Foo\`.

    Expected:
    string

    Got:
    number
  `, 'react-parameterized', {bar: 3});

  ok('react-proptypes', {bar: 'bar'});
  failWith(`
    Invalid prop \`bar\` supplied to \`Foo\`.

    Expected:
    string

    Got:
    number
  `, 'react-proptypes', {bar: 3});
  ok('bug-108-default-value', {y: ''});
  failWith(`
    Value of argument 0 violates contract.

    Expected:
    { y: string
    }

    Got:
    {
      y: boolean;
    }
  `, 'bug-108-default-value', {y: false});
  failWith(`
    Value of variable "k" violates contract.

    Expected:
    BasicSeq

    Got:
    { x: number;
    }
  `, 'bug-107-type-alias', 123);
  okWithOptions('pragma-opt-in', { only: ['test'] },  1);
  failWithOptions('pragma-opt-in', { only: ['production'] },  1);
  okWithOptions('pragma-opt-in', { only: ['production'] }, 'a');
  failWithOptions('pragma-opt-in', { only: ['test', 'production'] },  1);
  okWithOptions('pragma-opt-in', { only: ['test', 'production'] }, 'a');
  ok('pragma-opt-in', 'a');

  ok('bug-98-false-positive-destructuring', {date: 'string', time: 'string'});
  ok('bug-98-false-positive-destructuring-expression', {date: 'string', time: 'string'});
  ok('bug-96-iterate-array');

  ok('object-indexer-basic', 'foo', 'bar');
  failWith(`
    Function "demo" return value violates contract.

    Expected:
    Thing

    Got:
    {
      string: string;
      number: number;
      foo: boolean;
    }
  `, 'object-indexer-basic', 'foo', false);

  ok('object-indexer-mixed', 'foo', 'bar');
  ok('object-indexer-mixed', 'foo', 123);
  failWith(`
    Function "demo" return value violates contract.

    Expected:
    Thing

    Got:
    {
      bool: boolean;
      bools: boolean[];
      string: string;
      number: number;
      foo: boolean;
    }`, 'object-indexer-mixed', 'foo', false);

  ok('int8', 0);
  ok('int8', 1);
  ok('int8', 12);
  ok('int8', 126);
  ok('int8', -127);
  failWith(`
    Value of argument "input" violates contract.

    Expected:
    int8

    Got:
    number`,'int8', 128);
  failWith(`
    Value of argument "input" violates contract.

    Expected:
    int8

    Got:
    number`,'int8', -129);
  failWith(`
    Value of argument "input" violates contract.

    Expected:
    int8

    Got:
    number`,'int8', 123.45);
  failWith(`
    Value of argument "input" violates contract.

    Expected:
    int8

    Got:
    string`, 'int8', 'nope');

  ok('uint8', 0);
  ok('uint8', 1);
  ok('uint8', 2);
  ok('uint8', 25);
  ok('uint8', 254);
  failWith(`
    Value of argument "input" violates contract.

    Expected:
    uint8

    Got:
    number`,'uint8', 256);
  failWith(`
    Value of argument "input" violates contract.

    Expected:
    uint8

    Got:
    number`,'uint8', -1);
  failWith(`
    Value of argument "input" violates contract.

    Expected:
    uint8

    Got:
    number`,'uint8', 123.45);
  failWith(`
    Value of argument "input" violates contract.

    Expected:
    uint8

    Got:
    string`, 'uint8', 'nope');

  ok('int16', 0);
  ok('int16', 3);
  ok('int16', 32);
  ok('int16', 327);
  ok('int16', 32766)
  failWith(`
    Value of argument "input" violates contract.

    Expected:
    int16

    Got:
    number`,'int16', 32768);
  ok('int16', -32768);
  failWith(`
    Value of argument "input" violates contract.

    Expected:
    int16

    Got:
    number`,'int16', -32769);
  failWith(`
    Value of argument "input" violates contract.

    Expected:
    int16

    Got:
    number`,'int16', 123.45);
  failWith(`
    Value of argument "input" violates contract.

    Expected:
    int16

    Got:
    string`, 'int16', 'nope');

  ok('uint16', 0);
  ok('uint16', 6);
  ok('uint16', 65);
  ok('uint16', 655);
  ok('uint16', 65534);
  failWith(`
    Value of argument "input" violates contract.

    Expected:
    uint16

    Got:
    number`,'uint16', 65536);
  failWith(`
    Value of argument "input" violates contract.

    Expected:
    uint16

    Got:
    number`,'uint16', -1);
  failWith(`
    Value of argument "input" violates contract.

    Expected:
    uint16

    Got:
    number`,'uint16', 123.45);
  failWith(`
    Value of argument "input" violates contract.

    Expected:
    uint16

    Got:
    string`, 'uint16', 'nope');

  ok('int32', 0);
  ok('int32', 3);
  ok('int32', 32);
  ok('int32', 327);
  ok('int32', 2147483646)
  failWith(`
    Value of argument "input" violates contract.

    Expected:
    int32

    Got:
    number`,'int32', 2147483648);
  ok('int32', -2147483648);
  failWith(`
    Value of argument "input" violates contract.

    Expected:
    int32

    Got:
    number`,'int32', -2147483649);
  failWith(`
    Value of argument "input" violates contract.

    Expected:
    int32

    Got:
    number`,'int32', 123.45);
  failWith(`
    Value of argument "input" violates contract.

    Expected:
    int32

    Got:
    string`, 'int32', 'nope');

  ok('uint32', 0);
  ok('uint32', 6);
  ok('uint32', 65);
  ok('uint32', 655);
  ok('uint32', 4294967294);
  failWith(`
    Value of argument "input" violates contract.

    Expected:
    uint32

    Got:
    number`,'uint32', 4294967296);
  failWith(`
    Value of argument "input" violates contract.

    Expected:
    uint32

    Got:
    number`,'uint32', -1);
  failWith(`
    Value of argument "input" violates contract.

    Expected:
    uint32

    Got:
    number`,'uint32', 123.45);
  failWith(`
    Value of argument "input" violates contract.

    Expected:
    uint32

    Got:
    string`, 'uint32', 'nope');

  ok('float32', 1.999);
  ok('float32', -1.999);
  ok('float32', 1e5);
  failWith(`
    Value of argument "input" violates contract.

    Expected:
    float32

    Got:
    number`, 'float32', -3.40282348e+38);
  failWith(`
    Value of argument "input" violates contract.

    Expected:
    float32

    Got:
    number`, 'float32', 3.40282348e+38);
  failWith(`
    Value of argument "input" violates contract.

    Expected:
    float32

    Got:
    number`, 'float32', 1e48);
  failWith(`
    Value of argument "input" violates contract.

    Expected:
    float32

    Got:
    string`, 'float32', 'nope');

  ok('float64', 123);
  ok('float64', -123);
  ok('float64', Math.pow(2, 32));
  ok('float64', Math.pow(2, 48));
  ok('float64', Math.pow(2, 53));
  failWith(`
    Value of argument "input" violates contract.

    Expected:
    float64

    Got:
    string`, 'float64', 'nope');


  ok('bug-87-bad-check', {});
  ok('class-annotation', class Thing {});
  failWith(`
    Value of argument "input" violates contract.

    Expected:
    Class

    Got:
    boolean`, 'class-annotation', false);

  if (!(() => true).prototype) {
    failWith(`
      Value of argument "input" violates contract.

      Expected:
      Class

      Got:
      function`, 'class-annotation', () => true);
  }
  else {
    // environment does not support spec compliant arrow functions.
    it.skip(`
      Value of argument "input" violates contract.

      Expected:
      Class

      Got:
      function`);
  }

  ok('bug-83-spread-object', {a: 1, b: 2, c: 3});
  ok('bug-82-too-much-inference');
  ok('bug-xxx-assignment-expression');
  ok('bug-xxx-literal-return');
  ok('bug-78-not-type-checked-array');
  ok('bug-76-cannot-read-property-name-of-undefined');
  ok('bug-71-cannot-iterate-void');
  ok('iterable', [1, 2, 3]);
  failWith(`
    Value of variable "item" violates contract.

    Expected:
    number

    Got:
    string`, 'iterable', ['a', 'b', 'c']);
  failStatic('bad-iterable', [1, 2, 3]);
  failStatic('bad-iterable-type', 123);

  ok('bug-68-return-string-literal');
  ok('indexers', foo => null);
  ok('object-pattern', {a: 'foo', b: 34});
  failWith(`
    Value of argument 0 violates contract.

    Expected:
    { a: string;
      b: number;
    }

    Got:
    { a: string;
    }
  `, 'object-pattern', {a: 'foo'});
  ok('object-pattern-complex', {a: 'foo', b: 34, d: {e: 'bar', g: 123, a: 123}});
  failWith(`
    Value of argument 0 violates contract.

    Expected:
    { a: string;
      b: number;
      d: { e: string;
        g: number;
      };
    }

    Got:
    { a: string;
      b: number;
      d: { e: string;
        g: boolean;
        a: number;
      };
    }
  `, 'object-pattern-complex', {a: 'foo', b: 34, d: {e: 'bar', g: false, a: 123}});
  ok('generators', 'foo');
  failWith(`
    Function "gen" yielded an invalid value.

    Expected:
    number | string

    Got:
    boolean`, 'generators', false);
  ok('generators-with-next', 12);
  failWith(`
    Generator "gen" received an invalid next value.

    Expected:
    number

    Got:
    string`, 'generators-with-next', 'foo');
  failWith(`
    Generator "gen" received an invalid next value.

    Expected:
    number

    Got:
    boolean`, 'generators-with-next', false);
  failStatic('bad-generators', 'foo');
  failStatic('bad-generators-return', 'foo');
  ok('object-properties-function', 'bob', 'bob@example.com');
  ok('bug-62-default-params');
  ok('bug-62-default-params', {option1: 'foo'});
  ok('bug-62-default-params', {option1: 'foo', option2: false});
  ok('bug-62-default-params', {option1: 'foo', option2: true, option3: 123});
  failWith(`
    Value of optional argument "options" violates contract.

    Expected:
    { option1?: string;
      option2?: bool;
      option3?: number;
    }

    Got:
    {
      option1: boolean;
    }`, 'bug-62-default-params', {option1: true});
  failWith(`
    Value of optional argument "options" violates contract.

    Expected:
    { option1?: string;
      option2?: bool;
      option3?: number;
    }

    Got:
    {
      option1: string;
      option2: string;
    }`, 'bug-62-default-params', {option1: 'foo', option2: 'nope'});
  failWith(`
    Value of optional argument "options" violates contract.

    Expected:
    { option1?: string;
      option2?: bool;
      option3?: number;
    }

    Got:
    {
      option1: string;
      option2: boolean;
      option3: string;
    }`, 'bug-62-default-params', {option1: 'foo', option2: true, option3: 'nope'});
  ok('bug-xxx-method-params');
  ok('bug-59-type-annotation-in-loop', 'foo');
  ok('bug-59-type-annotation-in-loop-again', 'foo');
  ok('object-method', 'bob', 'bob@example.com');
  failStatic('bad-object-method', 'bob', 'bob@example.com');
  failStatic('bad-object-method-arrow', 'bob', 'bob@example.com');
  failWith(`
    Value of "this.name" violates contract.

    Expected:
    string

    Got:
    boolean`, 'object-method', false, 'bob@example.com');
  ok('object-properties', 'bob', 'bob@example.com');
  failStatic('bad-object-properties', 'bob', 'bob@example.com');
  failWith(`
    Value of "user.name" violates contract.

    Expected:
    string

    Got:
    boolean`, 'object-properties', false, 'bob@example.com');
  failWith(`
    Value of "user.email" violates contract.

    Expected:
    string

    Got:
    boolean`, 'object-properties', 'bob', false);
  ok('class-getter', 'alice');
  failStatic('bad-class-getter', 'alice');
  ok('class-setter', 'alice');
  failStatic('bad-class-setter', 'alice');
  failWith(`
    Value of argument "name" violates contract.

    Expected:
    string

    Got:
    number`, 'class-setter', 123);
  ok('class-properties-complex', 'sally', 'bob@example.com', {
    address: '123 Fake Street',
    country: 'FR',
    pos: {
      lat: 12.34,
      lon: 45.67
    }
  }, 'FR');

  failWith(`
    Value of "user.location.country" violates contract.

    Expected:
    CountryCode

    Got:
    string`, 'class-properties-complex', 'sally', 'bob@example.com', {
    address: '123 Fake Street',
    country: 'FR',
    pos: {
      lat: 12.34,
      lon: 45.67
    }
  }, 'Invalid');

  failWith(`
    Value of "user.location.country" violates contract.

    Expected:
    CountryCode

    Got:
    boolean`, 'class-properties-complex', 'sally', 'bob@example.com', {
    address: '123 Fake Street',
    country: 'FR',
    pos: {
      lat: 12.34,
      lon: 45.67
    }
  }, false);
  ok('class-properties', 'bob', 'bob@example.com');
  failWith(`
    Value of "this.email" violates contract.

    Expected:
    string

    Got:
    null`, 'class-properties', 'bob', null);
  failWith(`
    Value of "this.name" violates contract.

    Expected:
    string

    Got:
    boolean`, 'class-properties', false, 'bob@example.com');
  ok('string-literal-annotations', 'foo');
  ok('string-literal-annotations', 'bar');
  failWith(`
    Value of argument "input" violates contract.

    Expected:
    "foo" | "bar"

    Got:
    string`, 'string-literal-annotations', 'wat');
  failStatic('bad-string-literal-annotations', 'foo');

  ok('boolean-literal-annotations', true);
  ok('boolean-literal-annotations', false);
  failWith(`
    Value of argument "input" violates contract.

    Expected:
    true | false

    Got:
    string`, 'boolean-literal-annotations', 'wat');

  ok('numeric-literal-annotations', 1);
  ok('numeric-literal-annotations', 2);
  failWith(`
    Value of argument "input" violates contract.

    Expected:
    1 | 2

    Got:
    number`, 'numeric-literal-annotations', 3);

  ok('enum', 'active');
  ok('enum', 'inactive');
  failWith(`
    Value of argument "input" violates contract.

    Expected:
    status

    Got:
    string`, 'enum', 'pending');

  ok('pragma-ignore-statement', 'some string');
  ok('pragma-ignore-file', 'some string');

  ok('async-method', ['hello world']);
  ok('async-function', ['hello world']);
  failWith(`
    Value of argument "input" violates contract.

    Expected:
    string[]

    Got:
    number[]`, 'async-function', [123]);
  ok('async-function-return-promise', ['a', 'b', 'c']);
  failStatic('bad-async-function', 'hello world');
  ok('class-getter', 'alice');
  ok("bug-xxx-export");
  ok('new', 'bob');
  ok('symbols', Symbol('foo'));
  failWith(`
    Value of argument "input" violates contract.

    Expected:
    Symbol

    Got:
    string`, 'symbols', 'wat');
  ok('export-typed-var', 'foo');
  ok('bug-48-export-star', 'wat');
  ok('typeof', {name: 'bob'});
  failWith(`
    Value of argument "input" violates contract.

    Expected:
    typeof user

    Got:
    {
      name: boolean;
    }`, 'typeof', {name: false});
  ok('typeof-class', 'bob');
  failWith(`
    Function "demo" return value violates contract.

    Expected:
    typeof user

    Got:
    string`, 'typeof-class', false);

  ok('intersection', {name: 'bob', address: '123 Fake Street'});
  failWith(`
    Value of argument "input" violates contract.

    Expected:
    Nameable & Locatable

    Got:
    {
      name: string;
      address: boolean;
    }`, 'intersection', {name: 'bob', address: false});

  ok('set-entries', new Set([1, 2, 3]));
  failWith(`
    Value of argument "input" violates contract.

    Expected:
    Set<number>

    Got:
    Set`, 'set-entries', new Set([1, 'b', 3]));

  ok('map-keys', new Map([['a', 1], ['b', 2], ['c', 3]]));
  ok('map-values', new Map([['a', 1], ['b', 2], ['c', 3]]));
  failWith(`
    Function "demo" return value violates contract.

    Expected:
    Map<*, number>

    Got:
    Map`, 'bad-map-values', new Map([['a', 1], ['b', 2], ['c', 3]]));

  ok('map-contents', new Map([['a', 1], ['b', 2], ['c', 3]]));
  failWith(`
    Value of argument "input" violates contract.

    Expected:
    Map<string, number>

    Got:
    Map`, 'map-contents', new Map([['a', 1], ['b', 2], ['c', 'nope']]));
  ok('interface', {name: 'hello world'});
  ok('interface-extends', {name: 'hello world', age: 123});
  ok('interface-multi-extends', {name: 'hello world', age: 123, isActive: true});
  ok('class-implements', {name: 'hello world', age: 123, isActive: true});
  ok('class-type-params', 'hello world');
  ok('class-type-params', ['hello world']);

  ok('array-type-annotation', ['foo', 'bar']);
  failWith(`
    Value of argument "input" violates contract.

    Expected:
    string[]

    Got:
    [string, number]`, 'array-type-annotation', ['foo', 123]);

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

  failWith(`
    Function "demo" return value violates contract.

    Expected:
    number | string

    Got:
    {
      a: number;
    }`, "conditional-return-value", {a: 123});


  ok("assignment-expression", [1, 2, 3]);
  failStatic("bad-array-return-value");

  failStatic("bad-function-return-value");

  ok("type-aliases", "foo", "bar", {foo: "foo", bar: 123});
  ok("generic-function", 123);
  ok("fancy-generic-function", Buffer(123), (value) => value);
  ok("return-object-types", {greeting: "hello world", id: 123});
  failWith(`
    Function "demo" return value violates contract.

    Expected:
    { greeting: string;
      id: number;
    }

    Got:
    {
      foo: string;
    }`, "return-object-types", {foo: "bar"});

  ok("nested-object-types", {greeting: "hello world", id: 123, nested: {left: 10, right: 20}});
  failWith(`
    Value of argument "input" violates contract.

    Expected:
    { greeting: string;
      id: number;
      nested: { left: number;
        right: number;
      };
    }

    Got:
    {
      foo: string;
    }`, "nested-object-types", {foo: "bar"});
  failWith(`
    Value of argument "input" violates contract.

    Expected:
    { greeting: string;
      id: number;
      nested: { left: number;
        right: number;
      };
    }

    Got:
    {
      greeting: string;
      id: number;
      nested: {
        left: boolean;
        right: boolean;
      };
    }`, "nested-object-types", {greeting: "hello world", id: 123, nested: {left: true, right: false}});
  failWith(`
    Value of argument "input" violates contract.

    Expected:
    { greeting: string;
      id: number;
      nested: { left: number;
        right: number;
      };
    }

    Got:
    {
      greeting: string;
      id: number;
      nested: {
        left: number;
      };
    }`, "nested-object-types", {greeting: "hello world", id: 123, nested: {left: 10}});
  failWith(`
    Value of argument "input" violates contract.

    Expected:
    { greeting: string;
      id: number;
      nested: { left: number;
        right: number;
      };
    }

    Got:
    {
      greeting: string;
      id: string;
      nested: {
        left: number;
        right: number;
      };
    }
    `, "nested-object-types", {greeting: "hello world", id: "123", nested: {left: 10, right: 20}});

  ok("complex-object-types", {greeting: "hello world", id: 123});
  failWith(`
    Value of argument "input" violates contract.

    Expected:
    { greeting: string;
      id: number;
    }

    Got:
    {
      foo: string;
    }`, "complex-object-types", {foo: "bar"});
  failWith(`
    Value of argument "input" violates contract.

    Expected:
    { greeting: string;
      id: number;
    }

    Got:
    string`, "complex-object-types", "foo");

  ok("any-return-value");
  ok("callexpr-return-value");
  ok("binary-return-value");
  ok("mixed-return-value");
  ok("string-arguments", "hello world");
  ok("multiple-arguments", "hello world", 123);
  ok("const-tracking");
  ok("const-tracking-with-new");
  ok("const-tracking-with-new-extended");

  failWith(`
    Value of argument "input" violates contract.

    Expected:
    string

    Got:
    void`,
    "string-arguments");

  failWith(`
    Value of argument "input" violates contract.

    Expected:
    string

    Got:
    number`,
    "string-arguments",
    123);

  failStatic("bad-const-tracking");
  failStatic("bad-return-value");
  failStatic("bad-default-arguments");
  failStatic("missing-return");
  ok("missing-return-with-nullable");
  ok("missing-return-with-mixed");


  ok("class-method");


  ok("poly-args", "hello world", /a/);
  ok("poly-args", ["hello world"], /b/);
  failWith(`
    Value of argument \"arg\" violates contract.

    Expected:
    string | Array<string>

    Got:
    number`, "poly-args", 123);
  failWith(`
    Value of argument \"fn\" violates contract.

    Expected:
    Function | RegExp

    Got:
    number`, "poly-args", "hello", 123);

  ok("bug-7-class-support");
  ok("bug-8-class-support");


  ok("optional-properties", {greeting: "hello world", id: 123});
  ok("optional-properties", {greeting: "hello world"});
  failWith(`
    Value of argument "input" violates contract.

    Expected:
    { greeting: string;
      id?: number;
    }

    Got:
    {
      greeting: string;
      id: string;
    }`, "optional-properties", {greeting: "hello world", id: "123"});
  failWith(`
    Value of argument "input" violates contract.

    Expected:
    { greeting: string;
      id?: number;
    }

    Got:
    {
      greeting: string;
      id: null;
    }`, "optional-properties", {greeting: "hello world", id: null});
  failWith(`
    Value of argument "input" violates contract.

    Expected:
    { greeting: string;
      id?: number;
    }

    Got:
    {
      id: number;
    }`, "optional-properties", {id: 123});
  failWith(`
    Value of argument "input" violates contract.

    Expected:
    { greeting: string;
      id?: number;
    }

    Got:
    {
      foo: string;
    }`, "optional-properties", {foo: "bar"});
  failWith(`
    Value of argument "input" violates contract.

    Expected:
    { greeting: string;
      id?: number;
    }

    Got:
    string`, "optional-properties", "foo");

  ok("optional-arguments", "hello world");
  ok("optional-arguments", "hello world", 123);
  failWith(`
    Value of optional argument "bar" violates contract.

    Expected:
    number

    Got:
    string`, "optional-arguments", "hello world", "123");
  failWith(`
    Value of optional argument "bar" violates contract.

    Expected:
    number

    Got:
    null`, "optional-arguments", "hello world", null);

  ok("default-arguments", "hello world");
  ok("default-arguments", "hello world", 123);
  failWith(`
    Value of argument "bar" violates contract.

    Expected:
    number

    Got:
    string`, "default-arguments", "hello world", "123");
  failWith(`
    Value of argument "bar" violates contract.

    Expected:
    number

    Got:
    null`, "default-arguments", "hello world", null);

  ok("qualified-types", {})
  failWith(`
    Value of argument "foo" violates contract.

    Expected:
    T.Object | T.Array

    Got:
    string`, "qualified-types", "hello")

  ok("var-declarations", ["abc", "123"])
  failWith(`
    Value of variable "a" violates contract.

    Expected:
    Array

    Got:
    string`, "var-declarations", "abc")
  failWith(`
    Value of variable "b" violates contract.

    Expected:
    string

    Got:
    number`, "var-declarations", ["abc", 123])

  ok("var-declarations-2", ["abc", "123"])
  ok("var-declarations-2", ["abc", "1"])
  failWith(`
    Value of variable "a" violates contract.

    Expected:
    Array

    Got:
    string`, "var-declarations-2", "abc")
  failWith(`
    Value of variable "b" violates contract.

    Expected:
    string

    Got:
    number`, "var-declarations-2", ["abc", 123])

  ok("arrow-function", 123);
  ok("arrow-function-2", 123);

  failWith(`
    Value of argument "arg" violates contract.

    Expected:
    number

    Got:
    string`, "arrow-function", "abc")
  failWith(`
    Value of argument "arg" violates contract.

    Expected:
    number

    Got:
    string`, "arrow-function-2", "abc")

  ok("bug-30-conditional-return");

  ok("rest-params");
  ok("rest-params", 1);
  ok("rest-params", 10, 20);
  ok("rest-params-array");
  ok("rest-params-array", 1);
  ok("rest-params-array", 10, 20);
  failStatic("bad-rest-params");
  failStatic("bad-rest-params-2");

  ok("export-type", {name: "Bob", age: 45});
  ok("import-type", {name: "Bob", age: 45});
  ok("import-multiple-types", [{name: "Bob", age: 45}]);
  ok('conditional-expression', 'foo');

  it(`should load itself`, function () {
    this.timeout(60000); // @fixme We are currently unacceptably slow.
    load('/../../src/index');
  });
});

function load (basename, opts) {
  return loadInternal(basename, opts).exports.default;
}

function loadInternal (basename, opts) {
  const filename = `${__dirname}/fixtures/${basename}.js`;
  const source = fs.readFileSync(filename, 'utf8');
  const transformed = transform(source, {
    filename: filename,
    presets: [
      "es2015",
      "stage-0",
    ],
    plugins: [
      opts ? [typecheck, opts] : typecheck,
      'transform-flow-strip-types',
      'transform-decorators-legacy',
      'syntax-class-properties'
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

function isThenable (thing: mixed): boolean {
  return thing && typeof thing.then === 'function';
}

function okWithOptions (basename, opts, ...args) {
  it(`should load '${basename}' with options '${JSON.stringify(opts)}'`, async function () {
    const result = load(basename, opts)(...args);
    if (isThenable(result)) {
      await result;
    }
  });
}

function failWithOptions (basename, opts, ...args) {
  it(`should not load '${basename}' with options '${JSON.stringify(opts)}'`, async function () {
    let failed = false;
    try {
      const result = load(basename, opts)(...args);
      if (isThenable(result)) {
        await result;
      }
    }
    catch (e) {
      failed = true;
    }
    if (!failed) {
      throw new Error(`Test '${basename}' should have failed but did not.`);
    }
  });
}

function ok (basename, ...args) {
  it(`should load '${basename}'`, async function () {
    const result = load(basename)(...args);
    if (isThenable(result)) {
      await result;
    }
  });
}

function fail (basename, ...args) {
  it(`should not load '${basename}'`, async function () {
    let failed = false;
    try {
      const result = load(basename)(...args);
      if (isThenable(result)) {
        await result;
      }
    }
    catch (e) {
      failed = true;
    }
    if (!failed) {
      throw new Error(`Test '${basename}' should have failed but did not.`);
    }
  });
}

function failWith (errorMessage, basename, ...args) {
  it(`should not load '${basename}'`, async function () {
    let failed = false;
    let message;
    try {
      const result = load(basename)(...args);
      if (isThenable(result)) {
        await result;
      }
    }
    catch (e) {
      failed = true;
      message = e.message;
    }
    if (!failed) {
      throw new Error(`Test '${basename}' should have failed but did not.`);
    }
    // ignore differences in whitespace in comparison.
    if (message.replace(/\s+/g, '') !== errorMessage.replace(/\s+/g, '')) {
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
