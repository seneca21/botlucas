// services/index.js

const { Sequelize } = require('sequelize');
const logger = require('./logger'); // se necessário

// Cria a conexão com o banco de dados com as novas credenciais
const sequelize = new Sequelize(
  'd4tbpmqtecpvg3',          // Nome do DB
  'u8iqsvi6vhfqam',          // Usuário
  'pc59b97f3a93f97655eeb66088501a3c29c1e20d9b01f4c156beed3a7d4bc16e8', // Senha
  {
    host: 'c3nv2ev86aje4j.cluster-czrs8kj4isg7.us-east-1.rds.amazonaws.com',
    port: 5432,
    dialect: 'postgres',
    logging: false,
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false
      }
    }
  }
);

// Importa os modelos
const User = require('../models/User')(sequelize, Sequelize.DataTypes);
const Purchase = require('../models/Purchase')(sequelize, Sequelize.DataTypes);
const BotModel = require('../models/Bot')(sequelize, Sequelize.DataTypes); // <-- Importação do Bot

// Relações, se houver
User.hasMany(Purchase, { foreignKey: 'userId' });
Purchase.belongsTo(User, { foreignKey: 'userId' });

// Exporta todos os modelos
module.exports = {
  sequelize,
  User,
  Purchase,
  BotModel
};
