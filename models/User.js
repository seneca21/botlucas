// models/User.js

module.exports = (sequelize) => {
    const { DataTypes } = require('sequelize');
    const User = sequelize.define('User', {
        telegramId: {
            type: DataTypes.STRING,
            unique: true,
            allowNull: false,
        },
        username: DataTypes.STRING,
        firstName: DataTypes.STRING,
        lastName: DataTypes.STRING,
        languageCode: DataTypes.STRING,
        isBot: DataTypes.BOOLEAN,
        lastInteraction: DataTypes.DATE,
        remarketingSent: {
            type: DataTypes.BOOLEAN,
            defaultValue: false,
        },
        hasPurchased: {
            type: DataTypes.BOOLEAN,
            defaultValue: false, // Inicialmente, o usuário não comprou
        },
    }, {
        tableName: 'Users',
    });

    return User;
};
