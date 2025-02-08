// public/js/dashboard.js
$(document).ready(function () {
    // Define a data atual no input date
    const today = new Date().toISOString().split('T')[0];
    $('#datePicker').val(today);

    let salesChart;
    let lineComparisonChart;

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
        // Atualiza os gráficos, se existirem
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

            // Atualiza as estatísticas principais
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
                        backgroundColor: ['#36A2EB', '#4BC0C0'],
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
                            x: {},
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
            // GRÁFICO DE LINHA (Últimos 7 dias - Valor Convertido)
            //--------------------------------------------------
            // Espera que a API retorne em data.last7Days:
            // { labels: [...], vendasConvertidas: [...] }
            const lineData = {
                labels: data.last7Days.labels, // exemplo: ['2025-01-20', '2025-01-21', ..., '2025-01-26']
                datasets: [
                    {
                        label: 'Valor Convertido (R$) nos Últimos 7 dias',
                        data: data.last7Days.vendasConvertidas,
                        fill: false,
                        borderColor: '#ff5c5c',
                        pointBackgroundColor: '#ff5c5c',
                        pointHoverRadius: 7,
                        tension: 0.2,
                    },
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
                            x: {},
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
            // ESTATÍSTICAS DETALHADAS (CARDS)
            //--------------------------------------------------
            // statsAll
            $('#cardAllLeads').text(data.statsAll.totalUsers);
            $('#cardAllPaymentsConfirmed').text(data.statsAll.totalPurchases);
            $('#cardAllConversionRateDetailed').text(data.statsAll.conversionRate.toFixed(2) + '%');
            $('#cardAllTotalVolume').text('R$ ' + data.statsAll.totalVendasGeradas.toFixed(2));
            $('#cardAllTotalPaidVolume').text('R$ ' + data.statsAll.totalVendasConvertidas.toFixed(2));

            // statsMain
            $('#cardMainLeads').text(data.statsMain.totalUsers);
            $('#cardMainPaymentsConfirmed').text(data.statsMain.totalPurchases);
            $('#cardMainConversionRateDetailed').text(data.statsMain.conversionRate.toFixed(2) + '%');
            $('#cardMainTotalVolume').text('R$ ' + data.statsMain.totalVendasGeradas.toFixed(2));
            $('#cardMainTotalPaidVolume').text('R$ ' + data.statsMain.totalVendasConvertidas.toFixed(2));

            // statsNotPurchased
            $('#cardNotPurchasedLeads').text(data.statsNotPurchased.totalUsers);
            $('#cardNotPurchasedPaymentsConfirmed').text(data.statsNotPurchased.totalPurchases);
            $('#cardNotPurchasedConversionRateDetailed').text(data.statsNotPurchased.conversionRate.toFixed(2) + '%');
            $('#cardNotPurchasedTotalVolume').text('R$ ' + data.statsNotPurchased.totalVendasGeradas.toFixed(2));
            $('#cardNotPurchasedTotalPaidVolume').text('R$ ' + data.statsNotPurchased.totalVendasConvertidas.toFixed(2));

            // statsPurchased
            $('#cardPurchasedLeads').text(data.statsPurchased.totalUsers);
            $('#cardPurchasedPaymentsConfirmed').text(data.statsPurchased.totalPurchases);
            $('#cardPurchasedConversionRateDetailed').text(data.statsPurchased.conversionRate.toFixed(2) + '%');
            $('#cardPurchasedTotalVolume').text('R$ ' + data.statsPurchased.totalVendasGeradas.toFixed(2));
            $('#cardPurchasedTotalPaidVolume').text('R$ ' + data.statsPurchased.totalVendasConvertidas.toFixed(2));
        } catch (err) {
            console.error('Erro no updateDashboard:', err);
        }
    }

    // (A) Atualiza ao carregar
    updateDashboard($('#datePicker').val());

    // (B) Atualiza ao mudar a data
    $('#datePicker').on('change', function () {
        updateDashboard($(this).val());
    });

    // (C) Troca de seções no sidebar
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

    // (D) Botão hamburguer -> recolhe/expande sidebar + main
    $('#toggleSidebarBtn').on('click', function () {
        $('#sidebar').toggleClass('collapsed');
        // Ao mesmo tempo, main expande para 100%
        $('main[role="main"]').toggleClass('expanded');
    });
});
