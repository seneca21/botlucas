// public/js/dashboard.js
$(document).ready(function () {
    const today = new Date().toISOString().split('T')[0];
    $('#datePicker').val(today);

    let salesChart;
    let lineComparisonChart;

    // -----------------------------------------------------------
    // Variáveis de estado para paginação e filtro
    // -----------------------------------------------------------
    let currentPage = 1;            // Página atual (inicialmente 1)
    let currentPerPage = 10;        // Quantas mov. exibir por página
    let totalMovementsCount = 0;    // Recebemos do back-end
    let totalPages = 1;             // Calculado

    // Armazenamos os bots selecionados (array de strings)
    let selectedBots = []; // Ex: ["All"] ou ["@Bot1", "@Bot2"]

    //------------------------------------------------------------
    // 1) PLUGIN para pintar o background do gráfico
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
    // 2) DARK MODE
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
        const isDark = $('body').hasClass('dark-mode');
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
    // Função para formatar uma duração em ms -> "Xm Ys"
    //------------------------------------------------------------
    function formatDuration(ms) {
        if (ms <= 0) return '0s';
        const totalSec = Math.floor(ms / 1000);
        const minutes = Math.floor(totalSec / 60);
        const seconds = totalSec % 60;
        return `${minutes}m ${seconds}s`;
    }

    //------------------------------------------------------------
    // Função para renderizar a paginação (janela de 3 botões + setas)
    //------------------------------------------------------------
    function renderPagination(total, page, perPage) {
        totalPages = Math.ceil(total / perPage);
        const paginationContainer = $('#paginationContainer');
        paginationContainer.empty();

        if (totalPages <= 1) return;

        const group = $('<div class="btn-group btn-group-sm" role="group"></div>');

        // Botão: Voltar 10 (<<)
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

        // Botão: Voltar 1 (<)
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

        // Janela de 3 páginas
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

        // Botão: Avançar 1 (>)
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

        // Botão: Avançar 10 (>>)
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
    // Carrega lista de bots e monta o dropdown com checkboxes
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
                Selecionar Bots
            </button>
        `);

        const checkList = $('<div class="dropdown-menu" style="max-height:250px; overflow:auto;"></div>');

        // Checkbox "All"
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
    // Função principal para atualizar o dashboard
    //------------------------------------------------------------
    async function updateDashboard(date, movStatus, page, perPage) {
        try {
            let botFilterParam = '';
            if (selectedBots.length > 0) {
                botFilterParam = selectedBots.join(',');
            }
            let url = `/api/bots-stats?date=${date}`;
            if (movStatus) url += `&movStatus=${movStatus}`;
            if (botFilterParam) url += `&botFilter=${botFilterParam}`;
            url += `&page=${page}&perPage=${perPage}`;

            const response = await fetch(url);
            if (!response.ok) {
                throw new Error('Erro ao obter dados da API');
            }
            const data = await response.json();

            // Estatísticas do Dia
            $('#totalUsers').text(data.statsAll.totalUsers);
            $('#totalPurchases').text(data.statsAll.totalPurchases);
            $('#conversionRate').text(data.statsAll.conversionRate.toFixed(2) + '%');
            const avgPayDelayMs = data.statsAll.averagePaymentDelayMs || 0;
            $('#avgPaymentTimeText').text(formatDuration(avgPayDelayMs));

            //--------------------------------------------------
            // GRÁFICO DE BARRAS
            //--------------------------------------------------
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
                            y: { beginAtZero: true },
                        },
                        plugins: {
                            chartBackground: {},
                        },
                    },
                });
            } else {
                salesChart.data = barData;
            }
            applyChartOptions(salesChart);
            salesChart.update();

            //--------------------------------------------------
            // GRÁFICO DE LINHA (7 dias) com dois eixos (dual axis) e offset para centralizar
            //--------------------------------------------------
            const lineLabels = data.stats7Days.map(item => {
                const parts = item.date.split('-');
                return `${parts[2]}/${parts[0]}`;
            });
            const convertedValues = data.stats7Days.map(item => item.totalVendasConvertidas);
            const generatedValues = data.stats7Days.map(item => item.totalVendasGeradas);

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
                    }
                ],
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
                            x: {}
                        },
                        plugins: {
                            chartBackground: {},
                            tooltip: {
                                callbacks: {
                                    label: function (ctx) {
                                        const value = ctx.parsed.y || 0;
                                        return `R$ ${value.toFixed(2)}`;
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

            //--------------------------------------------------
            // RANKING SIMPLES
            //--------------------------------------------------
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
            }

            //--------------------------------------------------
            // RANKING DETALHADO
            //--------------------------------------------------
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
            }

            //--------------------------------------------------
            // ESTATÍSTICAS DETALHADAS
            //--------------------------------------------------
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

            //--------------------------------------------------
            // ÚLTIMAS MOVIMENTAÇÕES
            //--------------------------------------------------
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
    // Função para "forçar" o refresh
    //------------------------------------------------------------
    function refreshDashboard() {
        const date = $('#datePicker').val();
        const movStatus = $('#movStatusFilter').val() || '';
        updateDashboard(date, movStatus, currentPage, currentPerPage);
    }

    // Removemos o antigo <select id="botFilter"> (se existir) e criamos o container
    $('#botFilter').remove();
    $('#movStatusFilter').parent().before(`<div id="botFilterContainer" style="position:relative;"></div>`);

    // Carrega a lista de bots
    loadBotList();

    // Atualiza o dashboard inicialmente
    refreshDashboard();

    // ===== EVENTOS =====
    $('#datePicker').on('change', function () {
        currentPage = 1;
        refreshDashboard();
    });

    $('#movStatusFilter').on('change', function () {
        currentPage = 1;
        refreshDashboard();
    });

    $('#movPerPage').on('change', function () {
        currentPerPage = parseInt($(this).val(), 10);
        currentPage = 1;
        refreshDashboard();
    });

    // Sidebar toggle
    $('#sidebarNav .nav-link').on('click', function (e) {
        e.preventDefault();
        $('#sidebarNav .nav-link').removeClass('active clicked');
        $(this).addClass('active clicked');

        $('#statsSection').addClass('d-none');
        $('#rankingSimplesSection').addClass('d-none');
        $('#rankingDetalhadoSection').addClass('d-none');
        $('#statsDetailedSection').addClass('d-none');

        const targetSection = $(this).data('section');
        $(`#${targetSection}`).removeClass('d-none');
    });

    $('#toggleSidebarBtn').on('click', function () {
        $('#sidebar').toggleClass('collapsed');
        $('main[role="main"]').toggleClass('expanded');
    });
});
