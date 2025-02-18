// services/index.js

const { Sequelize } = require('sequelize');
const logger = require('./logger');

// Conexão:
const sequelize = new Sequelize(
  'd36d4dkqgtr6ut',
  'ud4gfju6bdnki2',
  'p2dfc875746ebbd4c8f65e63ecbb29426db19f49b15c9ec1d3a8941553abef74c',
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

// Import models
const User = require('../models/User')(sequelize, Sequelize.DataTypes);
const Purchase = require('../models/Purchase')(sequelize, Sequelize.DataTypes);
const Bot = require('../models/Bot')(sequelize, Sequelize.DataTypes);

// Relations
User.hasMany(Purchase, { foreignKey: 'userId' });
Purchase.belongsTo(User, { foreignKey: 'userId' });

// Export
module.exports = {
  sequelize,
  User,
  Purchase,
  Bot
};
