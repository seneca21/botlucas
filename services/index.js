// services/index.js

const { Sequelize } = require('sequelize');
const logger = require('./logger'); // se precisar

// Cria a conexão manualmente com as novas credenciais:
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

// Importamos os models (User.js e Purchase.js) de dentro de ../models
// Eles devem estar configurados com as colunas corretas (pixGeneratedAt etc.)
const User = require('../models/User')(sequelize, Sequelize.DataTypes);
const Purchase = require('../models/Purchase')(sequelize, Sequelize.DataTypes);

// Relações, se houver
User.hasMany(Purchase, { foreignKey: 'userId' });
Purchase.belongsTo(User, { foreignKey: 'userId' });

module.exports = {
  sequelize,
  User,
  Purchase
};
