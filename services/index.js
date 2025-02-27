// services/index.js

const { Sequelize } = require('sequelize');
const logger = require('./logger'); // se necessário

// Cria a conexão com o banco de dados com as novas credenciais
const sequelize = new Sequelize(
  'deefe35i9plvl7',          // Nome do DB
  'ucahdtofln6o1c',          // Usuário
  'p5091a792840333d7cb39c5cf8461d5c9b2a223f6db70b93287977e0ba152229b', // Senha
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
