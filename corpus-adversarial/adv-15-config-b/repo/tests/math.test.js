const { addTwoNumbers } = require('../server');

test('adds two numbers', () => {
  expect(addTwoNumbers(2, 3)).toBe(5);
});
