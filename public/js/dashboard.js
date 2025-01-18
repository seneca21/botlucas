// public/js/dashboard.js
$(document).ready(function () {
    const today = new Date().toISOString().split('T')[0];
    $('#datePicker').val(today);

    let salesChart;          // Gráfico de barras
    let lineComparisonChart; // Gráfico de linha

    /* ================== TEMA (DARK MODE) ================== */
    const body = $('body');
    const themeBtn = $('#themeToggleBtn');

    // Carrega preferência do localStorage
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') {
        body.addClass('dark-mode');
        themeBtn.text('☀'); // quando estiver escuro, mostra sol
    }

    // Ao clicar no emoji lua/sol
    themeBtn.on('click', function () {
        if (body.hasClass('dark-mode')) {
            // Se está escuro, vamos pro claro
            body.removeClass('dark-mode');
            themeBtn.text('🌙');
            localStorage.setItem('theme', 'light');
        } else {
            // Se está claro, vamos pro escuro
            body.addClass('dark-mode');
            themeBtn.text('☀');
            localStorage.setItem('theme', 'dark');
        }
    });

    /* ================== ATUALIZA DASHBOARD ================== */
    async function updateDashboard(date) {
        try {
            const response = await fetch(`/api/bots-stats?date=${date}`);
            if (!response.ok) {
                throw new Error('Erro ao obter dados da API');
            }
            const data = await response.json();

            //-------------------------------------------
            // Estatísticas do Dia
            //-------------------------------------------
            $('#totalUsers').text(data.statsAll.totalUsers);
            $('#totalPurchases').text(data.statsAll.totalPurchases);
            $('#conversionRate').text(data.statsAll.conversionRate.toFixed(2) + '%');

            // GRÁFICO DE BARRAS
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
            if (salesChart) {
                salesChart.data = barData;
                salesChart.update();
            } else {
                salesChart = new Chart(barCtx, {
                    type: 'bar',
                    data: barData,
                    options: {
                        scales: {
                            y: { beginAtZero: true },
                        },
                    },
                });
            }

            // GRÁFICO DE LINHA (Ontem vs Hoje)
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
            const lineCtx = document
                .getElementById('lineComparisonChart')
                .getContext('2d');
            if (lineComparisonChart) {
                lineComparisonChart.data = lineData;
                lineComparisonChart.update();
            } else {
                lineComparisonChart = new Chart(lineCtx, {
                    type: 'line',
                    data: lineData,
                    options: {
                        responsive: true,
                        scales: {
                            y: {
                                beginAtZero: false,
                            },
                        },
                        plugins: {
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
            }

            //-------------------------------------------
            // Ranking Simples
            //-------------------------------------------
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

            //-------------------------------------------
            // Ranking Detalhado
            //-------------------------------------------
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

            //-------------------------------------------
            // Estatísticas Detalhadas (4 colunas)
            //-------------------------------------------
            // (A) statsAll
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

            // (B) statsMain
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

            // (C) statsNotPurchased
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

            // (D) statsPurchased
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

    // Atualiza ao carregar
    updateDashboard($('#datePicker').val());

    // Atualiza ao mudar data
    $('#datePicker').on('change', function () {
        updateDashboard($(this).val());
    });

    // Troca de seções do sidebar
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

    // Botão hamburguer -> recolhe/expande sidebar
    $('#toggleSidebarBtn').on('click', function () {
        $('#sidebar').toggleClass('collapsed');
    });
});
