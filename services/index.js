// services/index.js

const { Sequelize } = require('sequelize');
// const logger = require('./logger'); // Se precisar habilitar logs, descomente

// Cria a conexão manualmente com as novas credenciais:
const sequelize = new Sequelize(
  'd79nkunl7qtudq',              // Nome do DB
  'u28b183g4sl1bp',              // Usuário
  'pe5c008c522cdf34fdd17659a53e7887844b6225c5e04ea408745e8941de9be7a', // Senha
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
