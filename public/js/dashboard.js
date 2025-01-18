// public/js/dashboard.js
$(document).ready(function () {
    const today = new Date().toISOString().split('T')[0];
    $('#datePicker').val(today);

    let salesChart;          // Gráfico de barras
    let lineComparisonChart; // Gráfico de linha

    //------------------------------------------------------------
    // 1) PLUGIN para pintar o background do gráfico igual ao card
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

    // Registra globalmente
    Chart.register(chartBackgroundPlugin);

    //------------------------------------------------------------
    // 2) DARK MODE: Checa localStorage + emoji lua/sol
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
            // Indo para claro
            body.removeClass('dark-mode');
            themeBtn.text('🌙');
            localStorage.setItem('theme', 'light');
        } else {
            // Indo para escuro
            body.addClass('dark-mode');
            themeBtn.text('☀');
            localStorage.setItem('theme', 'dark');
        }

        // Se já temos gráficos criados, forçamos update neles pra trocar cor
        updateChartsIfExist();
    });

    // Função para re-aplicar as cores de fundo quando troca dark/light
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

    // Retorna cor de fundo e configs de escalas dependendo do modo
    function getChartConfigs() {
        const isDark = $('body').hasClass('dark-mode');
        return {
            backgroundColor: isDark ? '#1e1e1e' : '#fff',
            axisColor: isDark ? '#fff' : '#000',
            gridColor: isDark ? '#555' : '#ccc',
        };
    }

    // Aplica as opções (plugins e escalas) ao chart existente
    function applyChartOptions(chartInstance) {
        const cfg = getChartConfigs();
        chartInstance.options.plugins.chartBackground = { color: cfg.backgroundColor };
        // Ajusta cores de ticks e grids
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

            // Estatísticas do Dia
            $('#totalUsers').text(data.statsAll.totalUsers);
            $('#totalPurchases').text(data.statsAll.totalPurchases);
            $('#conversionRate').text(data.statsAll.conversionRate.toFixed(2) + '%');

            //--------------------------------------------------
            // GRÁFICO DE BARRAS (Usuários x Compras)
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
                            x: {}
                        },
                        plugins: {
                            chartBackground: {}, // plugin que pintará o fundo
                        },
                    },
                });
            } else {
                salesChart.data = barData;
            }
            // Aplica as cores no salesChart
            applyChartOptions(salesChart);
            salesChart.update();

            //--------------------------------------------------
            // GRÁFICO DE LINHA (Ontem vs Hoje)
            //--------------------------------------------------
            const lineData = {
                labels: ['Ontem', 'Hoje'],
                datasets: [
                    {
                        label: 'Valor Convertido (R$)',
                        data: [
                            data.statsYesterday.totalVendasConvertidas,
                            data.statsAll.totalVendasConvertidas,
                        ],
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
                            x: {}
                        },
                        plugins: {
                            chartBackground: {}, // plugin do fundo
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
            // Aplica as cores no lineComparisonChart
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
                        plansHtml += `${plan.planName}: ${plan.salesCount} vendas (${plan.conversionRate.toFixed(
                            2
                        )}%)<br>`;
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
            // ESTATÍSTICAS DETALHADAS (4 colunas)
            //--------------------------------------------------
            // statsAll
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
        } catch (err) {
            console.error('Erro no updateDashboard:', err);
        }
    }

    // (A) Atualiza ao carregar
    updateDashboard($('#datePicker').val());

    // (B) Atualiza ao mudar data
    $('#datePicker').on('change', function () {
        updateDashboard($(this).val());
    });

    // (C) Troca de seções do sidebar
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

    // (D) Botão hamburguer -> recolhe/expande sidebar
    $('#toggleSidebarBtn').on('click', function () {
        $('#sidebar').toggleClass('collapsed');
    });
});
