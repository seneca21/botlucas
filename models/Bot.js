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
            createdAt: {
                type: DataTypes.DATE,
                allowNull: false,
                defaultValue: DataTypes.NOW
            }
        },
        {
            tableName: 'Bots',
            timestamps: false  // Não ativa os timestamps automáticos, pois estamos definindo manualmente
        }
    );

    return Bot;
};