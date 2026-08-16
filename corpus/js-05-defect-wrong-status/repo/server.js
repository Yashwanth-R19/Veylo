const express = require('express');

const app = express();

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.post('/created', (req, res) => {
  res.status(200).json({ created: true });
});

if (require.main === module) {
  app.listen(3000);
}

module.exports = { app };
