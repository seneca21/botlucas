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
            },
            // NOVO: Coluna para data de criação
            created_at: {
                type: DataTypes.DATE,
                allowNull: false,
                defaultValue: DataTypes.NOW
            },
            // NOVO: Coluna para data de atualização
            updated_at: {
                type: DataTypes.DATE,
                allowNull: false,
                defaultValue: DataTypes.NOW
            }
        },
        {
            tableName: 'Bots',  // Tabela "Bots"
            timestamps: false   // Desabilitamos o timestamps nativo, pois estamos definindo as colunas manualmente
        }
    );

    return Bot;
};