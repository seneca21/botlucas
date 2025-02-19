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
                type: DataTypes.TEXT,
                allowNull: true
            },
            remarketingJson: {
                type: DataTypes.TEXT,
                allowNull: true
            }
        },
        {
            tableName: 'Bots',  // Tabela "Bots"
            timestamps: true,     // Ativa createdAt e updatedAt
            underscored: true     // Cria os campos como created_at e updated_at
        }
    );

    return Bot;
};