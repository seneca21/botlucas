// models/Purchase.js

module.exports = (sequelize, DataTypes) => {
    const Purchase = sequelize.define(
        'Purchase',
        {
            // Seu userId (chave estrangeira)
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
            // Agora purchasedAt é opcional (null se estiver pendente)
            purchasedAt: {
                type: DataTypes.DATE,
                allowNull: true
            },
            // "main", "not_purchased", "purchased", etc
            originCondition: {
                type: DataTypes.STRING,
                allowNull: false,
                defaultValue: 'main'
            },
            // Campo para salvar data/hora em que o Pix foi gerado
            pixGeneratedAt: {
                type: DataTypes.DATE,
                allowNull: false,
                defaultValue: DataTypes.NOW
            },
            // "pending" (gerado) ou "paid" (quando confirmamos)
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
