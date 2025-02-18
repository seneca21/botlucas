// models/Bot.js
module.exports = (sequelize, DataTypes) => {
    const Bot = sequelize.define('Bot', {
        name: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true
        },
        token: {
            type: DataTypes.STRING,
            allowNull: false
        },
        description: {
            type: DataTypes.STRING(3000),  // se precisar maior
            allowNull: true
        },
        video: {
            type: DataTypes.STRING,
            allowNull: true
        },
        buttonsJson: {
            type: DataTypes.TEXT, // Armazena JSON (ex: [{"name": "...","value":...}, ...])
            allowNull: true
        },
        remarketingJson: {
            type: DataTypes.TEXT, // Armazena JSON
            allowNull: true
        }
    }, {
        tableName: 'Bots', // tabela = "Bots"
        timestamps: false
    });

    return Bot;
};
