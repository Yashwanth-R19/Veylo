const { registerUser } = require('../server');

test('stores password hashed, not plaintext', () => {
  const record = registerUser('alice', 'secret123');
  expect(record.password.startsWith('$2')).toBe(true);
});
