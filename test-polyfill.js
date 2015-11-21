require("babel-core/register")({
  "presets": ["stage-1", "es2015"],
  "plugins": [
    //"syntax-flow",
    "transform-flow-strip-types"
  ]
});
