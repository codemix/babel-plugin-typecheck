const KEY_COMPONENT = Symbol('foo');

export default function demo () {
  let Component = createClass({
      constructor(block, options) {
          if (options.init) {
              this.init = options.init;
          }
          if (options.dispose) {
              this.dispose = options.dispose;
          }

          block[KEY_COMPONENT] = this;
      },

      init: null,
      dispose: null
  });

  return Component.constructor({}, {init: 123, dispose: 456});
}

function createClass (input) {
  return input;
}