import Plugin from '../src';
import fs from 'fs';
import {parse, transform, traverse} from 'babel';

describe('Typecheck', function () {

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

  fail("string-arguments");
  fail("string-arguments", 123);

  failStatic("bad-const-tracking");
  failStatic("bad-return-value");
  failStatic("bad-default-arguments");

  ok("class-method");
});



function load (basename) {
  const filename = `${__dirname}/fixtures/${basename}.js`;
  const source = fs.readFileSync(filename, 'utf8');
  const transformed = transform(source, {
    plugins: [Plugin]
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
    }
    if (!failed) {
      throw new Error(`Test '${basename}' should have failed but did not.`);
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