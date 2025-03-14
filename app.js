//------------------------------------------------------
// app.js
//------------------------------------------------------
const express = require("express");
const path = require("path");
const bodyParser = require("body-parser");
const session = require("express-session");
const { Op, Sequelize } = require("sequelize");

// Para upload de arquivos via S3 (Bucketeer)
const { S3Client } = require("@aws-sdk/client-s3");
const multerS3 = require("multer-s3-v3");
const multer = require("multer");
const fs = require("fs");

const db = require("./services/index"); // Index do Sequelize
const User = db.User;
const Purchase = db.Purchase;
const BotModel = db.BotModel; // Modelo BotModel
const PaymentSetting = db.PaymentSetting; // Modelo para token

const logger = require("./services/logger");
const ConfigService = require("./services/config.service");
const config = ConfigService.loadConfig(); // carrega config.json

// Funções para inicializar/editar bots
const { initializeBot, reloadBotsFromDB, updateBotInMemory } = require("./services/bot.service");

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Configuração do multer para tratar os campos esperados
const upload = multer({
    storage: multerS3({
        s3: new S3Client({
            region: process.env.BUCKETEER_AWS_REGION,
            credentials: {
                accessKeyId: process.env.BUCKETEER_AWS_ACCESS_KEY_ID,
                secretAccessKey: process.env.BUCKETEER_AWS_SECRET_ACCESS_KEY,
            },
        }),
        bucket: process.env.BUCKETEER_BUCKET_NAME,
        key: function (req, file, cb) {
            const uniqueSuffix = Date.now() + "-" + file.originalname.replace(/\s/g, "_");
            cb(null, uniqueSuffix);
        },
    }),
});

// Espera exatamente os campos: videoFile, remarketing_not_purchased_video, remarketing_purchased_video
app.use(
    session({
        secret: "chave-super-secreta",
        resave: false,
        saveUninitialized: false,
    })
);

function checkAuth(req, res, next) {
    if (req.session.loggedIn) next();
    else res.redirect("/login");
}

//------------------------------------------------------
// Conexão com o Banco de Dados
//------------------------------------------------------
db.sequelize
    .authenticate()
    .then(() => logger.info("✅ Conexão com DB estabelecida."))
    .catch((err) => logger.error("❌ Erro ao conectar DB:", err));

db.sequelize
    .sync({ alter: true })
    .then(async () => {
        logger.info("✅ Modelos sincronizados (alter).");
        await reloadBotsFromDB();
    })
    .catch((err) => logger.error("❌ Erro ao sincronizar modelos:", err));

//------------------------------------------------------
// Rotas de LOGIN/LOGOUT
//------------------------------------------------------
app.get("/login", (req, res) => {
    const html = `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8">
      <title>Login</title>
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@4.6.2/dist/css/bootstrap.min.css">
      <style>
        body { background-color: #f8f9fa; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
        .login-container { background-color: #fff; padding: 2rem; border-radius: 8px; box-shadow: 0 0 10px rgba(0,0,0,0.1); width: 300px; }
        .login-container h1 { font-size: 1.5rem; margin-bottom: 1.5rem; text-align: center; }
        .btn-login { border-radius: 50px; }
        .input-group-text { cursor: pointer; }
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

app.post("/login", (req, res) => {
    const { username, password } = req.body;
    const ADMIN_USER = "perufe";
    const ADMIN_PASS = "oppushin1234";

    if (username === ADMIN_USER && password === ADMIN_PASS) {
        req.session.loggedIn = true;
        logger.info(`✅ Usuário ${username} logou com sucesso.`);
        return res.redirect("/");
    } else {
        logger.warn(`❌ Tentativa de login inválida com usuário: ${username}`);
        return res.send('Credenciais inválidas. <a href="/login">Tentar novamente</a>');
    }
});

app.get("/logout", (req, res) => {
    const username = req.session.loggedIn ? "Admin" : "Desconhecido";
    req.session.destroy(() => {
        logger.info(`✅ Usuário ${username} deslogou.`);
        res.send('Você saiu! <a href="/login">Fazer login novamente</a>');
    });
});

//------------------------------------------------------
// Rota principal -> index.html
//------------------------------------------------------
app.get("/", checkAuth, (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Serve a pasta public
app.use(checkAuth, express.static(path.join(__dirname, "public")));

//------------------------------------------------------
// Rotas PaymentSetting
//------------------------------------------------------
app.get("/admin/payment-setting", checkAuth, async (req, res) => {
    try {
        let setting = await PaymentSetting.findOne();
        if (!setting) {
            setting = { pushinToken: "" };
        }
        res.json({ pushinToken: setting.pushinToken || "" });
    } catch (err) {
        logger.error("Erro ao obter PaymentSetting:", err);
        res.status(500).json({ error: "Erro ao obter token" });
    }
});

app.post("/admin/payment-setting", checkAuth, async (req, res) => {
    try {
        const { pushinToken } = req.body;
        if (!pushinToken || pushinToken.trim() === "") {
            return res.status(400).json({ error: "Token não pode estar vazio" });
        }
        let setting = await PaymentSetting.findOne();
        if (!setting) {
            setting = await PaymentSetting.create({ pushinToken });
        } else {
            setting.pushinToken = pushinToken;
            await setting.save();
        }
        logger.info("Token da PushinPay atualizado:", pushinToken);
        res.json({ success: true });
    } catch (err) {
        logger.error("Erro ao salvar PaymentSetting:", err);
        res.status(500).json({ error: "Erro ao salvar token" });
    }
});

//------------------------------------------------------
// Rotas de ESTATÍSTICAS & BOT LIST
//------------------------------------------------------
app.get("/api/bots-list", checkAuth, async (req, res) => {
    try {
        const botRows = await BotModel.findAll();
        const botNames = botRows.map((b) => b.name);
        res.json(botNames);
    } catch (err) {
        logger.error("Erro ao retornar lista de bots:", err);
        res.status(500).json({ error: "Erro ao retornar lista de bots" });
    }
});

//=====================================================================
// Funções auxiliares para estatísticas
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
        if (originCondition === "main") {
            const baseWhere = { pixGeneratedAt: { [Op.between]: [startDate, endDate] } };
            if (botFilters.length > 0 && !botFilters.includes("All")) {
                baseWhere.botName = { [Op.in]: botFilters };
            }
            const mainWhere = { ...baseWhere, originCondition: "main" };
            const purchaseWhere = { ...mainWhere, purchasedAt: { [Op.between]: [startDate, endDate] } };
            totalUsers = await Purchase.count({
                where: mainWhere,
                distinct: true,
                col: "userId",
            });
            totalPurchases = await Purchase.count({ where: purchaseWhere });
            sumGerado = (await Purchase.sum("planValue", { where: mainWhere })) || 0;
            sumConvertido =
                (await Purchase.sum("planValue", {
                    where: { ...mainWhere, purchasedAt: { [Op.between]: [startDate, endDate] }, status: "paid" },
                })) || 0;
            conversionRate = sumGerado > 0 ? (sumConvertido / sumGerado) * 100 : 0;

            const paidPurchases = await Purchase.findAll({
                where: { ...mainWhere, status: "paid", purchasedAt: { [Op.between]: [startDate, endDate] } },
                attributes: ["pixGeneratedAt", "purchasedAt"],
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
            if (botFilters.length > 0 && !botFilters.includes("All")) {
                baseWhere.botName = { [Op.in]: botFilters };
            }
            const purchaseWhere = { ...baseWhere, purchasedAt: { [Op.between]: [startDate, endDate] } };
            let userWhere = { lastInteraction: { [Op.between]: [startDate, endDate] } };
            if (botFilters.length > 0 && !botFilters.includes("All")) {
                purchaseWhere.botName = { [Op.in]: botFilters };
                userWhere.botName = { [Op.in]: botFilters };
            }
            totalUsers = await User.count({ where: userWhere });
            totalPurchases = await Purchase.count({ where: purchaseWhere });
            sumGerado = (await Purchase.sum("planValue", { where: baseWhere })) || 0;
            sumConvertido =
                (await Purchase.sum("planValue", {
                    where: { ...baseWhere, purchasedAt: { [Op.between]: [startDate, endDate] }, status: "paid" },
                })) || 0;
            conversionRate = sumGerado > 0 ? (sumConvertido / sumGerado) * 100 : 0;

            const paidPurchases = await Purchase.findAll({
                where: { ...baseWhere, status: "paid", purchasedAt: { [Op.between]: [startDate, endDate] } },
                attributes: ["pixGeneratedAt", "purchasedAt"],
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
            if (botFilters.length > 0 && !botFilters.includes("All")) {
                baseWhere.botName = { [Op.in]: botFilters };
            }
            const totalLeads = await Purchase.count({
                where: { ...baseWhere, originCondition },
                distinct: true,
                col: "userId",
            });
            const totalConfirmed = await Purchase.count({
                where: { ...baseWhere, originCondition, status: "paid" },
                distinct: true,
                col: "userId",
            });
            sumGerado = (await Purchase.sum("planValue", { where: { ...baseWhere, originCondition } })) || 0;
            sumConvertido =
                (await Purchase.sum("planValue", { where: { ...baseWhere, originCondition, status: "paid" } })) || 0;
            conversionRate = sumGerado > 0 ? (sumConvertido / sumGerado) * 100 : 0;
            const paidPurchases = await Purchase.findAll({
                where: { ...baseWhere, originCondition, status: "paid" },
                attributes: ["pixGeneratedAt", "purchasedAt"],
            });
            let sumDiffMs = 0,
                countPaid = 0;
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
        averagePaymentDelayMs,
    };
}

app.get("/api/bots-stats", checkAuth, async (req, res) => {
    try {
        const { dateRange, startDate: customStart, endDate: customEnd, movStatus } = req.query;
        let { date } = req.query;
        let botFilters = [];
        if (req.query.botFilter) {
            botFilters = req.query.botFilter.split(",");
        }
        const page = parseInt(req.query.page) || 1;
        const perPage = parseInt(req.query.perPage) || 10;
        const offset = (page - 1) * perPage;

        let startDate, endDate;
        if (dateRange) {
            switch (dateRange) {
                case "today": {
                    const todayStart = makeDay(new Date());
                    startDate = todayStart;
                    endDate = new Date(todayStart);
                    endDate.setHours(23, 59, 59, 999);
                    break;
                }
                case "yesterday": {
                    const todayStart = makeDay(new Date());
                    const yesterdayStart = new Date(todayStart);
                    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
                    startDate = yesterdayStart;
                    endDate = new Date(yesterdayStart);
                    endDate.setHours(23, 59, 59, 999);
                    break;
                }
                case "last7": {
                    const todayStart = makeDay(new Date());
                    const last7Start = new Date(todayStart);
                    last7Start.setDate(last7Start.getDate() - 6);
                    startDate = last7Start;
                    endDate = new Date(todayStart);
                    endDate.setHours(23, 59, 59, 999);
                    break;
                }
                case "last30": {
                    const todayStart = makeDay(new Date());
                    const last30Start = new Date(todayStart);
                    last30Start.setDate(last30Start.getDate() - 29);
                    startDate = last30Start;
                    endDate = new Date(todayStart);
                    endDate.setHours(23, 59, 59, 999);
                    break;
                }
                case "lastMonth": {
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
                case "custom": {
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
            if (date && date.includes(",")) {
                dateArray = date.split(",").map((d) => d.trim()).filter((d) => d);
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
                    const dateObjs = dateArray.map((d) => new Date(d));
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

        // Atualiza registros pendentes com mais de 15 minutos para "cancelado"
        await Purchase.update(
            { status: "cancelado" },
            { where: { status: "pending", pixGeneratedAt: { [Op.lt]: new Date(Date.now() - 15 * 60 * 1000) } } }
        );

        const lastMovementsWhere = { pixGeneratedAt: { [Op.between]: [startDate, endDate] } };
        if (movStatus === "pending") {
            lastMovementsWhere.status = "pending";
        } else if (movStatus === "paid") {
            lastMovementsWhere.status = "paid";
        }
        if (botFilters.length > 0 && !botFilters.includes("All")) {
            lastMovementsWhere.botName = { [Op.in]: botFilters };
        }
        const { rows: lastMovements, count: totalMovements } = await Purchase.findAndCountAll({
            attributes: ["pixGeneratedAt", "purchasedAt", "planValue", "status"],
            where: lastMovementsWhere,
            order: [["pixGeneratedAt", "DESC"]],
            limit: perPage,
            offset: offset,
            include: [
                {
                    model: User,
                    attributes: ["telegramId"],
                },
            ],
        });
        res.json({
            statsAll: await getDetailedStats(startDate, endDate, null, botFilters),
            statsYesterday: await (async () => {
                const yesterdayStart = makeDay(new Date(new Date(startDate).setDate(startDate.getDate() - 1)));
                const yesterdayEnd = new Date(yesterdayStart);
                yesterdayEnd.setHours(23, 59, 59, 999);
                return await getDetailedStats(yesterdayStart, yesterdayEnd, null, botFilters);
            })(),
            statsMain: await getDetailedStats(startDate, endDate, "main", botFilters),
            statsNotPurchased: await getDetailedStats(startDate, endDate, "not_purchased", botFilters),
            statsPurchased: await getDetailedStats(startDate, endDate, "purchased", botFilters),
            statsDetailed: {},
            botRanking: (
                await Purchase.findAll({
                    attributes: ["botName", [Sequelize.fn("COUNT", Sequelize.col("botName")), "vendas"]],
                    where: { purchasedAt: { [Op.between]: [startDate, endDate] } },
                    group: ["botName"],
                    order: [[Sequelize.literal('"vendas"'), "DESC"]],
                })
            ).map((item) => ({
                botName: item.botName,
                vendas: parseInt(item.getDataValue("vendas"), 10) || 0,
            })),
            botDetails: [],
            stats7Days: await (async () => {
                const stats7Days = [];
                for (let i = 6; i >= 0; i--) {
                    const tempDate = new Date(startDate);
                    tempDate.setDate(tempDate.getDate() - i);
                    const dayStart = makeDay(tempDate);
                    const dayEnd = new Date(dayStart);
                    dayEnd.setHours(23, 59, 59, 999);
                    const dayStat = (await getDetailedStats(dayStart, dayEnd, null, botFilters)) || {};
                    stats7Days.push({
                        date: dayStart.toISOString().split("T")[0],
                        totalVendasConvertidas: dayStat.totalVendasConvertidas || 0,
                        totalVendasGeradas: dayStat.totalVendasGeradas || 0,
                    });
                }
                return stats7Days;
            })(),
            lastMovements,
            totalMovements,
        });
    } catch (error) {
        logger.error("❌ Erro ao obter estatísticas:", error);
        res.status(500).json({ error: "Erro ao obter estatísticas" });
    }
});

//------------------------------------------------------
// Nova rota para listar bots
//------------------------------------------------------
app.get("/admin/bots/list", checkAuth, async (req, res) => {
    try {
        const allBots = await BotModel.findAll();
        res.json(allBots);
    } catch (err) {
        logger.error("Erro ao listar bots:", err);
        res.status(500).json({ error: "Erro ao listar bots" });
    }
});

//------------------------------------------------------
// Rota GET /admin/bots/:id (para editar)
//------------------------------------------------------
app.get("/admin/bots/:id", checkAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const bot = await BotModel.findByPk(id);
        if (!bot) {
            return res.status(404).json({ error: "Bot não encontrado" });
        }
        res.json(bot);
    } catch (err) {
        logger.error("Erro ao obter bot:", err);
        res.status(500).json({ error: "Erro ao obter bot" });
    }
});

//------------------------------------------------------
// Rotas de Gerenciar Bots
//------------------------------------------------------
app.post(
    "/admin/bots",
    checkAuth,
    upload.fields([
        { name: "videoFile", maxCount: 1 },
        { name: "remarketing_not_purchased_video", maxCount: 1 },
        { name: "remarketing_purchased_video", maxCount: 1 },
    ]),
    async (req, res) => {
        try {
            const payload = req.body;
            const { name, token, description, buttonName1, buttonValue1, buttonVipLink1, buttonName2, buttonValue2, buttonVipLink2, buttonName3, buttonValue3, buttonVipLink3 } = payload;
            const buttons = [];
            function pushButtonIfValid(bName, bValue, bVipLink) {
                if (bName && bName.trim() !== "" && bValue && !isNaN(parseFloat(bValue)) && bVipLink && bVipLink.trim() !== "") {
                    buttons.push({ name: bName.trim(), value: parseFloat(bValue), vipLink: bVipLink.trim() });
                }
            }
            pushButtonIfValid(buttonName1, buttonValue1, buttonVipLink1);
            pushButtonIfValid(buttonName2, buttonValue2, buttonVipLink2);
            pushButtonIfValid(buttonName3, buttonValue3, buttonVipLink3);
            if (buttons.length === 0) {
                return res.status(400).send("Erro: é obrigatório definir pelo menos um botão com Link VIP.");
            }
            const buttonsJson = JSON.stringify(buttons);
            let videoFilename = "";
            if (req.files && req.files.videoFile && req.files.videoFile[0]) {
                videoFilename = req.files.videoFile[0].location;
            }
            const npMin = parseInt(req.body.remarketing_not_purchased_delay_minutes) || 0;
            const npSec = parseInt(req.body.remarketing_not_purchased_delay_seconds) || 0;
            const npTotalSeconds = npMin * 60 + npSec;
            const remarketingNotPurchased = {
                description: req.body.remarketing_not_purchased_description || "",
                delay: npTotalSeconds,
                video:
                    req.files && req.files.remarketing_not_purchased_video && req.files.remarketing_not_purchased_video[0]
                        ? req.files.remarketing_not_purchased_video[0].location
                        : "",
                buttons: [],
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
                return res.status(400).send("Erro: é obrigatório definir pelo menos um botão no remarketing (not purchased).");
            }
            const pMin = parseInt(req.body.remarketing_purchased_delay_minutes) || 0;
            const pSec = parseInt(req.body.remarketing_purchased_delay_seconds) || 0;
            const pTotalSeconds = pMin * 60 + pSec;
            const remarketingPurchased = {
                description: req.body.remarketing_purchased_description || "",
                delay: pTotalSeconds,
                video:
                    req.files && req.files.remarketing_purchased_video && req.files.remarketing_purchased_video[0]
                        ? req.files.remarketing_purchased_video[0].location
                        : "",
                buttons: [],
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
                return res.status(400).send("Erro: é obrigatório definir pelo menos um botão no remarketing (purchased).");
            }
            const remarketing = {
                not_purchased: remarketingNotPurchased,
                purchased: remarketingPurchased,
            };
            const remarketingJson = JSON.stringify(remarketing);
            const newBot = await BotModel.create({
                name,
                token,
                description,
                video: videoFilename,
                buttonsJson,
                remarketingJson,
            });
            logger.info(`✅ Bot ${name} inserido no BD.`);
            const bc = {
                name: newBot.name,
                token: newBot.token,
                description: newBot.description,
                video: newBot.video,
                buttons: buttons,
                remarketing: remarketing,
            };
            // Inicializa o bot passando o ID do novo bot
            initializeBot(bc, newBot.id.toString());
            res.send(`
            <div class="alert alert-success">
              Bot <strong>${name}</strong> cadastrado e iniciado com sucesso!
            </div>
        `);
        } catch (err) {
            logger.error("Erro ao criar bot:", err);
            res.status(500).send("Erro ao criar bot: " + err.message);
        }
    }
);

app.post(
    "/admin/bots/edit/:id",
    checkAuth,
    upload.fields([
        { name: "videoFile", maxCount: 1 },
        { name: "remarketing_not_purchased_video", maxCount: 1 },
        { name: "remarketing_purchased_video", maxCount: 1 },
    ]),
    async (req, res) => {
        try {
            const { id } = req.params;
            const bot = await BotModel.findByPk(id);
            if (!bot) {
                return res.status(404).send("Bot não encontrado");
            }
            // Usa os mesmos nomes dos inputs conforme no formulário de edição
            const { name, token, description, buttonName1, buttonValue1, buttonVipLink1, buttonName2, buttonValue2, buttonVipLink2, buttonName3, buttonValue3, buttonVipLink3 } = req.body;
            const buttons = [];
            function pushButtonIfValid(bName, bValue, bVipLink) {
                if (bName && bName.trim() !== "" && bValue && !isNaN(parseFloat(bValue)) && bVipLink && bVipLink.trim() !== "") {
                    buttons.push({ name: bName.trim(), value: parseFloat(bValue), vipLink: bVipLink.trim() });
                }
            }
            pushButtonIfValid(buttonName1, buttonValue1, buttonVipLink1);
            pushButtonIfValid(buttonName2, buttonValue2, buttonVipLink2);
            pushButtonIfValid(buttonName3, buttonValue3, buttonVipLink3);
            if (buttons.length === 0) {
                return res.status(400).send("Erro: é obrigatório definir pelo menos um botão com Link VIP.");
            }
            const buttonsJson = JSON.stringify(buttons);
            let videoFilename = bot.video;
            if (req.files && req.files.videoFile && req.files.videoFile[0]) {
                videoFilename = req.files.videoFile[0].location;
            }
            const npMin = parseInt(req.body.remarketing_not_purchased_delay_minutes) || 0;
            const npSec = parseInt(req.body.remarketing_not_purchased_delay_seconds) || 0;
            const npTotalSeconds = npMin * 60 + npSec;
            const remarketingNotPurchased = {
                description: req.body.remarketing_not_purchased_description || "",
                delay: npTotalSeconds,
                video:
                    req.files && req.files.remarketing_not_purchased_video && req.files.remarketing_not_purchased_video[0]
                        ? req.files.remarketing_not_purchased_video[0].location
                        : "",
                buttons: [],
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
                return res.status(400).send("Erro: é obrigatório definir pelo menos um botão no remarketing (not purchased).");
            }
            const pMin = parseInt(req.body.remarketing_purchased_delay_minutes) || 0;
            const pSec = parseInt(req.body.remarketing_purchased_delay_seconds) || 0;
            const pTotalSeconds = pMin * 60 + pSec;
            const remarketingPurchased = {
                description: req.body.remarketing_purchased_description || "",
                delay: pTotalSeconds,
                video:
                    req.files && req.files.remarketing_purchased_video && req.files.remarketing_purchased_video[0]
                        ? req.files.remarketing_purchased_video[0].location
                        : "",
                buttons: [],
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
                return res.status(400).send("Erro: é obrigatório definir pelo menos um botão no remarketing (purchased).");
            }
            const remarketing = {
                not_purchased: remarketingNotPurchased,
                purchased: remarketingPurchased,
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
                remarketing: remarketing,
            };
            updateBotInMemory(id, bc);
            res.send(`
            <div class="alert alert-success">
              Bot <strong>${bot.name}</strong> atualizado e reiniciado com sucesso!
            </div>
        `);
        } catch (err) {
            logger.error("Erro ao editar bot:", err);
            res.status(500).send("Erro ao editar bot: " + err.message);
        }
    }
);

//------------------------------------------------------
// Sobe servidor
//------------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    logger.info(`🌐 Servidor web iniciado na porta ${PORT}`);
});