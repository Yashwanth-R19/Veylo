const { isEven } = require('../server');

test('detects even numbers', () => {
  expect(isEven(4)).toBe(true);
});

test('detects odd numbers', () => {
  expect(isEven(3)).toBe(false);
});
