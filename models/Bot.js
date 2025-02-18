// models/Bot.js

module.exports = (sequelize, DataTypes) => {
    const Bot = sequelize.define(
        'Bot',
        {
            name: {
                type: DataTypes.STRING,
                allowNull: false
            },
            token: {
                type: DataTypes.STRING,
                allowNull: false
            },
            description: {
                type: DataTypes.TEXT,
                allowNull: true
            },
            video: {
                type: DataTypes.STRING,
                allowNull: true
            },
            buttonsJson: {
                type: DataTypes.TEXT, // ou JSONB, caso queira
                allowNull: true
            },
            remarketingJson: {
                type: DataTypes.TEXT, // ou JSONB
                allowNull: true
            }
        },
        {
            tableName: 'Bots', // Faz o Sequelize criar a tabela "Bots"
            timestamps: false   // ou true, se quiser createdAt/updatedAt
        }
    );

    return Bot;
};
