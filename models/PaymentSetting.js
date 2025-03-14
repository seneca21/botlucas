// models/PaymentSetting.js

module.exports = (sequelize, DataTypes) => {
    const PaymentSetting = sequelize.define('PaymentSetting', {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        pushinToken: {
            type: DataTypes.STRING,
            allowNull: false
        }
    }, {
        tableName: 'PaymentSettings',
        timestamps: false
    });

    return PaymentSetting;
};