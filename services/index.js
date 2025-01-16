// services/index.js
// Equivalente ao models/index.js do Sequelize

const fs = require('fs');
const path = require('path');
const Sequelize = require('sequelize');
const basename = path.basename(__filename);
const env = process.env.NODE_ENV || 'development';
const configFile = require('../config/config.json')[env]; // config DB do config.json
const db = {};

// Cria instância do Sequelize
let sequelize;
if (configFile.use_env_variable) {
  sequelize = new Sequelize(process.env[configFile.use_env_variable], configFile);
} else {
  sequelize = new Sequelize(
    configFile.database,
    configFile.username,
    configFile.password,
    configFile
  );
}

// Lê todos os arquivos de model .js (exceto este index.js)
fs
  .readdirSync(path.join(__dirname, '../models'))
  .filter(file => {
    return (
      file.indexOf('.') !== 0 &&
      file !== basename &&
      (file.slice(-3) === '.js' || file.slice(-3) === '.ts')
    );
  })
  .forEach(file => {
    const model = require(path.join(__dirname, '../models', file))(
      sequelize,
      Sequelize.DataTypes
    );
    db[model.name] = model;
  });

// ---- ASSOCIAÇÕES -----
// Precisamos associar Purchase -> User
// Se seus models se chamam "User" e "Purchase", segue:
if (db.User && db.Purchase) {
  db.User.hasMany(db.Purchase, { foreignKey: 'userId' });
  db.Purchase.belongsTo(db.User, { foreignKey: 'userId' });
}

db.sequelize = sequelize;
db.Sequelize = Sequelize;

module.exports = db;
