const express = require('express');

const app = express();

app.post('/login', (req, res) => {
  res.status(200).json({ authenticated: true });
});

if (require.main === module) {
  app.listen(3000);
}

module.exports = { app };
