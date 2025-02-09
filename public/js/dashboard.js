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
    let totalPages = 1;            // Calculado

    // Filtro de bot
    let currentBotFilter = 'All';   // Por padrão "All"

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
        if (themeBtn.length) {
            themeBtn.text('☀');
        }
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
    // Nova função: renderiza botões de paginação de forma mais "discreta"
    //------------------------------------------------------------
    function renderPagination(total, page, perPage) {
        totalPages = Math.ceil(total / perPage);
        const paginationContainer = $('#paginationContainer');
        paginationContainer.empty();

        // Se só houver 1 página, não exibe nada
        if (totalPages <= 1) return;

        // Botão: Voltar 10
        if (page > 10) {
            const btnBack10 = $('<button class="btn btn-sm btn-light mr-1">&laquo; Voltar 10</button>');
            btnBack10.on('click', () => {
                currentPage = Math.max(1, page - 10);
                refreshDashboard();
            });
            paginationContainer.append(btnBack10);
        }

        // Botão: Anterior
        if (page > 1) {
            const btnPrev = $('<button class="btn btn-sm btn-light mr-1">Anterior</button>');
            btnPrev.on('click', () => {
                currentPage = page - 1;
                refreshDashboard();
            });
            paginationContainer.append(btnPrev);
        }

        // Info: "Página X de Y"
        const pageInfo = $(
            `<span style="margin-right:1rem; font-weight:bold;">Página ${page} de ${totalPages}</span>`
        );
        paginationContainer.append(pageInfo);

        // Botão: Próxima
        if (page < totalPages) {
            const btnNext = $('<button class="btn btn-sm btn-light ml-1">Próxima</button>');
            btnNext.on('click', () => {
                currentPage = page + 1;
                refreshDashboard();
            });
            paginationContainer.append(btnNext);
        }

        // Botão: Avançar 10
        if (page + 10 <= totalPages) {
            const btnNext10 = $('<button class="btn btn-sm btn-light ml-1">Avançar 10 &raquo;</button>');
            btnNext10.on('click', () => {
                currentPage = Math.min(totalPages, page + 10);
                refreshDashboard();
            });
            paginationContainer.append(btnNext10);
        }
    }

    //------------------------------------------------------------
    // Carregar lista de bots dinamicamente
    //------------------------------------------------------------
    function loadBotList() {
        fetch('/api/bots-list')
            .then(res => res.json())
            .then(botNames => {
                const botSelect = $('#botFilter');
                // Limpa e adiciona "All"
                botSelect.empty();
                botSelect.append(`<option value="All" selected>All</option>`);

                botNames.forEach(name => {
                    botSelect.append(`<option value="${name}">${name}</option>`);
                });
            })
            .catch(err => console.error('Erro ao carregar bots-list:', err));
    }

    //------------------------------------------------------------
    // Função principal para puxar /api/bots-stats e desenhar
    //------------------------------------------------------------
    async function updateDashboard(date, movStatus, page, perPage, botFilter) {
        try {
            let url = `/api/bots-stats?date=${date}`;
            if (movStatus) url += `&movStatus=${movStatus}`;
            if (botFilter) url += `&botFilter=${botFilter}`;
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

            // Tempo médio de pagamento
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
                            x: {}
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
            // GRÁFICO DE LINHA (7 dias)
            //--------------------------------------------------
            const lineLabels = data.stats7Days.map(item => {
                const parts = item.date.split('-');
                const day = parts[2];
                const year = parts[0];
                return day + '/' + year;
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
                        cubicInterpolationMode: 'monotone'
                    },
                    {
                        label: 'Valor Gerado (R$)',
                        data: generatedValues,
                        fill: false,
                        borderColor: '#36A2EB',
                        pointBackgroundColor: '#36A2EB',
                        pointHoverRadius: 6,
                        tension: 0.4,
                        cubicInterpolationMode: 'monotone'
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
                            y: { beginAtZero: false },
                            x: {}
                        },
                        plugins: {
                            chartBackground: {},
                            tooltip: {
                                callbacks: {
                                    label: function (context) {
                                        const value = context.parsed.y || 0;
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
                data.botRanking.forEach((bot) => {
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
                data.botDetails.forEach((bot) => {
                    let plansHtml = '';
                    bot.plans.forEach((plan) => {
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
            $('#cardAllConversionRateDetailed').text(
                data.statsAll.conversionRate.toFixed(2) + '%'
            );
            $('#cardAllTotalVolume').text(
                'R$ ' + data.statsAll.totalVendasGeradas.toFixed(2)
            );
            $('#cardAllTotalPaidVolume').text(
                'R$ ' + data.statsAll.totalVendasConvertidas.toFixed(2)
            );

            // statsMain
            $('#cardMainLeads').text(data.statsMain.totalUsers);
            $('#cardMainPaymentsConfirmed').text(data.statsMain.totalPurchases);
            $('#cardMainConversionRateDetailed').text(
                data.statsMain.conversionRate.toFixed(2) + '%'
            );
            $('#cardMainTotalVolume').text(
                'R$ ' + data.statsMain.totalVendasGeradas.toFixed(2)
            );
            $('#cardMainTotalPaidVolume').text(
                'R$ ' + data.statsMain.totalVendasConvertidas.toFixed(2)
            );

            // statsNotPurchased
            $('#cardNotPurchasedLeads').text(data.statsNotPurchased.totalUsers);
            $('#cardNotPurchasedPaymentsConfirmed').text(
                data.statsNotPurchased.totalPurchases
            );
            $('#cardNotPurchasedConversionRateDetailed').text(
                data.statsNotPurchased.conversionRate.toFixed(2) + '%'
            );
            $('#cardNotPurchasedTotalVolume').text(
                'R$ ' + data.statsNotPurchased.totalVendasGeradas.toFixed(2)
            );
            $('#cardNotPurchasedTotalPaidVolume').text(
                'R$ ' + data.statsNotPurchased.totalVendasConvertidas.toFixed(2)
            );

            // statsPurchased
            $('#cardPurchasedLeads').text(data.statsPurchased.totalUsers);
            $('#cardPurchasedPaymentsConfirmed').text(
                data.statsPurchased.totalPurchases
            );
            $('#cardPurchasedConversionRateDetailed').text(
                data.statsPurchased.conversionRate.toFixed(2) + '%'
            );
            $('#cardPurchasedTotalVolume').text(
                'R$ ' + data.statsPurchased.totalVendasGeradas.toFixed(2)
            );
            $('#cardPurchasedTotalPaidVolume').text(
                'R$ ' + data.statsPurchased.totalVendasConvertidas.toFixed(2)
            );

            //--------------------------------------------------
            // ÚLTIMAS MOVIMENTAÇÕES
            //--------------------------------------------------
            totalMovementsCount = data.totalMovements || 0;
            renderPagination(totalMovementsCount, page, perPage);

            const movementsTbody = $('#lastMovementsBody');
            movementsTbody.empty();
            if (data.lastMovements && data.lastMovements.length > 0) {
                data.lastMovements.forEach((mov) => {
                    const leadId = mov.User ? mov.User.telegramId : 'N/A';

                    let dtGen = mov.pixGeneratedAt
                        ? new Date(mov.pixGeneratedAt).toLocaleString('pt-BR')
                        : '';
                    let dtPaid = mov.purchasedAt
                        ? new Date(mov.purchasedAt).toLocaleString('pt-BR')
                        : '—';

                    let statusHtml = '';
                    if (mov.status === 'paid') {
                        statusHtml = '<span style="font-weight:bold; color:green;">Paid</span>';
                    } else if (mov.status === 'pending') {
                        statusHtml = '<span style="font-weight:bold; color:#ff9900;">Pending</span>';
                    } else {
                        statusHtml = `<span style="font-weight:bold;">${mov.status}</span>`;
                    }

                    let payDelayHtml = '—';
                    if (mov.status === 'paid' && mov.purchasedAt && mov.pixGeneratedAt) {
                        const diffMs = new Date(mov.purchasedAt).getTime() - new Date(mov.pixGeneratedAt).getTime();
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
        updateDashboard(date, movStatus, currentPage, currentPerPage, currentBotFilter);
    }

    //------------------------------------------------------------
    // EVENTOS
    //------------------------------------------------------------

    // 1) Carrega a lista de bots do back-end
    loadBotList();

    // 2) Carregar inicial
    refreshDashboard();

    // Mudar data
    $('#datePicker').on('change', function () {
        currentPage = 1;
        refreshDashboard();
    });

    // Mudar status
    $('#movStatusFilter').on('change', function () {
        currentPage = 1;
        refreshDashboard();
    });

    // Mudar "quantas por página"
    $('#movPerPage').on('change', function () {
        currentPerPage = parseInt($(this).val(), 10);
        currentPage = 1;
        refreshDashboard();
    });

    // Mudar "botFilter"
    $('#botFilter').on('change', function () {
        currentBotFilter = $(this).val();
        currentPage = 1;
        refreshDashboard();
    });

    // Toggle de seções no sidebar
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

    // Botão hamburguer -> recolhe/expande
    $('#toggleSidebarBtn').on('click', function () {
        $('#sidebar').toggleClass('collapsed');
        $('main[role="main"]').toggleClass('expanded');
    });
});
