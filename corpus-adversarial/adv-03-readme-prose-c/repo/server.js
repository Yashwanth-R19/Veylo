const express = require('express');

const app = express();

function addTwoNumbers(a, b) {
  return a + b;
}

app.get('/status', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

if (require.main === module) {
  app.listen(3000);
}

module.exports = { app, addTwoNumbers };
