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
            tableName: 'Bots',  // o nome da tabela
            timestamps: false   // caso não queira createdAt/updatedAt
        }
    );

    return Bot;
};
