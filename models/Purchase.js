// models/Purchase.js

module.exports = (sequelize, DataTypes) => {
    const Purchase = sequelize.define(
        'Purchase',
        {
            // ========================================
            // CAMPOS ORIGINAIS:
            // ========================================
            planName: {
                type: DataTypes.STRING,
                allowNull: false,
            },
            planValue: {
                type: DataTypes.FLOAT,
                allowNull: false,
            },
            botName: {
                type: DataTypes.STRING,
                allowNull: true,
            },
            // Antes era allowNull: false e defaultValue: DataTypes.NOW
            // Agora, deixamos purchasedAt como nullable, pois só é preenchido se for pago
            purchasedAt: {
                type: DataTypes.DATE,
                allowNull: true,
            },
            // originCondition: "main", "not_purchased", "purchased", etc
            originCondition: {
                type: DataTypes.STRING,
                allowNull: false,
                defaultValue: 'main',
            },

            // ========================================
            // CAMPOS NOVOS (ADICIONADOS):
            // ========================================
            // Data em que o PIX foi gerado (criamos o registro)
            pixGeneratedAt: {
                type: DataTypes.DATE,
                allowNull: false,
                defaultValue: DataTypes.NOW,
            },
            // status: "pending" (gerado) ou "paid" (quando confirmamos o pagamento)
            status: {
                type: DataTypes.STRING,
                allowNull: false,
                defaultValue: 'pending',
            },
        },
        {
            tableName: 'Purchases',
            timestamps: false, // Se não quiser createdAt/updatedAt
        }
    );

    return Purchase;
};
