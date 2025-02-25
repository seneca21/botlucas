// public/js/dashboard.js
$(document).ready(function () {
    let salesChart;
    let lineComparisonChart;

    let currentPage = 1;
    let currentPerPage = 10;
    let totalMovementsCount = 0;
    let totalPages = 1;

    // Armazenamos os bots selecionados
    let selectedBots = [];

    //------------------------------------------------------------
    // PLUGIN: Background chart
    //------------------------------------------------------------
    const chartBackgroundPlugin = {
        id: 'chartBackground',
        beforeDraw(chart, args, options) {
            const { ctx, chartArea } = chart;
            ctx.save();
            ctx.fillStyle = options.color || '#fff';
            ctx.fillRect(chartArea.left, chartArea.top, chartArea.width, chartArea.height);
            ctx.restore();
        }
    };
    Chart.register(chartBackgroundPlugin);

    //------------------------------------------------------------
    // DARK MODE
    //------------------------------------------------------------
    const body = $('body');
    const themeBtn = $('#themeToggleBtn');

    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') {
        body.addClass('dark-mode');
        themeBtn.text('☀');
    }

    themeBtn.on('click', function () {
        if (body.hasClass('dark-mode')) {
            body.removeClass('dark-mode');
            themeBtn.text('🌙');
            localStorage.setItem('theme', 'light');
        } else {
            body.addClass('dark-mode');
            themeBtn.text('☀');
            localStorage.setItem('theme', 'dark');
        }
        updateChartsIfExist();
    });

    function updateChartsIfExist() {
        if (salesChart) {
            applyChartOptions(salesChart);
            salesChart.update();
        }
        if (lineComparisonChart) {
            applyChartOptions(lineComparisonChart);
            lineComparisonChart.update();
        }
    }

    function getChartConfigs() {
        const isDark = body.hasClass('dark-mode');
        return {
            backgroundColor: isDark ? '#1e1e1e' : '#fff',
            axisColor: isDark ? '#fff' : '#000',
            gridColor: isDark ? '#555' : '#ccc',
        };
    }

    function applyChartOptions(chartInstance) {
        const cfg = getChartConfigs();
        chartInstance.options.plugins.chartBackground = { color: cfg.backgroundColor };
        if (chartInstance.options.scales) {
            Object.values(chartInstance.options.scales).forEach(scale => {
                if (scale.ticks) scale.ticks.color = cfg.axisColor;
                if (scale.grid) scale.grid.color = cfg.gridColor;
            });
        }
    }

    //------------------------------------------------------------
    // formatDuration
    //------------------------------------------------------------
    function formatDuration(ms) {
        if (ms <= 0) return '0s';
        const totalSec = Math.floor(ms / 1000);
        const minutes = Math.floor(totalSec / 60);
        const seconds = totalSec % 60;
        return `${minutes}m ${seconds}s`;
    }

    //------------------------------------------------------------
    // RENDER PAGINATION
    //------------------------------------------------------------
    function renderPagination(total, page, perPage) {
        totalPages = Math.ceil(total / perPage);
        const paginationContainer = $('#paginationContainer');
        paginationContainer.empty();

        if (totalPages <= 1) return;

        const group = $('<div class="btn-group btn-group-sm" role="group"></div>');

        // << (back 10)
        const doubleLeft = $('<button class="btn btn-light">&laquo;&laquo;</button>');
        if (page > 10) {
            doubleLeft.on('click', () => {
                currentPage = Math.max(1, page - 10);
                refreshDashboard();
            });
        } else {
            doubleLeft.prop('disabled', true);
        }
        group.append(doubleLeft);

        // < (back 1)
        const singleLeft = $('<button class="btn btn-light">&laquo;</button>');
        if (page > 1) {
            singleLeft.on('click', () => {
                currentPage = page - 1;
                refreshDashboard();
            });
        } else {
            singleLeft.prop('disabled', true);
        }
        group.append(singleLeft);

        // 3 pages window
        let startPage = page - 1;
        let endPage = page + 1;
        if (startPage < 1) {
            startPage = 1;
            endPage = 3;
        }
        if (endPage > totalPages) {
            endPage = totalPages;
            startPage = endPage - 2;
            if (startPage < 1) startPage = 1;
        }
        for (let p = startPage; p <= endPage; p++) {
            const btn = $(`<button class="btn btn-light">${p}</button>`);
            if (p === page) {
                btn.addClass('btn-primary');
            } else {
                btn.on('click', () => {
                    currentPage = p;
                    refreshDashboard();
                });
            }
            group.append(btn);
        }

        // > (forward 1)
        const singleRight = $('<button class="btn btn-light">&raquo;</button>');
        if (page < totalPages) {
            singleRight.on('click', () => {
                currentPage = page + 1;
                refreshDashboard();
            });
        } else {
            singleRight.prop('disabled', true);
        }
        group.append(singleRight);

        // >> (forward 10)
        const doubleRight = $('<button class="btn btn-light">&raquo;&raquo;</button>');
        if (page + 10 <= totalPages) {
            doubleRight.on('click', () => {
                currentPage = Math.min(totalPages, page + 10);
                refreshDashboard();
            });
        } else {
            doubleRight.prop('disabled', true);
        }
        group.append(doubleRight);

        paginationContainer.append(group);
    }

    //------------------------------------------------------------
    // LOAD BOTS (para o dropdown)
    //------------------------------------------------------------
    function loadBotList() {
        fetch('/api/bots-list')
            .then(res => res.json())
            .then(botNames => {
                renderBotCheckboxDropdown(botNames);
            })
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

        // All
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

        toggleBtn.on('click', function (e) {
            e.stopPropagation();
            checkList.toggleClass('show');
        });
        $(document).on('click', function (e) {
            if (!dropDiv.is(e.target) && dropDiv.has(e.target).length === 0) {
                checkList.removeClass('show');
            }
        });

        container.append(dropDiv);
    }

    //------------------------------------------------------------
    // GET DATE RANGE
    //------------------------------------------------------------
    function getDateRangeParams() {
        const rangeValue = $('#dateRangeSelector').val();
        if (rangeValue === 'custom') {
            const sDate = $('#startDateInput').val();
            const eDate = $('#endDateInput').val();
            return {
                dateRange: 'custom',
                startDate: sDate,
                endDate: eDate
            };
        }
        return { dateRange: rangeValue };
    }

    //------------------------------------------------------------
    // UPDATE DASHBOARD
    //------------------------------------------------------------
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
            if (!response.ok) {
                throw new Error('Erro ao obter dados da API');
            }
            const data = await response.json();

            $('#totalUsers').text(data.statsAll.totalUsers);
            $('#totalPurchases').text(data.statsAll.totalPurchases);
            $('#conversionRate').text(data.statsAll.conversionRate.toFixed(2) + '%');
            const avgPayDelayMs = data.statsAll.averagePaymentDelayMs || 0;
            $('#avgPaymentTimeText').text(formatDuration(avgPayDelayMs));

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
            if (!salesChart) {
                salesChart = new Chart(barCtx, {
                    type: 'bar',
                    data: barData,
                    options: {
                        responsive: true,
                        scales: {
                            y: { beginAtZero: true }
                        },
                        plugins: {
                            chartBackground: {}
                        }
                    }
                });
            } else {
                salesChart.data = barData;
            }
            applyChartOptions(salesChart);
            salesChart.update();

            const lineLabels = data.stats7Days.map(item => {
                const parts = item.date.split('-');
                return `${parts[2]}/${parts[0]}`;
            });
            const convertedValues = data.stats7Days.map(item => item.totalVendasConvertidas);
            const generatedValues = data.stats7Days.map(item => item.totalVendasGeradas);
            const conversionRates = data.stats7Days.map(item => {
                return item.totalVendasGeradas > 0
                    ? (item.totalVendasConvertidas / item.totalVendasGeradas) * 100
                    : 0;
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
            if (!lineComparisonChart) {
                lineComparisonChart = new Chart(lineCtx, {
                    type: 'line',
                    data: lineData,
                    options: {
                        responsive: true,
                        scales: {
                            'y-axis-convertido': {
                                type: 'linear',
                                position: 'left',
                                beginAtZero: true,
                                offset: true
                            },
                            'y-axis-gerado': {
                                type: 'linear',
                                position: 'right',
                                beginAtZero: true,
                                offset: true,
                                grid: {
                                    drawOnChartArea: false
                                }
                            },
                            'y-axis-conversion': {
                                type: 'linear',
                                position: 'right',
                                beginAtZero: true,
                                offset: true,
                                suggestedMax: 100,
                                grid: {
                                    drawOnChartArea: false
                                },
                                ticks: {
                                    callback: function (value) {
                                        return value + '%';
                                    }
                                }
                            },
                            x: {}
                        },
                        plugins: {
                            chartBackground: {},
                            tooltip: {
                                callbacks: {
                                    label: function (ctx) {
                                        const value = ctx.parsed.y || 0;
                                        if (ctx.dataset.label === 'Taxa de Conversão (%)') {
                                            return `Taxa: ${value.toFixed(2)}%`;
                                        } else {
                                            return `R$ ${value.toFixed(2)}`;
                                        }
                                    },
                                },
                            },
                        },
                    },
                });
            } else {
                lineComparisonChart.data = lineData;
            }
            applyChartOptions(lineComparisonChart);
            lineComparisonChart.update();

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

            totalMovementsCount = data.totalMovements || 0;
            renderPagination(totalMovementsCount, page, perPage);

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
        } catch (err) {
            console.error('Erro no updateDashboard:', err);
        }
    }

    //------------------------------------------------------------
    // REFRESH
    //------------------------------------------------------------
    function refreshDashboard() {
        const movStatus = $('#movStatusFilter').val() || '';
        updateDashboard(movStatus, currentPage, currentPerPage);
    }

    //------------------------------------------------------------
    // Inicial
    //------------------------------------------------------------
    loadBotList();
    refreshDashboard();

    const defaultSection = $('#sidebarNav .nav-link.active').data('section');
    if (defaultSection === 'statsSection' || defaultSection === 'statsDetailedSection') {
        $('#botFilterContainer').show();
    } else {
        $('#botFilterContainer').hide();
    }

    //------------------------------------------------------------
    // EVENTOS
    //------------------------------------------------------------
    $('#movStatusFilter').on('change', function () {
        currentPage = 1;
        refreshDashboard();
    });
    $('#movPerPage').on('change', function () {
        currentPerPage = parseInt($(this).val(), 10);
        currentPage = 1;
        refreshDashboard();
    });

    $('#dateRangeSelector').on('change', function () {
        if ($(this).val() === 'custom') {
            $('#customDateModal').modal('show');
        } else {
            currentPage = 1;
            refreshDashboard();
        }
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

        $('#statsSection').addClass('d-none');
        $('#rankingSimplesSection').addClass('d-none');
        $('#rankingDetalhadoSection').addClass('d-none');
        $('#statsDetailedSection').addClass('d-none');
        $('#manageBotsSection').addClass('d-none');

        const targetSection = $(this).data('section');
        $(`#${targetSection}`).removeClass('d-none');

        // 2) Esconder o filtro de data no "Gerenciar Bots"
        if (targetSection === 'manageBotsSection') {
            $('#dateFilterContainer').hide();
            loadExistingBots();
        } else {
            $('#dateFilterContainer').show();
        }

        if (targetSection === 'statsSection' || targetSection === 'statsDetailedSection' ||
            targetSection === 'rankingSimplesSection' || targetSection === 'rankingDetalhadoSection') {
            $('#botFilterContainer').show();
        } else {
            $('#botFilterContainer').hide();
        }

        currentPage = 1;
        refreshDashboard();
    });

    $('#toggleSidebarBtn').on('click', function () {
        $('#sidebar').toggleClass('collapsed');
        $('main[role="main"]').toggleClass('expanded');
    });

    //------------------------------------------------------------
    // [1] Form Criar Novo Bot
    //------------------------------------------------------------
    $('#addBotForm').on('submit', function (e) {
        e.preventDefault();

        const formData = new FormData(this);
        fetch('/admin/bots', {
            method: 'POST',
            body: formData
        })
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

    //------------------------------------------------------------
    // [2] Lista de Bots Existentes
    //------------------------------------------------------------
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

    // Ao clicar em "Editar"
    $(document).on('click', '[data-edit-bot]', function () {
        const botId = $(this).attr('data-edit-bot');
        editBot(botId);
    });

    function editBot(botId) {
        // Limpamos e abrimos a area de edição
        $('#editBotForm')[0].reset();
        $('#editBotResponse').empty();
        $('#editBotId').val(botId);

        fetch(`/admin/bots/${botId}`)
            .then(res => {
                if (!res.ok) throw new Error('Bot não encontrado');
                return res.json();
            })
            .then(bot => {
                // Preenche form
                $('#editBotName').val(bot.name);
                $('#editBotToken').val(bot.token);
                $('#editBotDescription').val(bot.description || '');

                // Exibir nome do vídeo atual
                if (bot.video) {
                    $('#editVideoInfo').text(`Vídeo atual: ${bot.video}`);
                } else {
                    $('#editVideoInfo').text('Sem vídeo anterior');
                }

                // Botões "main"
                let bjson = [];
                try {
                    bjson = JSON.parse(bot.buttonsJson || '[]');
                } catch (e) { /* ignore */ }
                if (bjson[0]) {
                    $('#editButtonName1').val(bjson[0].name);
                    $('#editButtonValue1').val(bjson[0].value);
                    $('#editButtonVipLink1').val(bjson[0].vipLink);
                } else {
                    $('#editButtonName1').val('');
                    $('#editButtonValue1').val('');
                    $('#editButtonVipLink1').val('');
                }
                if (bjson[1]) {
                    $('#editButtonName2').val(bjson[1].name);
                    $('#editButtonValue2').val(bjson[1].value);
                    $('#editButtonVipLink2').val(bjson[1].vipLink);
                } else {
                    $('#editButtonName2').val('');
                    $('#editButtonValue2').val('');
                    $('#editButtonVipLink2').val('');
                }
                if (bjson[2]) {
                    $('#editButtonName3').val(bjson[2].name);
                    $('#editButtonValue3').val(bjson[2].value);
                    $('#editButtonVipLink3').val(bjson[2].vipLink);
                } else {
                    $('#editButtonName3').val('');
                    $('#editButtonValue3').val('');
                    $('#editButtonVipLink3').val('');
                }

                // remarketing
                if (bot.remarketingJson) {
                    try {
                        const remarketing = JSON.parse(bot.remarketingJson);

                        // not_purchased
                        if (remarketing.not_purchased) {
                            $('#remarketing_not_purchased_description').val(remarketing.not_purchased.description || '');
                            const npDelay = remarketing.not_purchased.delay || 0;
                            const npMin = Math.floor(npDelay / 60);
                            const npSec = npDelay % 60;
                            $('#edit_remarketing_not_purchased_delay_minutes').val(npMin);
                            $('#edit_remarketing_not_purchased_delay_seconds').val(npSec);

                            const npButtons = remarketing.not_purchased.buttons || [];
                            if (npButtons[0]) {
                                $('#remarketing_not_purchased_buttonName1').val(npButtons[0].name);
                                $('#remarketing_not_purchased_buttonValue1').val(npButtons[0].value);
                                $('#remarketing_not_purchased_buttonLink1').val(npButtons[0].link);
                            }
                            if (npButtons[1]) {
                                $('#remarketing_not_purchased_buttonName2').val(npButtons[1].name);
                                $('#remarketing_not_purchased_buttonValue2').val(npButtons[1].value);
                                $('#remarketing_not_purchased_buttonLink2').val(npButtons[1].link);
                            }
                            if (npButtons[2]) {
                                $('#remarketing_not_purchased_buttonName3').val(npButtons[2].name);
                                $('#remarketing_not_purchased_buttonValue3').val(npButtons[2].value);
                                $('#remarketing_not_purchased_buttonLink3').val(npButtons[2].link);
                            }
                        }

                        // purchased
                        if (remarketing.purchased) {
                            $('#remarketing_purchased_description').val(remarketing.purchased.description || '');
                            const pDelay = remarketing.purchased.delay || 0;
                            const pMin = Math.floor(pDelay / 60);
                            const pSec = pDelay % 60;
                            $('#edit_remarketing_purchased_delay_minutes').val(pMin);
                            $('#edit_remarketing_purchased_delay_seconds').val(pSec);

                            const pButtons = remarketing.purchased.buttons || [];
                            if (pButtons[0]) {
                                $('#remarketing_purchased_buttonName1').val(pButtons[0].name);
                                $('#remarketing_purchased_buttonValue1').val(pButtons[0].value);
                                $('#remarketing_purchased_buttonLink1').val(pButtons[0].link);
                            }
                            if (pButtons[1]) {
                                $('#remarketing_purchased_buttonName2').val(pButtons[1].name);
                                $('#remarketing_purchased_buttonValue2').val(pButtons[1].value);
                                $('#remarketing_purchased_buttonLink2').val(pButtons[1].link);
                            }
                            if (pButtons[2]) {
                                $('#remarketing_purchased_buttonName3').val(pButtons[2].name);
                                $('#remarketing_purchased_buttonValue3').val(pButtons[2].value);
                                $('#remarketing_purchased_buttonLink3').val(pButtons[2].link);
                            }
                        }
                    } catch (e) {
                        console.error("Erro ao parse remarketingJson", e);
                    }
                }

                // Exibe form de edição
                $('#editBotArea').removeClass('d-none');
            })
            .catch(err => {
                $('#editBotResponse').html(`<div class="alert alert-danger">${err.message}</div>`);
            });
    }

    $('#cancelEditBotBtn').on('click', function () {
        // Oculta form de edição
        $('#editBotArea').addClass('d-none');
    });

    $('#editBotForm').on('submit', function (e) {
        e.preventDefault();
        const botId = $('#editBotId').val();
        if (!botId) {
            $('#editBotResponse').html(`<div class="alert alert-danger">ID não encontrado</div>`);
            return;
        }
        const formData = new FormData(this);
        fetch(`/admin/bots/edit/${botId}`, {
            method: 'POST',
            body: formData
        })
            .then(async (res) => {
                if (!res.ok) {
                    const textErr = await res.text();
                    throw new Error(textErr);
                }
                return res.text();
            })
            .then(htmlResp => {
                $('#editBotResponse').html(htmlResp);
                loadExistingBots();
                loadBotList();
            })
            .catch(err => {
                $('#editBotResponse').html(`<div class="alert alert-danger">${err.message}</div>`);
            });
    });
});