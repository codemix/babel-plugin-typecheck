export default function demo (input: Symbol): Symbol {
  return createSymbol('wat');
}


function createSymbol (label) {
  return Symbol(label);
}
