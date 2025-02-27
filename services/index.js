// services/index.js

const { Sequelize } = require('sequelize');
const logger = require('./logger'); // se necessário

// Cria a conexão com o banco de dados com as novas credenciais
const sequelize = new Sequelize(
  'd13ijjeo6khqca',          // Nome do DB
  'uk45hkh25hti8',           // Usuário
  'pe279989af5bc573b57149751ccbab42748832a89c3fd3d1db9b7978e0822fd49', // Senha
  {
    host: 'c6sfjnr30ch74e.cluster-czrs8kj4isg7.us-east-1.rds.amazonaws.com',
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
