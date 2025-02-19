//------------------------------------------------------
// app.js (com horário de Brasília)
//------------------------------------------------------
const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const session = require('express-session');
const { Op, Sequelize } = require('sequelize');

// Para upload de arquivos via S3 (Bucketeer)
const { S3Client } = require('@aws-sdk/client-s3');
const multerS3 = require('multer-s3-v3');
const multer = require('multer');
const fs = require('fs');

const db = require('./services/index'); // Index do Sequelize
const User = db.User;
const Purchase = db.Purchase;
const BotModel = db.BotModel; // IMPORTANTE: use o modelo BotModel exportado pelo index.js

const logger = require('./services/logger');
const ConfigService = require('./services/config.service');
const config = ConfigService.loadConfig(); // carrega config.json

// Importa funções para inicializar/editar bots
const { initializeBot, reloadBotsFromDB, updateBotInMemory } = require('./services/bot.service');

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// SESSÃO
app.use(session({
    secret: 'chave-super-secreta',
    resave: false,
    saveUninitialized: false
}));

// MIDDLEWARE: Checa se usuário está logado
function checkAuth(req, res, next) {
    if (req.session.loggedIn) {
        next();
    } else {
        res.redirect('/login');
    }
}

//------------------------------------------------------
// Conexão com o Banco de Dados
//------------------------------------------------------
db.sequelize
    .authenticate()
    .then(() => logger.info('✅ Conexão com DB estabelecida.'))
    .catch((err) => logger.error('❌ Erro ao conectar DB:', err));

db.sequelize
    .sync({ alter: true })
    .then(async () => {
        logger.info('✅ Modelos sincronizados (alter).');
        // Ao iniciar, recarregamos todos os bots já cadastrados no BD
        await reloadBotsFromDB();
    })
    .catch((err) => logger.error('❌ Erro ao sincronizar modelos:', err));

//------------------------------------------------------
// Configuração do Multer para uploads de vídeo via S3 (Bucketeer)
//------------------------------------------------------
const s3Client = new S3Client({
    region: process.env.BUCKETEER_AWS_REGION,
    credentials: {
        accessKeyId: process.env.BUCKETEER_AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.BUCKETEER_AWS_SECRET_ACCESS_KEY,
    }
});
const upload = multer({
    storage: multerS3({
        s3: s3Client,
        bucket: process.env.BUCKETEER_BUCKET_NAME,
        // Removida a propriedade "acl" pois o bucket não permite ACLs.
        key: function (req, file, cb) {
            const uniqueSuffix = Date.now() + '-' + file.originalname.replace(/\s/g, '_');
            cb(null, uniqueSuffix);
        }
    })
});

//------------------------------------------------------
// Rotas de LOGIN/LOGOUT
//------------------------------------------------------
app.get('/login', (req, res) => {
    const html = `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8">
      <title>Login</title>
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@4.6.2/dist/css/bootstrap.min.css">
      <style>
        body {
          background-color: #f8f9fa;
          display: flex;
          justify-content: center;
          align-items: center;
          height: 100vh;
          margin: 0;
        }
        .login-container {
          background-color: #fff;
          padding: 2rem;
          border-radius: 8px;
          box-shadow: 0 0 10px rgba(0,0,0,0.1);
          width: 300px;
        }
        .login-container h1 {
          font-size: 1.5rem;
          margin-bottom: 1.5rem;
          text-align: center;
        }
        .btn-login {
          border-radius: 50px;
        }
        .input-group-text {
          cursor: pointer;
        }
      </style>
    </head>
    <body>
      <div class="login-container">
        <h1>Login</h1>
        <form method="POST" action="/login">
          <div class="form-group">
            <label for="username">Usuário</label>
            <input type="text" class="form-control" id="username" name="username" placeholder="Digite seu usuário" required>
          </div>
          <div class="form-group">
            <label for="password">Senha</label>
            <div class="input-group">
              <input type="password" class="form-control" id="password" name="password" placeholder="Digite sua senha" required>
              <div class="input-group-append">
                <span class="input-group-text" id="togglePassword">&#128065;</span>
              </div>
            </div>
          </div>
          <button type="submit" class="btn btn-primary btn-block btn-login">Entrar</button>
        </form>
      </div>
      <script>
        document.getElementById('togglePassword').addEventListener('click', function () {
          const passwordInput = document.getElementById('password');
          const currentType = passwordInput.getAttribute('type');
          const newType = currentType === 'password' ? 'text' : 'password';
          passwordInput.setAttribute('type', newType);
        });
      </script>
    </body>
    </html>
  `;
    res.send(html);
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    const ADMIN_USER = 'perufe';
    const ADMIN_PASS = 'oppushin1234';

    if (username === ADMIN_USER && password === ADMIN_PASS) {
        req.session.loggedIn = true;
        logger.info(`✅ Usuário ${username} logou com sucesso.`);
        return res.redirect('/');
    } else {
        logger.warn(`❌ Tentativa de login inválida com usuário: ${username}`);
        return res.send('Credenciais inválidas. <a href="/login">Tentar novamente</a>');
    }
});

app.get('/logout', (req, res) => {
    const username = req.session.loggedIn ? 'Admin' : 'Desconhecido';
    req.session.destroy(() => {
        logger.info(`✅ Usuário ${username} deslogou.`);
        res.send('Você saiu! <a href="/login">Fazer login novamente</a>');
    });
});

//------------------------------------------------------
// Rota principal -> index.html
//------------------------------------------------------
app.get('/', checkAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Servimos a pasta public
app.use(checkAuth, express.static(path.join(__dirname, 'public')));

//------------------------------------------------------
// Rotas de ESTATÍSTICAS & BOT LIST
//------------------------------------------------------
// A rota /api/bots-list agora usa o BotModel (para o dropdown do painel)
app.get('/api/bots-list', checkAuth, async (req, res) => {
    try {
        const botRows = await BotModel.findAll();
        const botNames = botRows.map(b => b.name);
        res.json(botNames);
    } catch (err) {
        logger.error('Erro ao retornar lista de bots:', err);
        res.status(500).json({ error: 'Erro ao retornar lista de bots' });
    }
});

//=====================================================================
// ATENÇÃO: Ajuste para as estatísticas do painel
//=====================================================================
// Nesta versão usamos a função makeDay (que zera a data sem conversão de fuso)
// Essa é a versão que funcionava corretamente para os gráficos.
function makeDay(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}

// A função getDetailedStats permanece conforme sua implementação atual.
async function getDetailedStats(startDate, endDate, originCondition, botFilters = []) {
    let totalUsers = 0;
    let totalPurchases = 0;
    let sumGerado = 0;
    let sumConvertido = 0;
    let averagePaymentDelayMs = 0;
    let conversionRate = 0;

    try {
        if (originCondition === 'main') {
            const baseWhere = { pixGeneratedAt: { [Op.between]: [startDate, endDate] } };
            if (botFilters.length > 0 && !botFilters.includes('All')) {
                baseWhere.botName = { [Op.in]: botFilters };
            }
            const mainWhere = { ...baseWhere, originCondition: 'main' };
            const purchaseWhere = { ...mainWhere, purchasedAt: { [Op.between]: [startDate, endDate] } };
            totalUsers = await Purchase.count({
                where: mainWhere,
                distinct: true,
                col: 'userId'
            });
            totalPurchases = await Purchase.count({ where: purchaseWhere });
            sumGerado = (await Purchase.sum('planValue', { where: mainWhere })) || 0;
            sumConvertido = (await Purchase.sum('planValue', {
                where: { ...mainWhere, purchasedAt: { [Op.between]: [startDate, endDate] }, status: 'paid' }
            })) || 0;
            conversionRate = sumGerado > 0 ? (sumConvertido / sumGerado) * 100 : 0;
            const paidPurchases = await Purchase.findAll({
                where: { ...mainWhere, status: 'paid', purchasedAt: { [Op.between]: [startDate, endDate] } },
                attributes: ['pixGeneratedAt', 'purchasedAt']
            });
            let sumDiffMs = 0;
            let countPaid = 0;
            for (const p of paidPurchases) {
                if (p.pixGeneratedAt && p.purchasedAt) {
                    const diff = p.purchasedAt.getTime() - p.pixGeneratedAt.getTime();
                    if (diff >= 0) {
                        sumDiffMs += diff;
                        countPaid++;
                    }
                }
            }
            averagePaymentDelayMs = countPaid > 0 ? Math.round(sumDiffMs / countPaid) : 0;
        } else if (!originCondition) {
            const baseWhere = { pixGeneratedAt: { [Op.between]: [startDate, endDate] } };
            if (botFilters.length > 0 && !botFilters.includes('All')) {
                baseWhere.botName = { [Op.in]: botFilters };
            }
            const purchaseWhere = { ...baseWhere, purchasedAt: { [Op.between]: [startDate, endDate] } };
            let userWhere = { lastInteraction: { [Op.between]: [startDate, endDate] } };
            if (botFilters.length > 0 && !botFilters.includes('All')) {
                purchaseWhere.botName = { [Op.in]: botFilters };
                userWhere.botName = { [Op.in]: botFilters };
            }
            totalUsers = await User.count({ where: userWhere });
            totalPurchases = await Purchase.count({ where: purchaseWhere });
            sumGerado = (await Purchase.sum('planValue', { where: baseWhere })) || 0;
            sumConvertido = (await Purchase.sum('planValue', {
                where: { ...baseWhere, purchasedAt: { [Op.between]: [startDate, endDate] }, status: 'paid' }
            })) || 0;
            conversionRate = sumGerado > 0 ? (sumConvertido / sumGerado) * 100 : 0;
            const paidPurchases = await Purchase.findAll({
                where: { ...baseWhere, status: 'paid', purchasedAt: { [Op.between]: [startDate, endDate] } },
                attributes: ['pixGeneratedAt', 'purchasedAt']
            });
            let sumDiffMs = 0;
            let countPaid = 0;
            for (const p of paidPurchases) {
                if (p.pixGeneratedAt && p.purchasedAt) {
                    const diff = p.purchasedAt.getTime() - p.pixGeneratedAt.getTime();
                    if (diff >= 0) {
                        sumDiffMs += diff;
                        countPaid++;
                    }
                }
            }
            averagePaymentDelayMs = countPaid > 0 ? Math.round(sumDiffMs / countPaid) : 0;
        } else {
            const baseWhere = { pixGeneratedAt: { [Op.between]: [startDate, endDate] } };
            if (botFilters.length > 0 && !botFilters.includes('All')) {
                baseWhere.botName = { [Op.in]: botFilters };
            }
            const totalLeads = await Purchase.count({
                where: { ...baseWhere, originCondition },
                distinct: true,
                col: 'userId'
            });
            const totalConfirmed = await Purchase.count({
                where: { ...baseWhere, originCondition, status: 'paid' },
                distinct: true,
                col: 'userId'
            });
            sumGerado = (await Purchase.sum('planValue', { where: { ...baseWhere, originCondition } })) || 0;
            sumConvertido = (await Purchase.sum('planValue', { where: { ...baseWhere, originCondition, status: 'paid' } })) || 0;
            conversionRate = sumGerado > 0 ? (sumConvertido / sumGerado) * 100 : 0;
            const paidPurchases = await Purchase.findAll({
                where: { ...baseWhere, originCondition, status: 'paid' },
                attributes: ['pixGeneratedAt', 'purchasedAt']
            });
            let sumDiffMs = 0, countPaid = 0;
            for (const p of paidPurchases) {
                if (p.pixGeneratedAt && p.purchasedAt) {
                    const diff = p.purchasedAt.getTime() - p.pixGeneratedAt.getTime();
                    if (diff >= 0) {
                        sumDiffMs += diff;
                        countPaid++;
                    }
                }
            }
            averagePaymentDelayMs = countPaid > 0 ? Math.round(sumDiffMs / countPaid) : 0;
            totalUsers = totalLeads;
            totalPurchases = totalConfirmed;
        }
    } catch (err) {
        logger.error(`Erro interno em getDetailedStats: ${err.message}`);
    }

    return {
        totalUsers,
        totalPurchases,
        conversionRate,
        totalVendasGeradas: sumGerado,
        totalVendasConvertidas: sumConvertido,
        averagePaymentDelayMs
    };
}

// Rota /api/bots-stats – agora utilizando makeDay para definir as datas
app.get('/api/bots-stats', checkAuth, async (req, res) => {
    try {
        const {
            dateRange,
            startDate: customStart,
            endDate: customEnd,
            movStatus
        } = req.query;
        let { date } = req.query; // compatibilidade com param antigo
        let botFilters = [];
        if (req.query.botFilter) {
            botFilters = req.query.botFilter.split(',');
        }
        const page = parseInt(req.query.page) || 1;
        const perPage = parseInt(req.query.perPage) || 10;
        const offset = (page - 1) * perPage;
        let startDate, endDate;
        if (dateRange) {
            switch (dateRange) {
                case 'today': {
                    const todayStart = makeDay(new Date());
                    startDate = todayStart;
                    endDate = new Date(todayStart);
                    endDate.setHours(23, 59, 59, 999);
                    break;
                }
                case 'yesterday': {
                    const todayStart = makeDay(new Date());
                    const yesterdayStart = new Date(todayStart);
                    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
                    startDate = yesterdayStart;
                    endDate = new Date(yesterdayStart);
                    endDate.setHours(23, 59, 59, 999);
                    break;
                }
                case 'last7': {
                    const todayStart = makeDay(new Date());
                    const last7Start = new Date(todayStart);
                    last7Start.setDate(last7Start.getDate() - 6);
                    startDate = last7Start;
                    endDate = new Date(todayStart);
                    endDate.setHours(23, 59, 59, 999);
                    break;
                }
                case 'last30': {
                    const todayStart = makeDay(new Date());
                    const last30Start = new Date(todayStart);
                    last30Start.setDate(last30Start.getDate() - 29);
                    startDate = last30Start;
                    endDate = new Date(todayStart);
                    endDate.setHours(23, 59, 59, 999);
                    break;
                }
                case 'lastMonth': {
                    const todayStart = makeDay(new Date());
                    const firstDayThisMonth = new Date(todayStart);
                    firstDayThisMonth.setDate(1);
                    const lastDayLastMonth = new Date(firstDayThisMonth);
                    lastDayLastMonth.setDate(lastDayLastMonth.getDate() - 1);
                    lastDayLastMonth.setHours(23, 59, 59, 999);
                    const firstDayLastMonth = makeDay(lastDayLastMonth);
                    firstDayLastMonth.setDate(1);
                    startDate = firstDayLastMonth;
                    endDate = lastDayLastMonth;
                    break;
                }
                case 'custom': {
                    startDate = customStart ? makeDay(new Date(customStart)) : makeDay(new Date());
                    if (customEnd) {
                        endDate = new Date(makeDay(new Date(customEnd)));
                        endDate.setHours(23, 59, 59, 999);
                    } else {
                        endDate = new Date(startDate);
                        endDate.setHours(23, 59, 59, 999);
                    }
                    break;
                }
            }
        }
        if (!startDate || !endDate) {
            let dateArray;
            if (date && date.includes(',')) {
                dateArray = date.split(',').map(d => d.trim()).filter(d => d);
            } else if (date) {
                dateArray = [date.trim()];
            } else {
                const todayStart = makeDay(new Date());
                startDate = todayStart;
                endDate = new Date(todayStart);
                endDate.setHours(23, 59, 59, 999);
            }
            if (!startDate || !endDate) {
                if (dateArray && dateArray.length === 1) {
                    startDate = makeDay(new Date(dateArray[0]));
                    endDate = new Date(startDate);
                    endDate.setHours(23, 59, 59, 999);
                } else if (dateArray && dateArray.length > 1) {
                    const dateObjs = dateArray.map(d => new Date(d));
                    const minDate = new Date(Math.min(...dateObjs));
                    const maxDate = new Date(Math.max(...dateObjs));
                    startDate = makeDay(minDate);
                    endDate = makeDay(maxDate);
                    endDate.setHours(23, 59, 59, 999);
                }
            }
        }
        if (!startDate || !endDate) {
            const todayStart = makeDay(new Date());
            startDate = todayStart;
            endDate = new Date(todayStart);
            endDate.setHours(23, 59, 59, 999);
        }

        const [statsAll, statsMain, statsNotPurchased, statsPurchased, statsYesterday] = await Promise.all([
            getDetailedStats(startDate, endDate, null, botFilters),
            getDetailedStats(startDate, endDate, 'main', botFilters),
            getDetailedStats(startDate, endDate, 'not_purchased', botFilters),
            getDetailedStats(startDate, endDate, 'purchased', botFilters),
            (async () => {
                const yesterdayStart = makeDay(new Date(new Date(startDate).setDate(startDate.getDate() - 1)));
                const yesterdayEnd = new Date(yesterdayStart);
                yesterdayEnd.setHours(23, 59, 59, 999);
                return await getDetailedStats(yesterdayStart, yesterdayEnd, null, botFilters);
            })()
        ]);

        const botRankingRaw = await Purchase.findAll({
            attributes: [
                'botName',
                [Sequelize.fn('COUNT', Sequelize.col('botName')), 'vendas'],
            ],
            where: {
                purchasedAt: { [Op.between]: [startDate, endDate] },
            },
            group: ['botName'],
            order: [[Sequelize.literal('"vendas"'), 'DESC']],
        });
        const botRanking = botRankingRaw.map(item => ({
            botName: item.botName,
            vendas: parseInt(item.getDataValue('vendas'), 10) || 0,
        }));

        const botsWithPurchases = await Purchase.findAll({
            attributes: [
                'botName',
                [Sequelize.fn('COUNT', Sequelize.col('botName')), 'totalPurchases'],
                [Sequelize.fn('SUM', Sequelize.col('planValue')), 'totalValue'],
            ],
            where: {
                purchasedAt: { [Op.between]: [startDate, endDate] },
                botName: { [Op.ne]: null },
            },
            group: ['botName'],
        });

        const generatedByBot = await Purchase.findAll({
            attributes: [
                'botName',
                [Sequelize.fn('SUM', Sequelize.col('planValue')), 'generatedValue']
            ],
            where: {
                pixGeneratedAt: { [Op.between]: [startDate, endDate] },
                botName: { [Op.ne]: null }
            },
            group: ['botName']
        });
        const generatedMap = {};
        generatedByBot.forEach(item => {
            generatedMap[item.botName] = parseFloat(item.getDataValue('generatedValue')) || 0;
        });

        const botsWithInteractions = await User.findAll({
            attributes: [
                'botName',
                [Sequelize.fn('COUNT', Sequelize.col('botName')), 'totalUsers'],
            ],
            where: {
                lastInteraction: { [Op.between]: [startDate, endDate] },
                botName: { [Op.ne]: null },
            },
            group: ['botName'],
        });
        const botUsersMap = {};
        botsWithInteractions.forEach(item => {
            const bName = item.botName;
            const uCount = parseInt(item.getDataValue('totalUsers'), 10) || 0;
            botUsersMap[bName] = uCount;
        });

        const planSalesByBot = await Purchase.findAll({
            attributes: [
                'botName',
                'planName',
                [Sequelize.fn('COUNT', Sequelize.col('planName')), 'salesCount'],
                [Sequelize.fn('SUM', Sequelize.col('planValue')), 'sumValue'],
            ],
            where: {
                purchasedAt: { [Op.between]: [startDate, endDate] },
                planName: { [Op.ne]: null },
                botName: { [Op.ne]: null },
            },
            group: ['botName', 'planName'],
            order: [[Sequelize.literal('"salesCount"'), 'DESC']],
        });
        const botPlansMap = {};
        planSalesByBot.forEach(row => {
            const bName = row.botName;
            const pName = row.planName;
            const sCount = parseInt(row.getDataValue('salesCount'), 10) || 0;
            const tValue = parseFloat(row.getDataValue('sumValue')) || 0;
            if (!botPlansMap[bName]) botPlansMap[bName] = {};
            botPlansMap[bName][pName] = { salesCount: sCount, totalValue: tValue };
        });

        const botDetails = [];
        for (const bot of botsWithPurchases) {
            const bName = bot.botName;
            const totalPurchasesBot = parseInt(bot.getDataValue('totalPurchases'), 10) || 0;
            const totalValueBot = parseFloat(bot.getDataValue('totalValue')) || 0;
            const totalUsersBot = await Purchase.count({
                where: {
                    pixGeneratedAt: { [Op.between]: [startDate, endDate] },
                    originCondition: 'main',
                    botName: bName
                },
                distinct: true,
                col: 'userId'
            });
            const generatedForBot = (await Purchase.sum('planValue', {
                where: {
                    pixGeneratedAt: { [Op.between]: [startDate, endDate] },
                    originCondition: 'main',
                    botName: bName
                }
            })) || 0;
            const conversionRateBot = generatedForBot > 0 ? (totalValueBot / generatedForBot) * 100 : 0;
            const averageValueBot = totalPurchasesBot > 0 ? totalValueBot / totalPurchasesBot : 0;
            const plansObj = botPlansMap[bName] || {};
            const plansArray = [];
            for (const [planName, info] of Object.entries(plansObj)) {
                const planConvRate = totalUsersBot > 0 ? (info.salesCount / totalUsersBot) * 100 : 0;
                plansArray.push({
                    planName,
                    salesCount: info.salesCount,
                    conversionRate: planConvRate,
                });
            }
            botDetails.push({
                botName: bName,
                valorGerado: totalValueBot,
                totalPurchases: totalPurchasesBot,
                totalUsers: totalUsersBot,
                conversionRate: conversionRateBot,
                averageValue: averageValueBot,
                plans: plansArray,
            });
        }
        botDetails.sort((a, b) => b.valorGerado - a.valorGerado);

        const stats7Days = [];
        for (let i = 6; i >= 0; i--) {
            const tempDate = new Date(startDate);
            tempDate.setDate(tempDate.getDate() - i);
            const dayStart = makeDay(tempDate);
            const dayEnd = new Date(dayStart);
            dayEnd.setHours(23, 59, 59, 999);
            const dayStat = await getDetailedStats(dayStart, dayEnd, null, botFilters) || {};
            stats7Days.push({
                date: dayStart.toISOString().split('T')[0],
                totalVendasConvertidas: dayStat.totalVendasConvertidas || 0,
                totalVendasGeradas: dayStat.totalVendasGeradas || 0
            });
        }

        const lastMovementsWhere = {
            pixGeneratedAt: { [Op.between]: [startDate, endDate] }
        };
        if (movStatus === 'pending') {
            lastMovementsWhere.status = 'pending';
        } else if (movStatus === 'paid') {
            lastMovementsWhere.status = 'paid';
        }
        if (botFilters.length > 0 && !botFilters.includes('All')) {
            lastMovementsWhere.botName = { [Op.in]: botFilters };
        }
        const { rows: lastMovements, count: totalMovements } = await Purchase.findAndCountAll({
            attributes: ['pixGeneratedAt', 'purchasedAt', 'planValue', 'status'],
            where: lastMovementsWhere,
            order: [['pixGeneratedAt', 'DESC']],
            limit: perPage,
            offset: offset,
            include: [{
                model: User,
                attributes: ['telegramId']
            }]
        });

        res.json({
            statsAll,
            statsYesterday,
            statsMain,
            statsNotPurchased,
            statsPurchased,
            botRanking,
            botDetails,
            stats7Days,
            lastMovements,
            totalMovements
        });
    } catch (error) {
        logger.error('❌ Erro ao obter estatísticas:', error);
        res.status(500).json({ error: 'Erro ao obter estatísticas' });
    }
});

//------------------------------------------------------
// Rotas de Gerenciar Bots (sem alterações na estrutura)
//------------------------------------------------------
app.post('/admin/bots', checkAuth, upload.single('videoFile'), async (req, res) => {
    try {
        const payload = req.body;
        const {
            name,
            token,
            description,
            buttonName1,
            buttonValue1,
            buttonName2,
            buttonValue2,
            buttonName3,
            buttonValue3,
            remarketingJson
        } = payload;
        const buttons = [];
        function pushButtonIfValid(bName, bValue) {
            if (bName && bName.trim() !== '' && bValue && !isNaN(parseFloat(bValue))) {
                buttons.push({ name: bName.trim(), value: parseFloat(bValue) });
            }
        }
        pushButtonIfValid(buttonName1, buttonValue1);
        pushButtonIfValid(buttonName2, buttonValue2);
        pushButtonIfValid(buttonName3, buttonValue3);
        const buttonsJson = JSON.stringify(buttons);
        const safeRemarketingJson = remarketingJson || '';
        let videoFilename = '';
        if (req.file) {
            videoFilename = req.file.location;
        }
        const newBot = await BotModel.create({
            name,
            token,
            description,
            video: videoFilename,
            buttonsJson,
            remarketingJson: safeRemarketingJson
        });
        logger.info(`✅ Bot ${name} inserido no BD.`);
        const bc = {
            name: newBot.name,
            token: newBot.token,
            description: newBot.description,
            video: newBot.video,
            buttons: buttons,
            remarketing: {}
        };
        if (safeRemarketingJson) {
            try {
                let trimmed = safeRemarketingJson.trim();
                if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
                    bc.remarketing = JSON.parse(trimmed);
                } else {
                    bc.remarketing = {};
                    logger.warn(`Remarketing JSON para o bot ${newBot.name} não é válido. Usando objeto vazio.`);
                }
            } catch (e) {
                logger.warn(`Remarketing JSON inválido para o bot ${newBot.name}.`, e);
                bc.remarketing = {};
            }
        }
        initializeBot(bc);
        res.send(`
            <div class="alert alert-success">
              Bot <strong>${name}</strong> cadastrado e iniciado com sucesso!
            </div>
        `);
    } catch (err) {
        logger.error('Erro ao criar bot:', err);
        res.status(500).send('Erro ao criar bot: ' + err.message);
    }
});

app.get('/admin/bots/list', checkAuth, async (req, res) => {
    try {
        const bots = await BotModel.findAll();
        res.json(bots);
    } catch (err) {
        logger.error('Erro ao listar bots:', err);
        res.status(500).json({ error: 'Erro ao listar bots' });
    }
});

app.get('/admin/bots/:id', checkAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const bot = await BotModel.findByPk(id);
        if (!bot) {
            return res.status(404).json({ error: 'Bot não encontrado' });
        }
        res.json(bot);
    } catch (err) {
        logger.error('Erro ao obter bot:', err);
        res.status(500).json({ error: 'Erro ao obter bot' });
    }
});

app.post('/admin/bots/edit/:id', checkAuth, upload.single('videoFile'), async (req, res) => {
    try {
        const { id } = req.params;
        const bot = await BotModel.findByPk(id);
        if (!bot) {
            return res.status(404).send('Bot não encontrado');
        }
        const {
            name,
            token,
            description,
            buttonName1,
            buttonValue1,
            buttonName2,
            buttonValue2,
            buttonName3,
            buttonValue3,
            remarketingJson
        } = req.body;
        const buttons = [];
        function pushButtonIfValid(bName, bValue) {
            if (bName && bName.trim() !== '' && bValue && !isNaN(parseFloat(bValue))) {
                buttons.push({ name: bName.trim(), value: parseFloat(bValue) });
            }
        }
        pushButtonIfValid(buttonName1, buttonValue1);
        pushButtonIfValid(buttonName2, buttonValue2);
        pushButtonIfValid(buttonName3, buttonValue3);
        const buttonsJson = JSON.stringify(buttons);
        let videoFilename = bot.video;
        if (req.file) {
            videoFilename = req.file.location;
        }
        const safeRemarketingJson = remarketingJson || '';
        bot.name = name;
        bot.token = token;
        bot.description = description;
        bot.video = videoFilename;
        bot.buttonsJson = buttonsJson;
        bot.remarketingJson = safeRemarketingJson;
        await bot.save();
        logger.info(`✅ Bot ${name} (ID ${bot.id}) atualizado no BD.`);
        const bc = {
            name: bot.name,
            token: bot.token,
            description: bot.description,
            video: bot.video,
            buttons: buttons,
            remarketing: {}
        };
        if (safeRemarketingJson) {
            try {
                let trimmed = safeRemarketingJson.trim();
                if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
                    bc.remarketing = JSON.parse(trimmed);
                } else {
                    bc.remarketing = {};
                    logger.warn(`Remarketing JSON para o bot ${bot.name} não é válido. Usando objeto vazio.`);
                }
            } catch (e) {
                logger.warn(`Remarketing JSON inválido para o bot ${bot.name}.`, e);
                bc.remarketing = {};
            }
        }
        updateBotInMemory(id, bc);
        res.send(`
            <div class="alert alert-success">
              Bot <strong>${bot.name}</strong> atualizado e reiniciado com sucesso!
            </div>
        `);
    } catch (err) {
        logger.error('Erro ao editar bot:', err);
        res.status(500).send('Erro ao editar bot: ' + err.message);
    }
});

//------------------------------------------------------
// Atualização do Painel (Dashboard)
//------------------------------------------------------
/* Função para preencher os dados do painel – agora inclui também a seção "Stats Detalhadas" */
function fillDashboardData(data) {
    // Cards fixos da aba "Estatísticas" (primeira aba)
    $('#totalUsers').text(data.statsAll.totalUsers);
    $('#totalPurchases').text(data.statsAll.totalPurchases);
    $('#conversionRate').text(data.statsAll.conversionRate.toFixed(2) + '%');
    const avgPayDelayMs = data.statsAll.averagePaymentDelayMs || 0;
    $('#avgPaymentTimeText').text(formatDuration(avgPayDelayMs));

    // Gráfico de Barras
    const barData = {
        labels: ['Usuários', 'Compras'],
        datasets: [
            {
                label: 'Quantidade',
                data: [data.statsAll.totalUsers, data.statsAll.totalPurchases],
                backgroundColor: ['#36A2EB', '#FF0000']
            },
        ],
    };
    const barCtx = document.getElementById('salesChart').getContext('2d');
    if (!window.salesChart) {
        window.salesChart = new Chart(barCtx, {
            type: 'bar',
            data: barData,
            options: {
                responsive: true,
                scales: { y: { beginAtZero: true } },
                plugins: { chartBackground: {} }
            }
        });
    } else {
        window.salesChart.data = barData;
    }
    applyChartOptions(window.salesChart);
    window.salesChart.update();

    // Gráfico de Linha
    const lineLabels = data.stats7Days.map(item => {
        const parts = item.date.split('-');
        return `${parts[2]}/${parts[0]}`;
    });
    const convertedValues = data.stats7Days.map(item => item.totalVendasConvertidas);
    const generatedValues = data.stats7Days.map(item => item.totalVendasGeradas);
    const conversionRates = data.stats7Days.map(item => {
        return item.totalVendasGeradas > 0 ? (item.totalVendasConvertidas / item.totalVendasGeradas) * 100 : 0;
    });
    const lineData = {
        labels: lineLabels,
        datasets: [
            {
                label: 'Valor Convertido (R$)',
                data: convertedValues,
                fill: false,
                borderColor: '#ff5c5c',
                pointBackgroundColor: '#ff5c5c',
                pointHoverRadius: 6,
                tension: 0.4,
                cubicInterpolationMode: 'monotone',
                yAxisID: 'y-axis-convertido'
            },
            {
                label: 'Valor Gerado (R$)',
                data: generatedValues,
                fill: false,
                borderColor: '#36A2EB',
                pointBackgroundColor: '#36A2EB',
                pointHoverRadius: 6,
                tension: 0.4,
                cubicInterpolationMode: 'monotone',
                yAxisID: 'y-axis-gerado'
            },
            {
                label: 'Taxa de Conversão (%)',
                data: conversionRates,
                fill: false,
                borderColor: 'green',
                pointBackgroundColor: 'green',
                pointHoverRadius: 6,
                tension: 0.4,
                cubicInterpolationMode: 'monotone',
                yAxisID: 'y-axis-conversion'
            }
        ]
    };
    const lineCtx = document.getElementById('lineComparisonChart').getContext('2d');
    if (!window.lineComparisonChart) {
        window.lineComparisonChart = new Chart(lineCtx, {
            type: 'line',
            data: lineData,
            options: {
                responsive: true,
                scales: {
                    'y-axis-convertido': { type: 'linear', position: 'left', beginAtZero: true, offset: true },
                    'y-axis-gerado': { type: 'linear', position: 'right', beginAtZero: true, offset: true, grid: { drawOnChartArea: false } },
                    'y-axis-conversion': {
                        type: 'linear', position: 'right', beginAtZero: true, offset: true,
                        suggestedMax: 100,
                        grid: { drawOnChartArea: false },
                        ticks: { callback: value => value + '%' }
                    },
                    x: {}
                },
                plugins: {
                    chartBackground: {},
                    tooltip: {
                        callbacks: {
                            label: function (ctx) {
                                const value = ctx.parsed.y || 0;
                                return ctx.dataset.label === 'Taxa de Conversão (%)'
                                    ? `Taxa: ${value.toFixed(2)}%`
                                    : `R$ ${value.toFixed(2)}`;
                            }
                        }
                    }
                }
            }
        });
    } else {
        window.lineComparisonChart.data = lineData;
    }
    applyChartOptions(window.lineComparisonChart);
    window.lineComparisonChart.update();

    // Ranking Simples
    const botRankingTbody = $('#botRanking');
    botRankingTbody.empty();
    if (data.botRanking && data.botRanking.length > 0) {
        data.botRanking.forEach(bot => {
            botRankingTbody.append(`
                <tr>
                    <td>${bot.botName || 'N/A'}</td>
                    <td>${bot.vendas}</td>
                </tr>
            `);
        });
    } else {
        botRankingTbody.append(`<tr><td colspan="2">Nenhum dado encontrado</td></tr>`);
    }

    // Ranking Detalhado
    const detailsTbody = $('#botDetailsBody');
    detailsTbody.empty();
    if (data.botDetails && data.botDetails.length > 0) {
        data.botDetails.forEach(bot => {
            let plansHtml = '';
            bot.plans.forEach(plan => {
                plansHtml += `${plan.planName}: ${plan.salesCount} vendas (${plan.conversionRate.toFixed(2)}%)<br>`;
            });
            detailsTbody.append(`
                <tr>
                    <td>${bot.botName}</td>
                    <td>R$${bot.valorGerado.toFixed(2)}</td>
                    <td>${bot.totalPurchases}</td>
                    <td>${plansHtml}</td>
                    <td>${bot.conversionRate.toFixed(2)}%</td>
                    <td>R$${bot.averageValue.toFixed(2)}</td>
                </tr>
            `);
        });
    } else {
        detailsTbody.append(`<tr><td colspan="6">Nenhum dado encontrado</td></tr>`);
    }

    // Estatísticas Fixas (cards já existentes)
    $('#cardAllLeads').text(data.statsAll.totalUsers);
    $('#cardAllPaymentsConfirmed').text(data.statsAll.totalPurchases);
    $('#cardAllConversionRateDetailed').text(`${data.statsAll.conversionRate.toFixed(2)}%`);
    $('#cardAllTotalVolume').text(`R$ ${data.statsAll.totalVendasGeradas.toFixed(2)}`);
    $('#cardAllTotalPaidVolume').text(`R$ ${data.statsAll.totalVendasConvertidas.toFixed(2)}`);

    $('#cardMainLeads').text(data.statsMain.totalUsers);
    $('#cardMainPaymentsConfirmed').text(data.statsMain.totalPurchases);
    $('#cardMainConversionRateDetailed').text(`${data.statsMain.conversionRate.toFixed(2)}%`);
    $('#cardMainTotalVolume').text(`R$ ${data.statsMain.totalVendasGeradas.toFixed(2)}`);
    $('#cardMainTotalPaidVolume').text(`R$ ${data.statsMain.totalVendasConvertidas.toFixed(2)}`);

    $('#cardNotPurchasedLeads').text(data.statsNotPurchased.totalUsers);
    $('#cardNotPurchasedPaymentsConfirmed').text(data.statsNotPurchased.totalPurchases);
    $('#cardNotPurchasedConversionRateDetailed').text(`${data.statsNotPurchased.conversionRate.toFixed(2)}%`);
    $('#cardNotPurchasedTotalVolume').text(`R$ ${data.statsNotPurchased.totalVendasGeradas.toFixed(2)}`);
    $('#cardNotPurchasedTotalPaidVolume').text(`R$ ${data.statsNotPurchased.totalVendasConvertidas.toFixed(2)}`);

    $('#cardPurchasedLeads').text(data.statsPurchased.totalUsers);
    $('#cardPurchasedPaymentsConfirmed').text(data.statsPurchased.totalPurchases);
    $('#cardPurchasedConversionRateDetailed').text(`${data.statsPurchased.conversionRate.toFixed(2)}%`);
    $('#cardPurchasedTotalVolume').text(`R$ ${data.statsPurchased.totalVendasGeradas.toFixed(2)}`);
    $('#cardPurchasedTotalPaidVolume').text(`R$ ${data.statsPurchased.totalVendasConvertidas.toFixed(2)}`);

    // *** NOVO BLOCO: Preencher a aba "Stats Detalhadas" ***
    // Caso a aba exista (ex: container com id "statsDetailedSection")
    if ($('#statsDetailedSection').length) {
        $('#statsDetailedSection').html(`
            <div class="row">
                <div class="col-md-3">
                    <div class="card mb-3">
                        <div class="card-body">
                            <h5 class="card-title">Todos</h5>
                            <p>Total Leads: ${data.statsAll.totalUsers}</p>
                            <p>Total Compras: ${data.statsAll.totalPurchases}</p>
                            <p>Conversão: ${data.statsAll.conversionRate.toFixed(2)}%</p>
                            <p>Volume Gerado: R$ ${data.statsAll.totalVendasGeradas.toFixed(2)}</p>
                            <p>Volume Pago: R$ ${data.statsAll.totalVendasConvertidas.toFixed(2)}</p>
                        </div>
                    </div>
                </div>
                <div class="col-md-3">
                    <div class="card mb-3">
                        <div class="card-body">
                            <h5 class="card-title">Main</h5>
                            <p>Total Leads: ${data.statsMain.totalUsers}</p>
                            <p>Total Compras: ${data.statsMain.totalPurchases}</p>
                            <p>Conversão: ${data.statsMain.conversionRate.toFixed(2)}%</p>
                            <p>Volume Gerado: R$ ${data.statsMain.totalVendasGeradas.toFixed(2)}</p>
                            <p>Volume Pago: R$ ${data.statsMain.totalVendasConvertidas.toFixed(2)}</p>
                        </div>
                    </div>
                </div>
                <div class="col-md-3">
                    <div class="card mb-3">
                        <div class="card-body">
                            <h5 class="card-title">Not Purchased</h5>
                            <p>Total Leads: ${data.statsNotPurchased.totalUsers}</p>
                            <p>Total Compras: ${data.statsNotPurchased.totalPurchases}</p>
                            <p>Conversão: ${data.statsNotPurchased.conversionRate.toFixed(2)}%</p>
                            <p>Volume Gerado: R$ ${data.statsNotPurchased.totalVendasGeradas.toFixed(2)}</p>
                            <p>Volume Pago: R$ ${data.statsNotPurchased.totalVendasConvertidas.toFixed(2)}</p>
                        </div>
                    </div>
                </div>
                <div class="col-md-3">
                    <div class="card mb-3">
                        <div class="card-body">
                            <h5 class="card-title">Purchased</h5>
                            <p>Total Leads: ${data.statsPurchased.totalUsers}</p>
                            <p>Total Compras: ${data.statsPurchased.totalPurchases}</p>
                            <p>Conversão: ${data.statsPurchased.conversionRate.toFixed(2)}%</p>
                            <p>Volume Gerado: R$ ${data.statsPurchased.totalVendasGeradas.toFixed(2)}</p>
                            <p>Volume Pago: R$ ${data.statsPurchased.totalVendasConvertidas.toFixed(2)}</p>
                        </div>
                    </div>
                </div>
            </div>
        `);
    }

    // Movimentações
    totalMovementsCount = data.totalMovements || 0;
    renderPagination(totalMovementsCount, currentPage, currentPerPage);
    const movementsTbody = $('#lastMovementsBody');
    movementsTbody.empty();
    if (data.lastMovements && data.lastMovements.length > 0) {
        data.lastMovements.forEach(mov => {
            const leadId = mov.User ? mov.User.telegramId : 'N/A';
            let dtGen = mov.pixGeneratedAt ? new Date(mov.pixGeneratedAt).toLocaleString('pt-BR') : '';
            let dtPaid = mov.purchasedAt ? new Date(mov.purchasedAt).toLocaleString('pt-BR') : '—';
            let statusHtml = '';
            if (mov.status === 'paid') {
                statusHtml = `<span style="color:green;font-weight:bold;">Paid</span>`;
            } else if (mov.status === 'pending') {
                statusHtml = `<span style="color:#ff9900;font-weight:bold;">Pending</span>`;
            } else {
                statusHtml = `<span style="font-weight:bold;">${mov.status}</span>`;
            }
            let payDelayHtml = '—';
            if (mov.status === 'paid' && mov.purchasedAt && mov.pixGeneratedAt) {
                const diffMs = new Date(mov.purchasedAt) - new Date(mov.pixGeneratedAt);
                if (diffMs >= 0) {
                    payDelayHtml = formatDuration(diffMs);
                }
            }
            movementsTbody.append(`
                <tr>
                    <td>${leadId}</td>
                    <td>R$ ${mov.planValue.toFixed(2)}</td>
                    <td>${dtGen}</td>
                    <td>${dtPaid}</td>
                    <td>${statusHtml}</td>
                    <td>${payDelayHtml}</td>
                </tr>
            `);
        });
    } else {
        movementsTbody.append(`
            <tr>
                <td colspan="6">Nenhuma movimentação encontrada</td>
            </tr>
        `);
    }
}

//------------------------------------------------------
// Funções Auxiliares
//------------------------------------------------------
function formatDuration(ms) {
    if (ms <= 0) return '0s';
    const totalSec = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSec / 60);
    const seconds = totalSec % 60;
    return `${minutes}m ${seconds}s`;
}

function applyChartOptions(chartInstance) {
    const isDark = $('body').hasClass('dark-mode');
    const cfg = {
        backgroundColor: isDark ? '#1e1e1e' : '#fff',
        axisColor: isDark ? '#fff' : '#000',
        gridColor: isDark ? '#555' : '#ccc'
    };
    chartInstance.options.plugins.chartBackground = { color: cfg.backgroundColor };
    if (chartInstance.options.scales) {
        Object.values(chartInstance.options.scales).forEach(scale => {
            if (scale.ticks) scale.ticks.color = cfg.axisColor;
            if (scale.grid) scale.grid.color = cfg.gridColor;
        });
    }
}

function renderPagination(total, page, perPage) {
    totalPages = Math.ceil(total / perPage);
    const paginationContainer = $('#paginationContainer');
    paginationContainer.empty();
    if (totalPages <= 1) return;
    const group = $('<div class="btn-group btn-group-sm" role="group"></div>');
    const doubleLeft = $('<button class="btn btn-light">&laquo;&laquo;</button>');
    if (page > 10) {
        doubleLeft.on('click', () => { currentPage = Math.max(1, page - 10); refreshDashboard(); });
    } else {
        doubleLeft.prop('disabled', true);
    }
    group.append(doubleLeft);
    const singleLeft = $('<button class="btn btn-light">&laquo;</button>');
    if (page > 1) {
        singleLeft.on('click', () => { currentPage = page - 1; refreshDashboard(); });
    } else {
        singleLeft.prop('disabled', true);
    }
    group.append(singleLeft);
    let startPage = page - 1, endPage = page + 1;
    if (startPage < 1) { startPage = 1; endPage = 3; }
    if (endPage > totalPages) { endPage = totalPages; startPage = endPage - 2; if (startPage < 1) startPage = 1; }
    for (let p = startPage; p <= endPage; p++) {
        const btn = $(`<button class="btn btn-light">${p}</button>`);
        if (p === page) { btn.addClass('btn-primary'); }
        else { btn.on('click', () => { currentPage = p; refreshDashboard(); }); }
        group.append(btn);
    }
    const singleRight = $('<button class="btn btn-light">&raquo;</button>');
    if (page < totalPages) {
        singleRight.on('click', () => { currentPage = page + 1; refreshDashboard(); });
    } else { singleRight.prop('disabled', true); }
    group.append(singleRight);
    const doubleRight = $('<button class="btn btn-light">&raquo;&raquo;</button>');
    if (page + 10 <= totalPages) {
        doubleRight.on('click', () => { currentPage = Math.min(totalPages, page + 10); refreshDashboard(); });
    } else { doubleRight.prop('disabled', true); }
    group.append(doubleRight);
    paginationContainer.append(group);
}

function loadBotList() {
    fetch('/api/bots-list')
        .then(res => res.json())
        .then(botNames => { renderBotCheckboxDropdown(botNames); })
        .catch(err => console.error('Erro ao carregar bots-list:', err));
}

function renderBotCheckboxDropdown(botNames) {
    const container = $('#botFilterContainer');
    container.empty();
    const toggleBtn = $(`
        <button type="button" class="btn btn-sm btn-outline-secondary dropdown-toggle" data-toggle="dropdown">
            Bots
        </button>
    `);
    const checkList = $('<div class="dropdown-menu" style="max-height:250px; overflow:auto;"></div>');
    const allId = 'bot_all';
    const allItem = $(`
        <div class="form-check pl-2">
            <input class="form-check-input" type="checkbox" id="${allId}" value="All">
            <label class="form-check-label" for="${allId}">All</label>
        </div>
    `);
    allItem.find('input').on('change', function () {
        if ($(this).prop('checked')) {
            checkList.find('input[type="checkbox"]').not(`#${allId}`).prop('checked', false);
            selectedBots = ['All'];
        } else {
            selectedBots = [];
        }
        currentPage = 1;
        refreshDashboard();
    });
    checkList.append(allItem);
    botNames.forEach(bot => {
        const safeId = 'bot_' + bot.replace('@', '_').replace(/\W/g, '_');
        const item = $(`
            <div class="form-check pl-2">
                <input class="form-check-input" type="checkbox" id="${safeId}" value="${bot}">
                <label class="form-check-label" for="${safeId}">${bot}</label>
            </div>
        `);
        item.find('input').on('change', function () {
            if ($(this).prop('checked')) {
                checkList.find(`#${allId}`).prop('checked', false);
                selectedBots = selectedBots.filter(b => b !== 'All');
                selectedBots.push(bot);
            } else {
                selectedBots = selectedBots.filter(b => b !== bot);
            }
            currentPage = 1;
            refreshDashboard();
        });
        checkList.append(item);
    });
    const dropDiv = $('<div class="dropdown-multi"></div>');
    dropDiv.append(toggleBtn).append(checkList);
    toggleBtn.on('click', function (e) { e.stopPropagation(); checkList.toggleClass('show'); });
    $(document).on('click', function (e) {
        if (!dropDiv.is(e.target) && dropDiv.has(e.target).length === 0) {
            checkList.removeClass('show');
        }
    });
    container.append(dropDiv);
}

function getDateRangeParams() {
    const rangeValue = $('#dateRangeSelector').val();
    if (rangeValue === 'custom') {
        const sDate = $('#startDateInput').val();
        const eDate = $('#endDateInput').val();
        return { dateRange: 'custom', startDate: sDate, endDate: eDate };
    }
    return { dateRange: rangeValue };
}

async function updateDashboard(movStatus, page, perPage) {
    try {
        const dr = getDateRangeParams();
        let botFilterParam = '';
        if (selectedBots.length > 0) {
            botFilterParam = selectedBots.join(',');
        }
        let url = `/api/bots-stats?page=${page}&perPage=${perPage}`;
        if (movStatus) url += `&movStatus=${movStatus}`;
        if (botFilterParam) url += `&botFilter=${botFilterParam}`;
        if (dr.dateRange === 'custom') {
            url += `&dateRange=custom&startDate=${dr.startDate}&endDate=${dr.endDate}`;
        } else {
            url += `&dateRange=${dr.dateRange}`;
        }
        const response = await fetch(url);
        if (!response.ok) throw new Error('Erro ao obter dados da API');
        const data = await response.json();
        fillDashboardData(data);
    } catch (err) {
        console.error('Erro no updateDashboard:', err);
    }
}

function refreshDashboard() {
    const movStatus = $('#movStatusFilter').val() || '';
    updateDashboard(movStatus, currentPage, currentPerPage);
}

//------------------------------------------------------------
// Inicialização
//------------------------------------------------------------
loadBotList();
refreshDashboard();
const defaultSection = $('#sidebarNav .nav-link.active').data('section');
if (defaultSection === 'statsSection' || defaultSection === 'statsDetailedSection') {
    $('#botFilterContainer').show();
} else {
    $('#botFilterContainer').hide();
}
$('#movStatusFilter').on('change', function () { currentPage = 1; refreshDashboard(); });
$('#movPerPage').on('change', function () {
    currentPerPage = parseInt($(this).val(), 10);
    currentPage = 1;
    refreshDashboard();
});
$('#dateRangeSelector').on('change', function () {
    if ($(this).val() === 'custom') { $('#customDateModal').modal('show'); }
    else { currentPage = 1; refreshDashboard(); }
});
$('#applyCustomDateBtn').on('click', function () {
    $('#customDateModal').modal('hide');
    currentPage = 1;
    refreshDashboard();
});
$('#sidebarNav .nav-link').on('click', function (e) {
    e.preventDefault();
    $('#sidebarNav .nav-link').removeClass('active clicked');
    $(this).addClass('active clicked');
    $('#statsSection, #rankingSimplesSection, #rankingDetalhadoSection, #statsDetailedSection, #manageBotsSection').addClass('d-none');
    const targetSection = $(this).data('section');
    $(`#${targetSection}`).removeClass('d-none');
    if (targetSection === 'statsSection' || targetSection === 'statsDetailedSection' ||
        targetSection === 'rankingSimplesSection' || targetSection === 'rankingDetalhadoSection') {
        $('#botFilterContainer').show();
    } else {
        $('#botFilterContainer').hide();
        if (targetSection === 'manageBotsSection') {
            loadExistingBots();
        }
    }
    currentPage = 1;
    refreshDashboard();
});
$('#toggleSidebarBtn').on('click', function () {
    $('#sidebar').toggleClass('collapsed');
    $('main[role="main"]').toggleClass('expanded');
});

//------------------------------------------------------------
// Rotas de Gerenciar Bots (Criação, Listagem, Edição)
//------------------------------------------------------------
$('#addBotForm').on('submit', function (e) {
    e.preventDefault();
    const formData = new FormData();
    formData.append('name', $('#botNameInput').val().trim());
    formData.append('token', $('#botTokenInput').val().trim());
    formData.append('description', $('#botDescriptionInput').val().trim());
    formData.append('buttonName1', $('#buttonName1').val().trim());
    formData.append('buttonValue1', $('#buttonValue1').val().trim());
    formData.append('buttonName2', $('#buttonName2').val().trim());
    formData.append('buttonValue2', $('#buttonValue2').val().trim());
    formData.append('buttonName3', $('#buttonName3').val().trim());
    formData.append('buttonValue3', $('#buttonValue3').val().trim());
    formData.append('remarketingJson', $('#remarketingInput').val().trim());
    const videoFile = $('#botVideoFile')[0].files[0];
    if (videoFile) { formData.append('videoFile', videoFile); }
    fetch('/admin/bots', { method: 'POST', body: formData })
        .then(async (res) => {
            if (!res.ok) {
                const textErr = await res.text();
                throw new Error(textErr);
            }
            return res.text();
        })
        .then(htmlResponse => {
            $('#addBotResponse').html(htmlResponse);
            loadBotList();
            loadExistingBots();
            $('#addBotForm')[0].reset();
        })
        .catch(err => {
            $('#addBotResponse').html(`<div class="alert alert-danger">${err.message}</div>`);
        });
});
function loadExistingBots() {
    $('#existingBotsBody').html(`<tr><td colspan="4">Carregando...</td></tr>`);
    fetch('/admin/bots/list')
        .then(res => res.json())
        .then(list => {
            const tbody = $('#existingBotsBody');
            tbody.empty();
            if (!list || list.length === 0) {
                tbody.html(`<tr><td colspan="4">Nenhum bot cadastrado</td></tr>`);
                return;
            }
            list.forEach(bot => {
                let videoLabel = bot.video ? bot.video : '—';
                tbody.append(`
                    <tr>
                        <td>${bot.id}</td>
                        <td>${bot.name}</td>
                        <td>${videoLabel}</td>
                        <td>
                            <button class="btn btn-sm btn-info" data-edit-bot="${bot.id}">Editar</button>
                        </td>
                    </tr>
                `);
            });
        })
        .catch(err => {
            console.error('Erro ao carregar bots:', err);
            $('#existingBotsBody').html(`<tr><td colspan="4">Erro ao carregar bots.</td></tr>`);
        });
}
$(document).on('click', '[data-edit-bot]', function () {
    const botId = $(this).attr('data-edit-bot');
    editBot(botId);
});
function editBot(botId) {
    $('#editBotForm')[0].reset();
    $('#editBotResponse').empty();
    $('#editBotId').val(botId);
    fetch(`/admin/bots/${botId}`)
        .then(res => { if (!res.ok) throw new Error('Bot não encontrado'); return res.json(); })
        .then(bot => {
            $('#editBotName').val(bot.name);
            $('#editBotToken').val(bot.token);
            $('#editBotDescription').val(bot.description || '');
            let bjson = [];
            try { bjson = JSON.parse(bot.buttonsJson || '[]'); } catch (e) { }
            if (bjson[0]) {
                $('#editButtonName1').val(bjson[0].name);
                $('#editButtonValue1').val(bjson[0].value);
            } else { $('#editButtonName1').val(''); $('#editButtonValue1').val(''); }
            if (bjson[1]) {
                $('#editButtonName2').val(bjson[1].name);
                $('#editButtonValue2').val(bjson[1].value);
            } else { $('#editButtonName2').val(''); $('#editButtonValue2').val(''); }
            if (bjson[2]) {
                $('#editButtonName3').val(bjson[2].name);
                $('#editButtonValue3').val(bjson[2].value);
            } else { $('#editButtonName3').val(''); $('#editButtonValue3').val(''); }
            $('#editRemarketingJson').val(bot.remarketingJson || '');
            $('#editBotContainer').show();
        })
        .catch(err => { $('#editBotResponse').html(`<div class="alert alert-danger">${err.message}</div>`); });
}
$('#cancelEditBotBtn').on('click', function () {
    $('#editBotContainer').hide();
});
$('#editBotForm').on('submit', function (e) {
    e.preventDefault();
    const botId = $('#editBotId').val();
    if (!botId) { $('#editBotResponse').html(`<div class="alert alert-danger">ID não encontrado</div>`); return; }
    const formData = new FormData();
    formData.append('name', $('#editBotName').val().trim());
    formData.append('token', $('#editBotToken').val().trim());
    formData.append('description', $('#editBotDescription').val().trim());
    formData.append('buttonName1', $('#editButtonName1').val().trim());
    formData.append('buttonValue1', $('#editButtonValue1').val().trim());
    formData.append('buttonName2', $('#editButtonName2').val().trim());
    formData.append('buttonValue2', $('#editButtonValue2').val().trim());
    formData.append('buttonName3', $('#editButtonName3').val().trim());
    formData.append('buttonValue3', $('#editButtonValue3').val().trim());
    formData.append('remarketingJson', $('#editRemarketingJson').val().trim());
    const videoFile = $('#editVideoFile')[0].files[0];
    if (videoFile) { formData.append('videoFile', videoFile); }
    fetch(`/admin/bots/edit/${botId}`, { method: 'POST', body: formData })
        .then(async (res) => { if (!res.ok) { const textErr = await res.text(); throw new Error(textErr); } return res.text(); })
        .then(htmlResp => {
            $('#editBotResponse').html(htmlResp);
            loadExistingBots();
            loadBotList();
        })
        .catch(err => { $('#editBotResponse').html(`<div class="alert alert-danger">${err.message}</div>`); });
});

//------------------------------------------------------
// Sobe servidor
//------------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    logger.info(`🌐 Servidor web iniciado na porta ${PORT}`);
});