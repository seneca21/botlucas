// models/Purchase.js

module.exports = (sequelize, DataTypes) => {
    const Purchase = sequelize.define('Purchase', {
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
        purchasedAt: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW,
        },
    }, {
        tableName: 'Purchases',
        timestamps: false, // Se não quiser createdAt/updatedAt
    });

    return Purchase;
};
