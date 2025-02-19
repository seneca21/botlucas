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
            // Ativa os timestamps para que os campos createdAt e updatedAt sejam gerados
            timestamps: true,
            // Opcional: se desejar que os nomes dos campos sigam o padrão snake_case (created_at, updated_at)
            underscored: true
        }
    );

    return Bot;
};