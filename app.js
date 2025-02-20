//------------------------------------------------------
// app.js
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

// Utilizaremos upload.fields para tratar múltiplos arquivos: vídeo principal e vídeos dos remarketing
const upload = multer({
    storage: multerS3({
        s3: new S3Client({
            region: process.env.BUCKETEER_AWS_REGION,
            credentials: {
                accessKeyId: process.env.BUCKETEER_AWS_ACCESS_KEY_ID,
                secretAccessKey: process.env.BUCKETEER_AWS_SECRET_ACCESS_KEY,
            }
        }),
        bucket: process.env.BUCKETEER_BUCKET_NAME,
        key: function (req, file, cb) {
            const uniqueSuffix = Date.now() + '-' + file.originalname.replace(/\s/g, '_');
            cb(null, uniqueSuffix);
        }
    })
});

app.use(session({
    secret: 'chave-super-secreta',
    resave: false,
    saveUninitialized: false
}));

function checkAuth(req, res, next) {
    if (req.session.loggedIn) next();
    else res.redirect('/login');
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
function makeDay(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}

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

//------------------------------------------------------
// Rotas de Gerenciar Bots
//------------------------------------------------------

// Criação de novo bot com remarketing
app.post('/admin/bots', checkAuth, upload.fields([
    { name: 'videoFile', maxCount: 1 },
    { name: 'remarketing_not_purchased_video', maxCount: 1 },
    { name: 'remarketing_purchased_video', maxCount: 1 }
]), async (req, res) => {
    try {
        const payload = req.body;
        const {
            name,
            token,
            description,
            buttonName1,
            buttonValue1,
            buttonVipLink1,
            buttonName2,
            buttonValue2,
            buttonVipLink2,
            buttonName3,
            buttonValue3,
            buttonVipLink3
        } = payload;

        const buttons = [];
        function pushButtonIfValid(bName, bValue, bVipLink) {
            if (bName && bName.trim() !== '' &&
                bValue && !isNaN(parseFloat(bValue)) &&
                bVipLink && bVipLink.trim() !== '') {
                buttons.push({ name: bName.trim(), value: parseFloat(bValue), vipLink: bVipLink.trim() });
            }
        }
        pushButtonIfValid(buttonName1, buttonValue1, buttonVipLink1);
        pushButtonIfValid(buttonName2, buttonValue2, buttonVipLink2);
        pushButtonIfValid(buttonName3, buttonValue3, buttonVipLink3);
        if (buttons.length === 0) {
            return res.status(400).send('Erro: é obrigatório definir pelo menos um botão com Link VIP.');
        }
        const buttonsJson = JSON.stringify(buttons);

        let videoFilename = '';
        if (req.files && req.files.videoFile && req.files.videoFile[0]) {
            videoFilename = req.files.videoFile[0].location;
        }

        // Constrói remarketing para not_purchased
        const remarketingNotPurchased = {
            description: req.body.remarketing_not_purchased_description || "",
            delay: req.body.remarketing_not_purchased_delay ? parseInt(req.body.remarketing_not_purchased_delay) : 5,
            video: (req.files && req.files.remarketing_not_purchased_video && req.files.remarketing_not_purchased_video[0]) ? req.files.remarketing_not_purchased_video[0].location : "",
            buttons: []
        };
        for (let i = 1; i <= 3; i++) {
            const rName = req.body[`remarketing_not_purchased_buttonName${i}`];
            const rValue = req.body[`remarketing_not_purchased_buttonValue${i}`];
            const rLink = req.body[`remarketing_not_purchased_buttonLink${i}`];
            if (rName && rValue && !isNaN(parseFloat(rValue)) && rLink) {
                remarketingNotPurchased.buttons.push({ name: rName.trim(), value: parseFloat(rValue), link: rLink.trim() });
            }
        }
        if (remarketingNotPurchased.buttons.length === 0) {
            return res.status(400).send('Erro: é obrigatório definir pelo menos um botão no remarketing (not purchased).');
        }

        // Constrói remarketing para purchased (upsell)
        const remarketingPurchased = {
            description: req.body.remarketing_purchased_description || "",
            delay: req.body.remarketing_purchased_delay ? parseInt(req.body.remarketing_purchased_delay) : 30,
            video: (req.files && req.files.remarketing_purchased_video && req.files.remarketing_purchased_video[0]) ? req.files.remarketing_purchased_video[0].location : "",
            buttons: []
        };
        for (let i = 1; i <= 3; i++) {
            const rName = req.body[`remarketing_purchased_buttonName${i}`];
            const rValue = req.body[`remarketing_purchased_buttonValue${i}`];
            const rLink = req.body[`remarketing_purchased_buttonLink${i}`];
            if (rName && rValue && !isNaN(parseFloat(rValue)) && rLink) {
                remarketingPurchased.buttons.push({ name: rName.trim(), value: parseFloat(rValue), link: rLink.trim() });
            }
        }
        if (remarketingPurchased.buttons.length === 0) {
            return res.status(400).send('Erro: é obrigatório definir pelo menos um botão no remarketing (purchased).');
        }

        const remarketing = {
            not_purchased: remarketingNotPurchased,
            purchased: remarketingPurchased
        };

        const remarketingJson = JSON.stringify(remarketing);

        const newBot = await BotModel.create({
            name,
            token,
            description,
            video: videoFilename,
            buttonsJson,
            remarketingJson
        });
        logger.info(`✅ Bot ${name} inserido no BD.`);

        const bc = {
            name: newBot.name,
            token: newBot.token,
            description: newBot.description,
            video: newBot.video,
            buttons: buttons,
            remarketing: remarketing
        };

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

// Rota de edição de bot
app.post('/admin/bots/edit/:id', checkAuth, upload.fields([
    { name: 'videoFile', maxCount: 1 },
    { name: 'remarketing_not_purchased_video', maxCount: 1 },
    { name: 'remarketing_purchased_video', maxCount: 1 }
]), async (req, res) => {
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
            editButtonVipLink1,
            buttonName2,
            buttonValue2,
            editButtonVipLink2,
            buttonName3,
            buttonValue3,
            editButtonVipLink3
        } = req.body;

        const buttons = [];
        function pushButtonIfValid(bName, bValue, bVipLink) {
            if (bName && bName.trim() !== '' &&
                bValue && !isNaN(parseFloat(bValue)) &&
                bVipLink && bVipLink.trim() !== '') {
                buttons.push({ name: bName.trim(), value: parseFloat(bValue), vipLink: bVipLink.trim() });
            }
        }
        pushButtonIfValid(buttonName1, buttonValue1, editButtonVipLink1);
        pushButtonIfValid(buttonName2, buttonValue2, editButtonVipLink2);
        pushButtonIfValid(buttonName3, buttonValue3, editButtonVipLink3);
        if (buttons.length === 0) {
            return res.status(400).send('Erro: é obrigatório definir pelo menos um botão com Link VIP.');
        }
        const buttonsJson = JSON.stringify(buttons);

        let videoFilename = bot.video;
        if (req.files && req.files.videoFile && req.files.videoFile[0]) {
            videoFilename = req.files.videoFile[0].location;
        }

        // Constrói remarketing para not_purchased
        const remarketingNotPurchased = {
            description: req.body.remarketing_not_purchased_description || "",
            delay: req.body.remarketing_not_purchased_delay ? parseInt(req.body.remarketing_not_purchased_delay) : 5,
            video: (req.files && req.files.remarketing_not_purchased_video && req.files.remarketing_not_purchased_video[0]) ? req.files.remarketing_not_purchased_video[0].location : "",
            buttons: []
        };
        for (let i = 1; i <= 3; i++) {
            const rName = req.body[`remarketing_not_purchased_buttonName${i}`];
            const rValue = req.body[`remarketing_not_purchased_buttonValue${i}`];
            const rLink = req.body[`remarketing_not_purchased_buttonLink${i}`];
            if (rName && rValue && !isNaN(parseFloat(rValue)) && rLink) {
                remarketingNotPurchased.buttons.push({ name: rName.trim(), value: parseFloat(rValue), link: rLink.trim() });
            }
        }
        if (remarketingNotPurchased.buttons.length === 0) {
            return res.status(400).send('Erro: é obrigatório definir pelo menos um botão no remarketing (not purchased).');
        }

        // Constrói remarketing para purchased
        const remarketingPurchased = {
            description: req.body.remarketing_purchased_description || "",
            delay: req.body.remarketing_purchased_delay ? parseInt(req.body.remarketing_purchased_delay) : 30,
            video: (req.files && req.files.remarketing_purchased_video && req.files.remarketing_purchased_video[0]) ? req.files.remarketing_purchased_video[0].location : "",
            buttons: []
        };
        for (let i = 1; i <= 3; i++) {
            const rName = req.body[`remarketing_purchased_buttonName${i}`];
            const rValue = req.body[`remarketing_purchased_buttonValue${i}`];
            const rLink = req.body[`remarketing_purchased_buttonLink${i}`];
            if (rName && rValue && !isNaN(parseFloat(rValue)) && rLink) {
                remarketingPurchased.buttons.push({ name: rName.trim(), value: parseFloat(rValue), link: rLink.trim() });
            }
        }
        if (remarketingPurchased.buttons.length === 0) {
            return res.status(400).send('Erro: é obrigatório definir pelo menos um botão no remarketing (purchased).');
        }

        const remarketing = {
            not_purchased: remarketingNotPurchased,
            purchased: remarketingPurchased
        };

        const safeRemarketingJson = JSON.stringify(remarketing);

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
            remarketing: remarketing
        };

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
// Sobe servidor
//------------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    logger.info(`🌐 Servidor web iniciado na porta ${PORT}`);
});