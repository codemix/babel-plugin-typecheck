require("babel/register")({
  "stage": 0,
  "loose": ["es6.modules"],
  "optional": ["runtime", "es7.asyncFunctions", "utility.deadCodeElimination", "utility.inlineExpressions"],
  "plugins": [
    "./lib",
  ],
});
