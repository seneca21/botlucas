// services/index.js

const { Sequelize, DataTypes } = require('sequelize');
const logger = require('./logger'); // Importa o logger, se necessário

const sequelize = new Sequelize('d79nkunl7qtudq', 'u28b183g4sl1bp', 'pe5c008c522cdf34fdd17659a53e7887844b6225c5e04ea408745e8941de9be7a', {
  host: 'c6sfjnr30ch74e.cluster-czrs8kj4isg7.us-east-1.rds.amazonaws.com',
  port: '5432',
  dialect: 'postgres',
  logging: false, // Desativa logs do Sequelize
  dialectOptions: {
    ssl: {
      require: true,
      rejectUnauthorized: false
    }
  }
});

// Definição dos modelos
const User = sequelize.define('User', {
  // Definição dos atributos
  telegramId: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  username: DataTypes.STRING,
  firstName: DataTypes.STRING,
  lastName: DataTypes.STRING,
  languageCode: DataTypes.STRING,
  isBot: DataTypes.BOOLEAN,
  lastInteraction: DataTypes.DATE,
  remarketingSent: DataTypes.BOOLEAN,
  hasPurchased: DataTypes.BOOLEAN,
  botName: DataTypes.STRING,
  planName: DataTypes.STRING,
  planValue: DataTypes.FLOAT
}, {
  // Outras opções do modelo
});

const Purchase = sequelize.define('Purchase', {
  // Definição dos atributos
  userId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  planName: DataTypes.STRING,
  planValue: DataTypes.FLOAT,
  botName: DataTypes.STRING,
  purchasedAt: DataTypes.DATE,
  originCondition: DataTypes.STRING
}, {
  // Outras opções do modelo
});

// Associações, se houver
User.hasMany(Purchase, { foreignKey: 'userId' });
Purchase.belongsTo(User, { foreignKey: 'userId' });

module.exports = {
  sequelize,
  User,
  Purchase
};
