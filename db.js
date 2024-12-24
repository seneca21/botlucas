// db.js

const { Sequelize } = require('sequelize');

const sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: 'postgres',
    protocol: 'postgres',
    logging: false, // Desabilita logs SQL, opcional
    dialectOptions: {
        ssl: {
            require: true,
            rejectUnauthorized: false, // Importante para conexões com Heroku Postgres
        },
    },
});

module.exports = sequelize;
