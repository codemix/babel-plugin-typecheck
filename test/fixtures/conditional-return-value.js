export default function demo (): number|string {
  if (Math.random() > 0.3) {
    return stringGen();
  }
  else {
    return numberGen();
  }
}

function stringGen () {
  return "test";
}

function numberGen () {
  return 123;
}