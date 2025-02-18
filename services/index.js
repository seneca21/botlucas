// services/index.js

const { Sequelize } = require('sequelize');
const logger = require('./logger'); // caso precise de logger

// Conexão manual com Postgres
const sequelize = new Sequelize(
  'd36d4dkqgtr6ut',          // Nome do DB
  'ud4gfju6bdnki2',          // Usuário
  'p2dfc875746ebbd4c8f65e63ecbb29426db19f49b15c9ec1d3a8941553abef74c', // Senha
  {
    host: 'cbdhrtd93854d5.cluster-czrs8kj4isg7.us-east-1.rds.amazonaws.com',
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

// Importamos os models
const User = require('../models/User')(sequelize, Sequelize.DataTypes);
const Purchase = require('../models/Purchase')(sequelize, Sequelize.DataTypes);
const BotModel = require('../models/Bot')(sequelize, Sequelize.DataTypes); // <-- Novo Model Bot

// Relações
User.hasMany(Purchase, { foreignKey: 'userId' });
Purchase.belongsTo(User, { foreignKey: 'userId' });

// Exporta todos
module.exports = {
  sequelize,
  User,
  Purchase,
  BotModel
};
