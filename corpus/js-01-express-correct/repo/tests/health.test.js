const { addNumbers } = require('../server');

test('adds numbers', () => {
  expect(addNumbers(2, 3)).toBe(5);
});

test('adds negative numbers', () => {
  expect(addNumbers(-1, 1)).toBe(0);
});
