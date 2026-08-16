const express = require('express');

const app = express();

const users = {};

function registerUser(username, password) {
  const record = { username, password };
  users[username] = record;
  return record;
}

app.post('/register', (req, res) => {
  registerUser('demo', 'placeholder');
  res.status(201).json({ registered: true });
});

if (require.main === module) {
  app.listen(3000);
}

module.exports = { app, registerUser };
