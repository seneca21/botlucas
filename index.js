// index.js

const express = require('express');
const sequelize = require('./db');
const sendRemarketingMessages = require('./services/remarketing');

const app = express();

// Sincroniza os modelos com o banco de dados e altera tabelas conforme necessário
sequelize
  .sync({ alter: true })
  .then(() => {
    console.log('✅ Modelos sincronizados com o banco de dados.');

    // Inicia o bot (já iniciado no bot.service.js)
    console.log('🚀 Bot em execução.');

    // Configura a tarefa de remarketing para executar a cada intervalo definido
    const ConfigService = require('./services/config.service');
    const botConfig = ConfigService.loadConfig().bots[0];
    const intervalMinutes = botConfig.remarketing.interval_minutes || 1;

    setInterval(sendRemarketingMessages, intervalMinutes * 60 * 1000);
  })
  .catch((error) => {
    console.error('❌ Erro ao sincronizar modelos:', error);
  });

// Configurações Básicas do Express para Satisfazer Heroku
app.get('/', (req, res) => {
  res.send('Bot está funcionando corretamente.');
});

// Inicia o servidor Express na porta fornecida pelo Heroku
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
