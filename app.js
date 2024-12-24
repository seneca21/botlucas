// app.js

//------------------------------------------------------
// 1) IMPORTS BÁSICOS
//------------------------------------------------------
const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');

// Importa a instância do Sequelize
const sequelize = require('./db'); // db.js com a conexão Postgres

// Importa o modelo
const UserModel = require('./models/User');
const { Op } = require('sequelize'); // Para poder usar Op.between, etc.

// Inicializa o modelo com a instância
const User = UserModel(sequelize);

//------------------------------------------------------
// 2) CONFIGURA EXPRESS
//------------------------------------------------------
const app = express();

// Middleware para JSON e para servir estáticos
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

//------------------------------------------------------
// 3) TESTA E SINCRONIZA DB (opcional aqui)
//------------------------------------------------------
sequelize.authenticate()
    .then(() => console.log('✅ Conexão com DB estabelecida com sucesso.'))
    .catch(err => console.error('❌ Erro ao conectar DB:', err));

sequelize.sync({ alter: true })
    .then(() => console.log('✅ Modelos sincronizados e tabelas alteradas.'))
    .catch(err => console.error('❌ Erro ao sincronizar os modelos:', err));

//------------------------------------------------------
// 4) ROTA PRINCIPAL -> ENVIA INDEX.HTML (DASHBOARD)
//------------------------------------------------------
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

//------------------------------------------------------
// 5) ROTA DE ESTATÍSTICAS: /api/bots-stats
//------------------------------------------------------
app.get('/api/bots-stats', async (req, res) => {
    try {
        const { date } = req.query;
        const selectedDate = date ? new Date(date) : new Date();

        // Construir intervalo [start, end]
        const startDate = new Date(selectedDate);
        startDate.setHours(0, 0, 0, 0);

        const endDate = new Date(selectedDate);
        endDate.setHours(23, 59, 59, 999);

        // Ex: totalUsers = usuários com lastInteraction no intervalo
        const totalUsers = await User.count({
            where: {
                lastInteraction: {
                    [Op.between]: [startDate, endDate]
                }
            }
        });

        // totalPurchases = usuários que compraram no intervalo
        // (depende de como você controla "data da compra")
        const totalPurchases = await User.count({
            where: {
                hasPurchased: true,
                // Se você controla a "data da compra" em outra coluna, use-a aqui.
                // Se for lastInteraction, mantenha assim.
                lastInteraction: {
                    [Op.between]: [startDate, endDate]
                }
            }
        });

        const conversionRate = totalUsers > 0
            ? (totalPurchases / totalUsers) * 100
            : 0;

        // Exemplo de "ranking de bots" (se você tiver user.botName)
        // Filtrando quem comprou no intervalo
        const botRankingRaw = await User.findAll({
            attributes: [
                'botName',
                [sequelize.fn('COUNT', sequelize.col('botName')), 'vendas']
            ],
            where: {
                hasPurchased: true,
                lastInteraction: {
                    [Op.between]: [startDate, endDate]
                },
                botName: {
                    [Op.ne]: null
                }
            },
            group: ['botName']
        });

        // Converte para um array simples
        const botRanking = botRankingRaw.map(item => ({
            botName: item.botName,
            vendas: item.getDataValue('vendas')
        }));

        // Monta objeto final
        const stats = {
            totalUsers,
            totalPurchases,
            conversionRate,
            botRanking
        };

        return res.json(stats);

    } catch (error) {
        console.error('❌ Erro ao obter estatísticas:', error);
        return res.status(500).json({ error: 'Erro ao obter estatísticas.' });
    }
});

//------------------------------------------------------
// 6) IMPORTA E INICIALIZA O BOT
//------------------------------------------------------
require('./services/bot.service.js');
// Assim, o bot roda junto com este servidor web

//------------------------------------------------------
// 7) SOBE O SERVIDOR (PROCESSO WEB)
//------------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🌐 Servidor web iniciado na porta ${PORT}`);
});
