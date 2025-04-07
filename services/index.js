// services/index.js

const { Sequelize } = require('sequelize');
const logger = require('./logger'); // se necessário

// Cria a conexão com o banco de dados com as novas credenciais
const sequelize = new Sequelize(
  'd1kbv3l1itftpt',          // Nome do DB
  'u32sfehh2v583e',          // Usuário
  'p7411665fb1a40f39bee7369be09645902018271140295b5a0a2b42042940362e', // Senha
  {
    host: 'cb5ajfjosdpmil.cluster-czrs8kj4isg7.us-east-1.rds.amazonaws.com',
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
const BotModel = require('../models/Bot')(sequelize, Sequelize.DataTypes);
const PaymentSetting = require('../models/PaymentSetting')(sequelize, Sequelize.DataTypes); // <-- Novo modelo PaymentSetting

// Relações, se houver
User.hasMany(Purchase, { foreignKey: 'userId' });
Purchase.belongsTo(User, { foreignKey: 'userId' });

// Exporta todos os modelos
module.exports = {
  sequelize,
  User,
  Purchase,
  BotModel,
  PaymentSetting
};
