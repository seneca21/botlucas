// public/js/dashboard.js
$(document).ready(function () {
    const today = new Date().toISOString().split('T')[0];
    $('#datePicker').val(today);

    let salesChart;
    let lineComparisonChart;
    // Variáveis para paginação dos últimos movimentos
    let currentMovPage = 1;
    let currentMovPageSize = 10;
    let currentMovStatus = ""; // "" para todos; "pending" ou "paid" para filtrar

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
        if (themeBtn.length) themeBtn.text('☀');
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
            gridColor: isDark ? '#555' : '#ccc'
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
    // 3) FUNÇÃO PRINCIPAL: Puxa /api/bots-stats e desenha os gráficos
    //------------------------------------------------------------
    async function updateDashboard(date) {
        try {
            const response = await fetch(`/api/bots-stats?date=${date}`);
            if (!response.ok) {
                throw new Error('Erro ao obter dados da API');
            }
            const data = await response.json();

            // Atualiza estatísticas gerais
            $('#totalUsers').text(data.statsAll.totalUsers);
            $('#totalPurchases').text(data.statsAll.totalPurchases);
            $('#conversionRate').text(data.statsAll.conversionRate.toFixed(2) + '%');

            //--------------------------------------------------
            // GRÁFICO DE BARRAS
            //--------------------------------------------------
            const barData = {
                labels: ['Usuários', 'Compras'],
                datasets: [
                    {
                        label: 'Quantidade',
                        data: [data.statsAll.totalUsers, data.statsAll.totalPurchases],
                        backgroundColor: ['#36A2EB', '#4BC0C0']
                    }
                ]
            };
            const barCtx = document.getElementById('salesChart').getContext('2d');
            if (!salesChart) {
                salesChart = new Chart(barCtx, {
                    type: 'bar',
                    data: barData,
                    options: {
                        responsive: true,
                        scales: { y: { beginAtZero: true }, x: {} },
                        plugins: { chartBackground: {} }
                    }
                });
            } else {
                salesChart.data = barData;
            }
            applyChartOptions(salesChart);
            salesChart.update();

            //--------------------------------------------------
            // GRÁFICO DE LINHA (Últimos 7 dias – Valor Convertido)
            //--------------------------------------------------
            let lineData;
            if (data.stats7Days && data.stats7Days.length > 0) {
                // Extrai os labels e os valores do total de vendas convertidas
                const labels = data.stats7Days.map(item => item.date);
                const totalVendasConvertidas = data.stats7Days.map(item => item.totalVendasConvertidas);
                lineData = {
                    labels: labels,
                    datasets: [
                        {
                            label: 'Valor Convertido (R$) - Últimos 7 dias',
                            data: totalVendasConvertidas,
                            fill: false,
                            borderColor: '#ff5c5c',
                            pointBackgroundColor: '#ff5c5c',
                            pointHoverRadius: 7,
                            tension: 0.2
                        }
                    ]
                };
            } else {
                lineData = {
                    labels: ['Ontem', 'Hoje'],
                    datasets: [
                        {
                            label: 'Valor Convertido (R$)',
                            data: [data.statsYesterday.totalVendasConvertidas, data.statsAll.totalVendasConvertidas],
                            fill: false,
                            borderColor: '#ff5c5c',
                            pointBackgroundColor: '#ff5c5c',
                            pointHoverRadius: 7,
                            tension: 0.2
                        }
                    ]
                };
            }
            const lineCtx = document.getElementById('lineComparisonChart').getContext('2d');
            if (!lineComparisonChart) {
                lineComparisonChart = new Chart(lineCtx, {
                    type: 'line',
                    data: lineData,
                    options: {
                        responsive: true,
                        scales: { y: { beginAtZero: false }, x: {} },
                        plugins: {
                            chartBackground: {},
                            tooltip: {
                                callbacks: {
                                    label: function (context) {
                                        const value = context.parsed.y || 0;
                                        return `R$ ${value.toFixed(2)}`;
                                    }
                                }
                            }
                        }
                    }
                });
            } else {
                lineComparisonChart.data = lineData;
            }
            applyChartOptions(lineComparisonChart);
            lineComparisonChart.update();

            //--------------------------------------------------
            // Atualiza Ranking e Dashboard Detalhado
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

            // Atualiza os cards de estatísticas
            $('#cardAllLeads').text(data.statsAll.totalUsers);
            $('#cardAllPaymentsConfirmed').text(data.statsAll.totalPurchases);
            $('#cardAllConversionRateDetailed').text(data.statsAll.conversionRate.toFixed(2) + '%');
            $('#cardAllTotalVolume').text('R$ ' + data.statsAll.totalVendasGeradas.toFixed(2));
            $('#cardAllTotalPaidVolume').text('R$ ' + data.statsAll.totalVendasConvertidas.toFixed(2));
            $('#cardMainLeads').text(data.statsMain.totalUsers);
            $('#cardMainPaymentsConfirmed').text(data.statsMain.totalPurchases);
            $('#cardMainConversionRateDetailed').text(data.statsMain.conversionRate.toFixed(2) + '%');
            $('#cardMainTotalVolume').text('R$ ' + data.statsMain.totalVendasGeradas.toFixed(2));
            $('#cardMainTotalPaidVolume').text('R$ ' + data.statsMain.totalVendasConvertidas.toFixed(2));
            $('#cardNotPurchasedLeads').text(data.statsNotPurchased.totalUsers);
            $('#cardNotPurchasedPaymentsConfirmed').text(data.statsNotPurchased.totalPurchases);
            $('#cardNotPurchasedConversionRateDetailed').text(data.statsNotPurchased.conversionRate.toFixed(2) + '%');
            $('#cardNotPurchasedTotalVolume').text('R$ ' + data.statsNotPurchased.totalVendasGeradas.toFixed(2));
            $('#cardNotPurchasedTotalPaidVolume').text('R$ ' + data.statsNotPurchased.totalVendasConvertidas.toFixed(2));
            $('#cardPurchasedLeads').text(data.statsPurchased.totalUsers);
            $('#cardPurchasedPaymentsConfirmed').text(data.statsPurchased.totalPurchases);
            $('#cardPurchasedConversionRateDetailed').text(data.statsPurchased.conversionRate.toFixed(2) + '%');
            $('#cardPurchasedTotalVolume').text('R$ ' + data.statsPurchased.totalVendasGeradas.toFixed(2));
            $('#cardPurchasedTotalPaidVolume').text('R$ ' + data.statsPurchased.totalVendasConvertidas.toFixed(2));
        } catch (err) {
            console.error('Erro no updateDashboard:', err);
        }
    }

    //------------------------------------------------------------
    // NOVA FUNÇÃO: Atualiza a Tabela de Últimas Movimentações com Paginação
    //------------------------------------------------------------
    async function updateLastMovements() {
        try {
            const params = new URLSearchParams();
            params.append('page', currentMovPage);
            params.append('pageSize', currentMovPageSize);
            if (currentMovStatus) {
                params.append('status', currentMovStatus);
            }
            const response = await fetch(`/api/last-movements?${params.toString()}`);
            if (!response.ok) {
                throw new Error('Erro ao obter movimentações');
            }
            const data = await response.json();
            const items = data.items;
            const total = data.total;
            const tbody = $('#lastMovementsBody');
            tbody.empty();
            items.forEach(item => {
                tbody.append(`
                    <tr>
                        <td>${item.telegramId || ''}</td>
                        <td>${item.valor}</td>
                        <td>${item.geradoEm}</td>
                        <td>${item.pagoEm}</td>
                        <td>${item.status}</td>
                        <td>${item.tempoParaPagar}</td>
                    </tr>
                `);
            });
            renderPagination(total, currentMovPage, currentMovPageSize);
        } catch (err) {
            console.error('Erro ao atualizar movimentações:', err);
        }
    }

    function renderPagination(totalItems, currentPage, pageSize) {
        const totalPages = Math.ceil(totalItems / pageSize);
        const paginationContainer = $('#lastMovementsPagination');
        paginationContainer.empty();
        if (totalPages <= 1) return;
        const prevClass = currentPage === 1 ? 'disabled' : '';
        paginationContainer.append(`<li class="page-item ${prevClass}"><a class="page-link" href="#" data-page="${currentPage - 1}">Anterior</a></li>`);
        for (let i = 1; i <= totalPages; i++) {
            const activeClass = currentPage === i ? 'active' : '';
            paginationContainer.append(`<li class="page-item ${activeClass}"><a class="page-link" href="#" data-page="${i}">${i}</a></li>`);
        }
        const nextClass = currentPage === totalPages ? 'disabled' : '';
        paginationContainer.append(`<li class="page-item ${nextClass}"><a class="page-link" href="#" data-page="${currentPage + 1}">Próximo</a></li>`);
    }

    // Event listeners para paginação e filtros
    $(document).on('click', '#lastMovementsPagination a.page-link', function (e) {
        e.preventDefault();
        const page = parseInt($(this).data('page'));
        if (!isNaN(page) && page >= 1) {
            currentMovPage = page;
            updateLastMovements();
        }
    });

    $('#movPageSize').on('change', function () {
        currentMovPageSize = parseInt($(this).val());
        currentMovPage = 1;
        updateLastMovements();
    });

    $('#movStatusFilter').on('change', function () {
        currentMovStatus = $(this).val();
        currentMovPage = 1;
        updateLastMovements();
    });

    // Atualizações iniciais
    updateDashboard($('#datePicker').val());
    updateLastMovements();

    $('#datePicker').on('change', function () {
        updateDashboard($(this).val());
        updateLastMovements();
    });

    $('#sidebarNav .nav-link').on('click', function (e) {
        e.preventDefault();
        $('#sidebarNav .nav-link').removeClass('active clicked');
        $(this).addClass('active clicked');
        $('#statsSection, #rankingSimplesSection, #rankingDetalhadoSection, #statsDetailedSection').addClass('d-none');
        const targetSection = $(this).data('section');
        $(`#${targetSection}`).removeClass('d-none');
    });

    $('#toggleSidebarBtn').on('click', function () {
        $('#sidebar').toggleClass('collapsed');
        $('main[role="main"]').toggleClass('expanded');
    });
});
