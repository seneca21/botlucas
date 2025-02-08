// models/Purchase.js

module.exports = (sequelize, DataTypes) => {
    const Purchase = sequelize.define(
        'Purchase',
        {
            // Relação com userId
            userId: {
                type: DataTypes.INTEGER,
                allowNull: false
            },

            planName: {
                type: DataTypes.STRING,
                allowNull: false
            },

            planValue: {
                type: DataTypes.FLOAT,
                allowNull: false
            },

            botName: {
                type: DataTypes.STRING,
                allowNull: true
            },

            // Antes era always not null, mas pra evitar erros no alter, deixamos null
            purchasedAt: {
                type: DataTypes.DATE,
                allowNull: true
            },

            originCondition: {
                type: DataTypes.STRING,
                allowNull: false,
                defaultValue: 'main'
            },

            // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
            // Agora allowNull: true
            // para evitar erro nas linhas antigas
            // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
            pixGeneratedAt: {
                type: DataTypes.DATE,
                allowNull: true,
                defaultValue: DataTypes.NOW
            },

            // "pending" (gerado) ou "paid" (confirmado)
            status: {
                type: DataTypes.STRING,
                allowNull: false,
                defaultValue: 'pending'
            }
        },
        {
            tableName: 'Purchases',
            timestamps: false // Se não quiser createdAt/updatedAt
        }
    );

    return Purchase;
};
