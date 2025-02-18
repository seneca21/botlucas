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
        botName: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        planName: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        planValue: {
            type: DataTypes.FLOAT,
            allowNull: true,
        },

    }, {
        tableName: 'Users',
        // timestamps: true, // se quiser createdAt e updatedAt automáticos
    });

    return User;
};
