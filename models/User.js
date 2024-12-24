// models/User.js

module.exports = (sequelize) => {
    const { DataTypes } = require('sequelize');

    const User = sequelize.define('User', {
        telegramId: {
            type: DataTypes.STRING,
            unique: true,
            allowNull: false,
        },
        username: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        firstName: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        lastName: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        languageCode: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        isBot: {
            type: DataTypes.BOOLEAN,
            defaultValue: false,
        },
        lastInteraction: {
            type: DataTypes.DATE,
            allowNull: true,
        },
        remarketingSent: {
            type: DataTypes.BOOLEAN,
            defaultValue: false,
        },
        hasPurchased: {
            type: DataTypes.BOOLEAN,
            defaultValue: false,
        },

        // BotName (nome do bot, se você quiser rastrear qual bot).
        botName: {
            type: DataTypes.STRING,
            allowNull: true,
        },

        // IMPORTANTE: planName e planValue
        planName: {
            type: DataTypes.STRING,
            allowNull: true, // Ex.: "Plano Mensal", "Plano Anual", etc.
        },
        planValue: {
            type: DataTypes.FLOAT,
            allowNull: true, // Ex.: 49.90, 99.00 etc.
        },

    }, {
        tableName: 'Users',
        // timestamps: true, // se quiser createdAt e updatedAt automáticos
    });

    return User;
};
