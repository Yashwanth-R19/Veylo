const express = require('express');

const app = express();

function isEven(n) {
  return n % 2 === 0;
}

app.get('/ping', (req, res) => {
  res.status(200).json({ pong: true });
});

if (require.main === module) {
  app.listen(3000);
}

module.exports = { app, isEven };
