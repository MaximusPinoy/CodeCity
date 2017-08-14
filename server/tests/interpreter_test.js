/**
 * @license
 * Code City: Interpreter JS Tests
 *
 * Copyright 2017 Google Inc.
 * https://github.com/NeilFraser/CodeCity
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @fileoverview Tests for JavaScript interpreter.
 * @author cpcallen@google.com (Christopher Allen)
 */
'use strict';

var net = require('net');
var util = require('util');
//var toSource = require('tosource');

var Interpreter = require('../interpreter');
var es5 = require('./interpreter_es5');
var testcases = require('./testcases');

// Prepare static interpreter instance for runTest.
var interpreter = new Interpreter;
interpreter.createThread(es5);
interpreter.run();
interpreter.addVariableToScope(interpreter.global, 'src');

/**
 * Run a simple test of the interpreter.  Only a single Interpreter
 * instance is created for all tests executed by this function, but
 * eval is used to evaluate src in its own scope.  The supplied src
 * must not modify objects accessible via the global scope!
 * @param {!T} t The test runner object.
 * @param {string} name The name of the test.
 * @param {string} src The code to be evaled.
 * @param {number|string|boolean|null|undefined} expected The expected
 *     completion value.
 */
function runTest(t, name, src, expected) {
  try {
    interpreter.setValueToScope(interpreter.global, 'src', src);
    // TODO(cpcallen): it shouldn't be necessary to reset
    // interpreter.value to undefined between tests; that it is is a
    // symptom of incorrect completion value handling by the
    // interpreter.
    interpreter.value = undefined;
    interpreter.createThread('eval(src);');
    interpreter.run();
  } catch (e) {
    t.crash(name, util.format('%s\n%s', src, e.stack));
    return;
  }
  var r = interpreter.pseudoToNative(interpreter.value);
  if (Object.is(r, expected)) {
    t.pass(name);
  } else {
    t.fail(name, util.format('%s\ngot: %s  want: %s', src,
        String(r), String(expected)));
  }
}

/**
 * Run a more complicated test of the interpreter.  A new interpreter
 * instance is created for each test, and the caller can supply
 * callbacks to be run before beginning and between calls to .run().
 * @param {!T} t The test runner object.
 * @param {string} name The name of the test.
 * @param {string} src The code to be evaled.
 * @param {number|string|boolean|null|undefined} expected The expected
 *     completion value.
 * @param {Function(Interpreter)=} initFunc Optional function to be
 *     called after creating new interpreter instance and running
 *     es5 but before running src.  Can be used to insert extra
 *     native functions into the interpreter.  initFunc is called
 *     with the interpreter instance to be configured as its
 *     parameter.
 * @param {Function(Interpreter)=} asyncFunc Optional function to be
 *     called if .run() returns true.  Can be used to fake completion
 *     of asynchronous events for testing purposes.
 */
function runComplexTest(t, name, src, expected, initFunc, asyncFunc) {
  var intrp = new Interpreter;
  intrp.createThread(es5);
  intrp.run();
  if (initFunc) {
    initFunc(intrp);
  }

  try {
    intrp.createThread(src);
    while (intrp.run()) {
      if (asyncFunc) {
        asyncFunc(intrp);
      }
    }
  } catch (e) {
    t.crash(name, util.format('%s\n%s', src, e.stack));
    return;
  }
  var r = intrp.pseudoToNative(intrp.value);
  if (Object.is(r, expected)) {
    t.pass(name);
  } else {
    t.fail(name, util.format('%s\ngot: %s  want: %s', src,
        String(r), String(expected)));
  }
}

/**
 * Run a (truly) asynchronous test of the interpreter.  A new
 * interpreter instance is created for each test.  Special functions
 * resolve() and reject() are inserted in the global scope; they will
 * end the test.  If resolve() is called the test will end normally
 * and the argument supplied will be compared with the expected value;
 * if reject() is called the test will instead be treated as a crash.
 * The caller can additionally supply callbacks to be run before and
 * after starting the user code; the latter may be an async function
 * and will be awaited before awaiting the userland call to
 * resolve/reject.
 * @param {!T} t The test runner object.
 * @param {string} name The name of the test.
 * @param {string} src The code to be evaled.
 * @param {number|string|boolean|null|undefined} expected The expected
 *     completion value.
 * @param {Function(Interpreter)=} initFunc Optional function to be
 *     called after creating new interpreter instance and running
 *     es5 but before running src.  Can be used to insert extra
 *     native functions into the interpreter.  initFunc is called
 *     with the interpreter instance to be configured as its
 *     parameter.
 * @param {Function(Interpreter)=} sideFunc Optional (optionally
 *     async) function to be called after the interpreter has been
 *     .start()ed.
 */
async function runAsyncTest(t, name, src, expected, initFunc, sideFunc) {
  var intrp = new Interpreter;
  intrp.createThread(es5);
  intrp.run();
  if (initFunc) {
    initFunc(intrp);
  }

  // Create promise to signal completion of test from within
  // interpreter.  Awaiting p will block until resolve or reject is
  // called.
  var resolve, reject, result;
  var p = new Promise(function(res, rej) { resolve = res; reject = rej; });
  intrp.addVariableToScope(intrp.global, 'resolve',
      intrp.createNativeFunction('resolve', resolve));
  intrp.addVariableToScope(intrp.global, 'reject',
      intrp.createNativeFunction('reject', reject));

  try {
    intrp.createThread(src);
    intrp.start();
    if (sideFunc) {
      await sideFunc(intrp);
    }
    result = await p;
  } catch (e) {
    t.crash(name, util.format('%s\n%s', src, e.stack));
    return;
  } finally {
    intrp.stop();
  }
  var r = intrp.pseudoToNative(result);
  if (Object.is(r, expected)) {
    t.pass(name);
  } else {
    t.fail(name, util.format('%s\ngot: %s  want: %s', src,
        String(r), String(expected)));
  }
}

/**
 * Run the simple tests in testcases.js
 * @param {!T} t The test runner object.
 */
exports.testSimple = function(t) {
  for (var i = 0; i < testcases.length; i++) {
    var tc = testcases[i];
    if ('expected' in tc) {
      runTest(t, tc.name, tc.src, tc.expected);
    } else {
      t.skip(tc.name);
    }
  }
};


/**
 * Run a (destructive) test to ensure that 'this' is a primitive in
 * methods invoked on primitives.  (This also tests that interpreter
 * is running in strict mode; in sloppy mode this will be boxed.)
 */
exports.testStrictBoxedThis = function(t) {
  var name = 'strictBoxedThis', src = `
      Object.prototype.foo = function() { return typeof this; };
      'foo'.foo();
  `;
  runComplexTest(t, name, src, 'string');
};


/**
 * Run some tests of the various constructors and their associated
 * literals and prototype objects.
 * @param {!T} t The test runner object.
 */
exports.testClasses = function(t) {
  var classes = {
    Object: {
      prototypeProto: 'null',
      literal: '{}'
    },
    Function: {
      prototypeType: 'function',
      listeral: 'function(){}'
    },
    Array: {
      literal: '[]'
    },
    RegExp: {
      prototypeClass: 'Object', // Was 'RegExp' in ES5.1.
      literal: '/foo/'
    },
    Date: {
      prototypeClass: 'Object' // Was 'RegExp' in ES5.1.
    },
    Error: {},
    EvalError: {
      prototypeProto: 'Error.prototype',
      class: 'Error'
    },
    RangeError: {
      prototypeProto: 'Error.prototype',
      class: 'Error'
    },
    ReferenceError: {
      prototypeProto: 'Error.prototype',
      class: 'Error'
    },
    SyntaxError: {
      prototypeProto: 'Error.prototype',
      class: 'Error'
    },
    TypeError: {
      prototypeProto: 'Error.prototype',
      class: 'Error'
    },
    URIError: {
      prototypeProto: 'Error.prototype',
      class: 'Error'
    },
    Boolean: {
      literal: 'false',
      literalType: 'boolean',
      noInstance: true,
    },
    Number: {
      literal: '42',
      literalType: 'number',
      noInstance: true,
    },
    String: {
      literal: '"hello"',
      literalType: 'string',
      noInstance: true,
    },
  };
  for (var c in classes) {
    var name, src, tc = classes[c];
    // Check constructor is a function:
    name = c + 'IsFunction';
    src = 'typeof ' + c + ';';
    runTest(t, name, src, 'function');
    // Check constructor's proto is Function.prototype
    name = c + 'ProtoIsFunctionPrototype';
    src = 'Object.getPrototypeOf(' + c + ') === Function.prototype;';
    runTest(t, name, src, true);
    // Check prototype is of correct type:
    var prototypeType = (tc.prototypeType || 'object');
    name = c + 'PrototypeIs' + prototypeType
    src = 'typeof ' + c + '.prototype;';
    runTest(t, name, src, prototypeType);
    // Check prototype has correct class:
    var prototypeClass = (tc.prototypeClass || tc.class || c);
    name = c + 'PrototypeClassIs' + prototypeClass;
    src = 'Object.prototype.toString.apply(' + c + '.prototype);';
    runTest(t, name, src, '[object ' + prototypeClass + ']');
    // Check prototype has correct proto:
    var prototypeProto = (tc.prototypeProto || 'Object.prototype');
    name = c + 'PrototypeProtoIs' + prototypeProto;
    src = 'Object.getPrototypeOf(' + c + '.prototype) === ' +
        prototypeProto + ';';
    runTest(t, name, src, true);
    // Check prototype's .constructor is constructor:
    name = c + 'PrototypeConstructorIs' + c;
    src = c + '.prototype.constructor === ' + c + ';';
    runTest(t, name, src, true);

    var cls = tc.class || c;
    if (!tc.noInstance) {
      // Check instance's type:
      name = c + 'InstanceIs' + prototypeType;
      src = 'typeof (new ' + c + ');';
      runTest(t, name, src, prototypeType);
      // Check instance's proto:
      name = c + 'InstancePrototypeIs' + c + 'Prototype';
      src = 'Object.getPrototypeOf(new ' + c + ') === ' + c + '.prototype;';
      runTest(t, name, src, true);
      // Check instance's class:
      name = c + 'InstanceClassIs' + cls;
      src = 'Object.prototype.toString.apply(new ' + c + ');';
      runTest(t, name, src, '[object ' + cls + ']');
      // Check instance is instanceof its contructor:
      name = c + 'InstanceIsInstanceof' + c;
      src = '(new ' + c + ') instanceof ' + c + ';';
      runTest(t, name, src, true);
    }
    if (tc.literal) {
      // Check literal's type:
      var literalType = (tc.literalType || prototypeType);
      name = c + 'LiteralIs' + literalType;
      src = 'typeof (' + tc.literal + ');';
      runTest(t, name, src, literalType);
      // Check literal's proto:
      name = c + 'LiteralPrototypeIs' + c + 'Prototype';
      src = 'Object.getPrototypeOf(' + tc.literal + ') === ' + c +
          '.prototype;';
      runTest(t, name, src, true);
      // Check literal's class:
      name = c + 'LiteralClassIs' + cls;
      src = 'Object.prototype.toString.apply(' + tc.literal + ');';
      runTest(t, name, src, '[object ' + cls + ']');
      // Primitives can never be instances.
      if (literalType === 'object' || literalType === 'function') {
        // Check literal is instanceof its contructor.
        name = c + 'LiteralIsInstanceof' + c;
        src = '(' + tc.literal + ') instanceof ' + c + ';';
        runTest(t, name, src, true);
      }
    }
  }
};

/**
 * Run some tests of switch statement with fallthrough.
 * @param {!T} t The test runner object.
 */
exports.testSwitchStatementFallthrough = function(t) {
  var code = `
      var x = 0;
      switch (i) {
        case 1:
          x += 1;
          // fall through
        case 2:
          x += 2;
          // fall through
        default:
          x += 16;
          // fall through
        case 3:
          x += 4;
          // fall through
        case 4:
          x += 8;
          // fall through
      }
      x;`;
  var expected = [28, 31, 30, 12, 8];
  for (var i = 0; i < expected.length; i++) {
    var src = 'var i = ' + i + ';\n' + code;
    runTest(t, 'switch fallthrough ' + i, src, expected[i]);
  }
};

/**
 * Run some tests of switch statement completion values.
 * @param {!T} t The test runner object.
 */
exports.testSwitchStatementBreaks = function(t) {
  var code = `
      foo: {
        switch (i) {
          case 1:
            10;
            // fall through
          case 2:
            20;
            break;
          default:
            50;
            // fall through
          case 3:
            30;
            break foo;
          case 4:
            40;
        }
      }`;
  var expected = [30, 20, 20, 30, 40];
  for (var i = 0; i < expected.length; i++) {
    var src = 'var i = ' + i + ';\n' + code;
    runTest(t, 'switch completion ' + i, src, expected[i]);
  }
};

/**
 * Run some tests of evaluation of binary expressions, as defined in
 * §11.5--11.11 of the ES5.1 spec.
 * @param {!T} t The test runner object.
 */
exports.testBinaryOp = function(t) {
  var cases = [
    // Addition / concatenation:
    ["1 + 1", 2],
    ["'1' + 1", '11'],
    ["1 + '1'", '11'],

    // Subtraction:
    ["'1' - 1", 0],

    // Multiplication:
    ["'5' * '5'", 25],

    ["-5 * 0", -0],
    ["-5 * -0", 0],

    ["1 * NaN", NaN],
    ["Infinity * NaN", NaN],
    ["-Infinity * NaN", NaN],

    ["Infinity * Infinity", Infinity],
    ["Infinity * -Infinity", -Infinity],
    ["-Infinity * -Infinity", Infinity],
    ["-Infinity * Infinity", -Infinity],
    // FIXME: add overflow/underflow cases

    // Division:
    ["35 / '7'", 5],

    ["1 / 1", 1],
    ["1 / -1", -1],
    ["-1 / -1", 1],
    ["-1 / 1", -1],

    ["1 / NaN", NaN],
    ["NaN / NaN", NaN],
    ["NaN / 1", NaN],

    ["Infinity / Infinity", NaN],
    ["Infinity / -Infinity", NaN],
    ["-Infinity / -Infinity", NaN],
    ["-Infinity / Infinity", NaN],

    ["Infinity / 0", Infinity],
    ["Infinity / -0", -Infinity],
    ["-Infinity / -0", Infinity],
    ["-Infinity / 0", -Infinity],

    ["Infinity / 1", Infinity],
    ["Infinity / -1", -Infinity],
    ["-Infinity / -1", Infinity],
    ["-Infinity / 1", -Infinity],

    ["1 / Infinity", 0],
    ["1 / -Infinity", -0],
    ["-1 / -Infinity", 0],
    ["-1 / Infinity", -0],

    ["0 / 0", NaN],
    ["0 / -0", NaN],
    ["-0 / -0", NaN],
    ["-0 / 0", NaN],

    ["1 / 0", Infinity],
    ["1 / -0", -Infinity],
    ["-1 / -0", Infinity],
    ["-1 / 0", -Infinity],
    // FIXME: add overflow/underflow cases

    // Remainder:
    ["20 % 5.5", 3.5],
    ["20 % -5.5", 3.5],
    ["-20 % -5.5", -3.5],
    ["-20 % 5.5", -3.5],

    ["1 % NaN", NaN],
    ["NaN % NaN", NaN],
    ["NaN % 1", NaN],

    ["Infinity % 1", NaN],
    ["-Infinity % 1", NaN],
    ["1 % 0", NaN],
    ["1 % -0", NaN],
    ["Infinity % 0", NaN],
    ["Infinity % -0", NaN],
    ["-Infinity % -0", NaN],
    ["-Infinity % 0", NaN],

    ["0 % 1", 0],
    ["-0 % 1", -0],
    // FIXME: add overflow/underflow cases

    // Left shift:
    ["10 << 2", 40],
    ["10 << 28", -1610612736],
    ["10 << 33", 20],
    ["10 << 34", 40],

    // Signed right shift:
    ["10 >> 4", 0],
    ["10 >> 33", 5],
    ["10 >> 34", 2],
    ["-11 >> 1", -6],
    ["-11 >> 2", -3],

    // Signed right shift:
    ["10 >>> 4", 0],
    ["10 >>> 33", 5],
    ["10 >>> 34", 2],
    ["-11 >>> 0", 0xfffffff5],
    ["-11 >>> 1", 0x7ffffffa],
    ["-11 >>> 2", 0x3ffffffd],
    ["4294967338 >>> 0", 42],

    // Bitwise:
    ["0x3 | 0x5", 0x7],
    ["0x3 ^ 0x5", 0x6],
    ["0x3 & 0x5", 0x1],

    ["NaN | 0", 0],
    ["-0 | 0", 0],
    ["Infinity | 0", 0],
    ["-Infinity | 0", 0],

    // Comparisons:
    //
    // (This is mainly about making sure that the binary operators are
    // hooked up to the abstract relational comparison algorithm
    // correctly; that algorithm is tested separately to make sure
    // details of comparisons are correct.)
    ["1 < 2", true],
    ["2 < 2", false],
    ["3 < 2", false],

    ["1 <= 2", true],
    ["2 <= 2", true],
    ["3 <= 2", false],

    ["1 > 2", false],
    ["2 > 2", false],
    ["3 > 2", true],

    ["1 >= 2", false],
    ["2 >= 2", true],
    ["3 >= 2", true],

    // (Ditto for abastract equality comparison algorithm.)
    ["1 == 1", true],
    ["2 == 1", false],
    ["2 == 2", true],
    ["1 == 2", false],

    ["1 == '1'", true],

    ["1 != 1", false],
    ["2 != 1", true],
    ["2 != 2", false],
    ["1 != 2", true],

    ["1 != '1'", false],

    // (Ditto for abastract strict equality comparison algorithm.)
    ["1 === 1", true],
    ["2 === 1", false],
    ["2 === 2", true],
    ["1 === 2", false],

    ["1 === '1'", false],

    ["1 !== 1", false],
    ["2 !== 1", true],
    ["2 !== 2", false],
    ["1 !== 2", true],

    ["1 !== '1'", true],
  ];
  for (var i = 0; i < cases.length; i++) {
    var tc = cases[i];
    var src = tc[0] + ';';
    runTest(t, 'BinaryExpression: ' + tc[0], src, tc[1]);
  }
};

/**
 * Run some tests of the Abstract Relational Comparison Algorithm, as
 * defined in §11.8.5 of the ES5.1 spec and as embodied by the '<'
 * operator.
 * @param {!T} t The test runner object.
 */
exports.testArca = function(t) {
  var cases = [
    ['0, NaN', undefined],
    ['NaN, NaN', undefined],
    ['NaN, 0', undefined],

    ['1, 1', false],
    ['0, -0', false],
    ['-0, 0', false],

    ['Infinity, Number.MAX_VALUE', false],
    ['Number.MAX_VALUE, Infinity', true],
    ['-Infinity, -Number.MAX_VALUE', true],
    ['-Number.MAX_VALUE, -Infinity', false],

    ['1, 2', true],
    ['2, 1', false],

    // String comparisons:
    ['"", ""', false],
    ['"", " "', true],
    ['" ", ""', false],
    ['" ", " "', false],
    ['"foo", "foobar"', true],
    ['"foo", "bar"', false],
    ['"foobar", "foo"', false],
    ['"10", "9"', true],
    ['"10", 9', false],

    // \ufb00 vs. \U0001f019: this test fails if we do simple
    // lexicographic comparison of UTF-8 or UTF-32.  The latter
    // character is a larger code point and sorts later in UTF8,
    // but in UTF16 it gets replaced by two surrogates, both of
    // which are smaller than \uf000.
    ['"ﬀ", "🀙"', false],

    // Mixed:
    ['11, "2"', false],  // Numeric
    ['2, "11"', true],   // Numeric
    ['"11", "2"', true], // String
  ];
  for (var i = 0; i < cases.length; i++) {
    var tc = cases[i];
    var src = `
        (function(a,b){
          return ((a < b) || (a >= b)) ? (a < b) : undefined;
        })(${tc[0]});`;
    runTest(t, 'ARCA: ' + tc[0], src, tc[1]);
  }
};

/**
 * Run some tests of the Abstract Equality Comparison Algorithm and
 * the Abstract Strict Equality Comparison Algorithm, as defined in
 * §11.9.3 and §11.9.6 respectiveyl of the ES5.1 spec and as embodied
 * by the '==' and '===' operators.
 * @param {!T} t The test runner object.
 */
exports.testAeca = function(t) {
  var cases = [
    ['false, false', true, true],  // Numeric
    ['false, true', false, false], // Numeric
    ['true, true', true, true],    // Numeric
    ['true, false', false, false], // Numeric

    // Numeric comparisons:
    ['0, NaN', false, false],
    ['NaN, NaN', false, false],
    ['NaN, 0', false, false],

    ['1, 1', true, true],
    ['0, -0', true, true],
    ['-0, 0', true, true],

    ['Infinity, Number.MAX_VALUE', false, false],
    ['Number.MAX_VALUE, Infinity', false, false],
    ['Infinity, -Number.MAX_VALUE', false, false],
    ['-Number.MAX_VALUE, -Infinity', false, false],

    ['1, 2', false, false],
    ['2, 1', false, false],

    // String comparisons:
    ['"", ""', true, true],
    ['"", " "', false, false],
    ['" ", ""', false, false],
    ['" ", " "', true, true],
    ['"foo", "foobar"', false, false],
    ['"foo", "bar"', false, false],
    ['"foobar", "foo"', false, false],
    ['"10", "9"', false, false],

    // Null / undefined:
    ['undefined, undefined', true, true],
    ['undefined, null', true, false],
    ['null, null', true, true],
    ['null, undefined', true, false],

    // Objects:
    ['Object.prototype, Object.prototype', true, true],
    ['{}, {}', false, false],

    // Mixed:
    ['"10", 10', true, false],   // Numeric
    ['10, "10"', true, false],   // Numeric
    ['"10", 9', false, false],   // Numeric
    ['"10", "9"', false, false], // String
    ['"10", "10"', true, true],  // String

    ['false, 0', true, false],  // Numeric
    ['false, 1', false, false], // Numeric
    ['true, 1', true, false],   // Numeric
    ['true, 0', false, false],  // Numeric
    ['0, false', true, false],  // Numeric
    ['1, false', false, false], // Numeric
    ['1, true', true, false],   // Numeric
    ['0, true', false, false],  // Numeric

    ['null, false', false, false],
    ['null, 0', false, false],
    ['null, ""', false, false],
    ['false, null', false, false],
    ['0, null', false, false],
    ['"", null', false, false],

    ['{}, false', false, false],
    ['{}, 0', false, false],
    ['{}, ""', false, false],
    ['{}, null', false, false],
    ['{}, undefined', false, false],
  ];
  for (var i = 0; i < cases.length; i++) {
    var tc = cases[i];
    var src = `(function(a,b){ return a == b })(${tc[0]});`;
    runTest(t, 'AECA: ' + tc[0], src, tc[1]);
    src = `(function(a,b){ return a === b })(${tc[0]});`;
    runTest(t, 'ASECA: ' + tc[0], src, tc[2]);
  }
};

/**
 * Run some tests of Number.toString(radix) with various different
 * radix arguments.
 * @param {!T} t The test runner object.
 */
exports.testNumberToString = function(t) {
  var cases = [
    ['(42).toString()', '42'],
    ['(42).toString(16)', '2a'],
    //['(-42.4).toString(5)', '-132.2'], Node incorrectly reports '-132.144444'.
    ['(42).toString("2")', '101010'],
    ['(-3.14).toString()', '-3.14'],
    ['(999999999999999999999999999).toString()', '1e+27'],
    ['(NaN).toString()', 'NaN'],
    ['(Infinity).toString()', 'Infinity'],
    ['(-Infinity).toString()', '-Infinity'],
  ];
  for (var i = 0; i < cases.length; i++) {
    var tc = cases[i];
    var src = tc[0] + ';';
    runTest(t, 'testNumberToString: ' + tc[0], src, tc[1]);
  }
};

/**
 * Unit tests for Interpreter.legalArrayIndex and
 * Interpreter.legalArrayLength.
 * @param {!T} t The test runner object.
 */
exports.testLegalArrayIndexLength = function(t) {
  var intrp = new Interpreter;
  var cases = [
    // [value, asIndex, asLength]
    [false, NaN, 0],
    [true, NaN, 1],

    [0, 0, 0],
    [1, 1, 1],
    [0xfffffffe, 0xfffffffe, 0xfffffffe],
    [0xffffffff, NaN, 0xffffffff],
    [0x100000000, NaN, NaN],
    [4.5, NaN, NaN],
    [-1, NaN, NaN],

    ['0', 0, 0],
    ['1', 1, 1],
    ['0xfffffffe', NaN, 0xfffffffe],
    ['0xffffffff', NaN, 0xffffffff],
    ['0x100000000', NaN, NaN],
    ['4294967294', 0xfffffffe, 0xfffffffe],
    ['4294967295', NaN, 0xffffffff],
    ['4294967296', NaN, NaN],
    ['4.5', NaN, NaN],
    ['-1', NaN, NaN],

    ['hello', NaN, NaN],
    [null, NaN, 0],  // wat
    [undefined, NaN, NaN],
    [new intrp.Array, NaN, 0],  // wat!
    [new intrp.Object, NaN, NaN],
  ];
  for (var i = 0; i < cases.length; i++) {
    var tc = cases[i];
    var name = 'testLegalArrayIndex: ' + tc[0];
    var r = Interpreter.legalArrayIndex(tc[0]);
    if (Object.is(r, tc[1])) {
      t.pass(name);
    } else {
      t.fail(name, util.format('got: %s  want: %s', String(r), String(tc[1])));
    }
    name = 'testLegalArrayLength: ' + tc[0];
    r = Interpreter.legalArrayLength(tc[0]);
    if (Object.is(r, tc[2])) {
      t.pass(name);
    } else {
      t.fail(name, util.format('got: %s  want: %s', String(r), String(tc[2])));
    }
  }
};

/**
 * Run a test of asynchronous functions:
 * @param {!T} t The test runner object.
 */
exports.testAsync = function(t) {
  var resolve, reject, arg, name, asyncFunc;
  var initFunc = function(intrp) {
    var wrapper = function(res, rej, a) {
      resolve = res;
      reject = rej;
      arg = a;
    };
    intrp.addVariableToScope(intrp.global, 'async',
        intrp.createAsyncFunction('async', wrapper));
  };

  // Test ordinary return.
  name = 'testAsyncResolve';
  asyncFunc = function(intrp) {
    resolve(arg);
  };
  var src = `
      'before';
      async();
      'between';
      async('af') + 'ter';
  `;
  runComplexTest(t, name, src, 'after', initFunc, asyncFunc);

  // Test throwing an exception.
  name ='testAsyncReject';
  asyncFunc = function(intrp) {
    reject('except');
  };
  src = `
      try {
        'before';
        async();
        'after';
      } catch (e) {
        e;
      }
  `;
  runComplexTest(t, name, src, 'except', initFunc, asyncFunc);

  // Extra check to verify async function can't resolve/reject more
  // than once without an asertion failure.
  name ='testAsyncSafetyCheck';
  var ok;
  asyncFunc = function(intrp) {
    resolve(ok);
    // Call reject; this is expected to blow up.
    try {
      reject('foo');
    } catch (e) {
      ok = 'ok';
    }
  };
  src = `
     async();
     async();
  `;
  runComplexTest(t, name, src, 'ok', initFunc, asyncFunc);

};

/**
 * Run a test of the suspend(), setTimeout() and clearTimeout()
 * functions.
 * @param {!T} t The test runner object.
 */
exports.testThreading = function(t) {
  var src = `
      'before';
      suspend();
      'after';
  `;
  runComplexTest(t, 'suspend()', src, 'after');

  // Function that simulates time passing, 100ms per invocation.
  var wait = function(intrp) {
    intrp.previousTime_ += 100;
  };

  src = `
      'before';
      suspend(10000);
      'after';
  `;
  runComplexTest(t, 'suspend(1000)', src, 'after', undefined, wait);

  src = `
      var s = '';
      setTimeout(function(x) { s += '2'; }, 500);
      setTimeout(function(x) { s += '4'; }, 1500);
      s += '1';
      suspend(1000);
      s += '3';
      suspend(1000);
      s += '5';
      s;
  `;
  runComplexTest(t, 'setTimeout', src, '12345', undefined, wait);

  src = `
      var s = '';
      var tid = setTimeout(function(a, b) {
          s += a;
          suspend();
          s += b;
      }, 0, '2', '4');
      s += 1;
      suspend();
      s += '3';
      clearTimeout(tid);
      suspend();
      s += '5';
      s;
  `;
  runComplexTest(t, 'clearTimeout', src, '1235', undefined, wait);
};

/**
 * Run a test of the .start() and .stop() methods on Interpreter
 * instances.  This is an async test because we use real (albeit
 * small) timeouts to make sure everything works as it ought to.
 * @param {!T} t The test runner object.
 */
exports.testStartStop = async function(t) {
  function snooze(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  var intrp = new Interpreter;
  var name = 'testStart';
  var src = `
      var x = 0;
      while (true) {
        suspend(10);
        x++;
      };
  `;
  intrp.createThread(es5);
  intrp.run();
  try {
    intrp.start();
    // .start() will create a zero-delay timeout to check for sleeping
    // tasks to awaken.  Snooze briefly to allow it to run, after
    // which there should be no outstanding timeouts.  This will
    // ensure that we verify .createThread() frobs .start() to get
    // things going again.
    await snooze(0);
    intrp.createThread(src);
    await snooze(29);
    intrp.stop();
  } catch (e) {
    t.crash(name, util.format('%s\n%s', src, e.stack));
    return;
  }
  var r = intrp.getValueFromScope(intrp.global, 'x');
  var expected = 2;
  if (Object.is(r, expected)) {
    t.pass(name);
  } else {
    t.fail(name, util.format('%s\ngot: %s  want: %s (after %d ms)', src,
        String(r), String(expected), 29));
  }

  // Check that .stop() actually stops thing.
  name = 'testStop';
  await snooze(10);
  var r = intrp.getValueFromScope(intrp.global, 'x');
  var expected = 2;
  if (Object.is(r, expected)) {
    t.pass(name);
  } else {
    t.fail(name, util.format('%s\ngot: %s  want: %s (after %d ms)', src,
        String(r), String(expected), 39));
  }
};

/**
 * Run tests of the networking subsystem.
 * @param {!T} t The test runner object.
 */
exports.testNetworking = async function(t) {
  //  Run a test of connectionListen() and connectionUnlisten(), and
  //  of the server receving data using the .recieve and .end methods
  //  on a connection object.
  var name = 'testNetworkInbound';
  var src = `
      var data = '', conn = {};
      conn.onReceive = function(d) {
        data += d;
      };
      conn.onEnd = function(d) {
        connectionUnlisten(8888);
        resolve(data);
      };
      connectionListen(8888, conn);
      send();
   `;
  var initFunc = function(intrp) {
    intrp.addVariableToScope(intrp.global, 'send', intrp.createNativeFunction(
        'send', function() {
          // Send some data to server.
          var client = net.createConnection({ port: 8888 }, function() {
            client.write('foo');
            client.write('bar');
            client.end();
          });
        }));
  };
  await runAsyncTest(t, name, src, 'foobar', initFunc);

  //  Run a test of the connectionListen(), connectionUnlisten(),
  //  connectionWrite() and connectionClose functions.
  name = 'testNetworkOutbound';
  src = `
      var conn = {};
      conn.onConnect = function() {
        connectionWrite(this, 'foo');
        connectionWrite(this, 'bar');
        connectionClose(this);
      };
      connectionListen(8888, conn);
      resolve(recieve());
      connectionUnlisten(8888);
   `;
  initFunc = function(intrp) {
    intrp.addVariableToScope(intrp.global, 'recieve', intrp.createAsyncFunction(
        'recieve', function(resolve, reject) {
          var reply = '';
          // Recieve some data from the server.
          var client = net.createConnection({ port: 8888 }, function() {
            client.on('data', function(data) {
              reply += data;
            });
            client.on('end', function() {
              resolve(reply);
            });
            client.on('error', function() {
              reject();
            });
          });
        }));
  };
  await runAsyncTest(t, name, src, 'foobar', initFunc);

  //  Check to make sure that connectionListen() throws if attempting
  //  to bind to an invalid port or rebind a port already in use.
  name = 'testConnectionListenThrows';
  src = `
      var ports = ['foo', {}, -1, 80.8, 9999, 65536];  // 9999 will be in use.
      var fails = ports.length;
      try {
        connectionListen(9999, {});
        for (var i = 0; i < ports.length; i++) {
          try {
            connectionListen(ports[i], {});
          } catch (e) {
            fails--;
          }
        }
      } finally {
        connectionUnlisten(9999);
      }
      resolve(fails);
   `;
  await runAsyncTest(t, name, src, 0);

  //  Check to make sure that connectionUnlisten() throws if attempting
  //  to unbind an invalid or not / no longer bound port.
  name = 'testConnectionUnlistenThrows';
  src = `
      var ports = ['foo', {}, -1, 80.8, 9999, 65536];
      var fails = ports.length;
      connectionListen(9999, {});
      connectionUnlisten(9999, {});
      for (var i = 0; i < ports.length; i++) {
        try {
          connectionUnlisten(ports[i], {});
        } catch (e) {
          fails--;
        }
      }
      resolve(fails);
   `;
  await runAsyncTest(t, name, src, 0);
};
