/**
 * Do something
 */
export default function demo (input: string): number {

  /* typecheck: ignore statement */
  let foo: string = 123;

  /* typecheck: ignore statement */
  foo = 123;

  return input.length * 2;
}

// typecheck: ignore statement
function badFnLine (input: string = 123): boolean {
  return input;
}

/* typecheck: ignore statement */
function badFnBlock (input: string = 123): boolean  {
  return input;
}
