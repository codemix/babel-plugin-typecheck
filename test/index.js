describe('Typecheck', function () {
  it('should verify a return type', function () {
    function a (input: string): string {
      return input;
    }

    a();
  });
});