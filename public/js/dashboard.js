$(document).ready(function () {
    const today = new Date().toISOString().split('T')[0];
    $('#datePicker').val(today);

    let salesChart; // gráfico principal

    // Se você quiser gráficos DOUGHNUT para a aba detalhada, declare aqui:
    let chartLeads;
    let chartPagamentos;
    let chartTaxaConversao;
    let chartVendasGeradas;
    let chartVendasConvertidas;

    async function updateDashboard(date) {
        try {
            const response = await fetch(`/api/bots-stats?date=${date}`);
            if (!response.ok) {
                throw new Error('Erro ao obter dados da API');
            }
            const data = await response.json();

            //-------------------------------------------
            // 1) Estatísticas do Dia (Aba statsSection)
            //-------------------------------------------
            $('#totalUsers').text(data.totalUsers);
            $('#totalPurchases').text(data.totalPurchases);
            $('#conversionRate').text(data.conversionRate.toFixed(2) + '%');

            // Gráfico Bar (usuários x compras)
            const chartData = {
                labels: ['Usuários', 'Compras'],
                datasets: [{
                    label: 'Quantidade',
                    data: [data.totalUsers, data.totalPurchases],
                    backgroundColor: ['#36A2EB', '#4BC0C0'],
                }],
            };
            const ctx = document.getElementById('salesChart').getContext('2d');
            if (salesChart) {
                salesChart.data = chartData;
                salesChart.update();
            } else {
                salesChart = new Chart(ctx, {
                    type: 'bar',
                    data: chartData,
                    options: {
                        scales: {
                            y: { beginAtZero: true }
                        }
                    }
                });
            }

            //-------------------------------------------
            // 2) Ranking Simples (Aba rankingSimplesSection)
            //-------------------------------------------
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

            //-------------------------------------------
            // 3) Ranking Detalhado (Aba rankingDetalhadoSection)
            //-------------------------------------------
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

            //-------------------------------------------
            // 4) Estatísticas do Dia (Detalhado) - Cards e Gráficos Doughnut
            //-------------------------------------------
            // Preenche os cards
            $('#cardTotalLeads').text(data.totalLeads || 0);
            $('#cardPaymentsConfirmed').text(data.pagamentosConfirmados || 0);
            $('#cardConversionRateDetailed').text((data.taxaConversao || 0).toFixed(2) + '%');
            $('#cardTotalVolume').text('R$ ' + (data.totalVendasGeradas || 0).toFixed(2));
            $('#cardTotalPaidVolume').text('R$ ' + (data.totalVendasConvertidas || 0).toFixed(2));

            // Se estiver usando doughnut nessa aba, atualize/crie os gráficos:
            // 4.1) chartLeads
            const leadsCtx = document.getElementById('chartLeads');
            if (leadsCtx) {
                const leadsData = [data.totalLeads || 0];
                const leadsConfig = {
                    type: 'doughnut',
                    data: {
                        labels: ['Leads'],
                        datasets: [{ data: leadsData, backgroundColor: ['#FF6384'] }]
                    }
                };
                if (chartLeads) {
                    chartLeads.data.datasets[0].data = leadsData;
                    chartLeads.update();
                } else {
                    chartLeads = new Chart(leadsCtx, leadsConfig);
                }
            }

            // 4.2) chartPagamentos
            const pgCtx = document.getElementById('chartPagamentos');
            if (pgCtx) {
                const pgData = [data.pagamentosConfirmados || 0];
                const pgConfig = {
                    type: 'doughnut',
                    data: {
                        labels: ['Pagamentos'],
                        datasets: [{ data: pgData, backgroundColor: ['#36A2EB'] }]
                    }
                };
                if (chartPagamentos) {
                    chartPagamentos.data.datasets[0].data = pgData;
                    chartPagamentos.update();
                } else {
                    chartPagamentos = new Chart(pgCtx, pgConfig);
                }
            }

            // 4.3) chartTaxaConversao
            const txCtx = document.getElementById('chartTaxaConversao');
            if (txCtx) {
                const txData = [data.taxaConversao || 0];
                const txConfig = {
                    type: 'doughnut',
                    data: {
                        labels: ['Taxa Conversão'],
                        datasets: [{ data: txData, backgroundColor: ['#FFCE56'] }]
                    }
                };
                if (chartTaxaConversao) {
                    chartTaxaConversao.data.datasets[0].data = txData;
                    chartTaxaConversao.update();
                } else {
                    chartTaxaConversao = new Chart(txCtx, txConfig);
                }
            }

            // 4.4) chartVendasGeradas
            const vgCtx = document.getElementById('chartVendasGeradas');
            if (vgCtx) {
                const vgData = [data.totalVendasGeradas || 0];
                const vgConfig = {
                    type: 'doughnut',
                    data: {
                        labels: ['Vendas Geradas (R$)'],
                        datasets: [{ data: vgData, backgroundColor: ['#4BC0C0'] }]
                    }
                };
                if (chartVendasGeradas) {
                    chartVendasGeradas.data.datasets[0].data = vgData;
                    chartVendasGeradas.update();
                } else {
                    chartVendasGeradas = new Chart(vgCtx, vgConfig);
                }
            }

            // 4.5) chartVendasConvertidas
            const vcCtx = document.getElementById('chartVendasConvertidas');
            if (vcCtx) {
                const vcData = [data.totalVendasConvertidas || 0];
                const vcConfig = {
                    type: 'doughnut',
                    data: {
                        labels: ['Vendas Convertidas (R$)'],
                        datasets: [{ data: vcData, backgroundColor: ['#9966FF'] }]
                    }
                };
                if (chartVendasConvertidas) {
                    chartVendasConvertidas.data.datasets[0].data = vcData;
                    chartVendasConvertidas.update();
                } else {
                    chartVendasConvertidas = new Chart(vcCtx, vcConfig);
                }
            }
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

    // (C) Lógica de Sidebar para trocar seções
    $('#sidebarNav .nav-link').on('click', function (e) {
        e.preventDefault();

        // remove 'active' de todos
        $('#sidebarNav .nav-link').removeClass('active');
        $(this).addClass('active');

        // esconde as sections
        $('#statsSection').addClass('d-none');
        $('#rankingSimplesSection').addClass('d-none');
        $('#rankingDetalhadoSection').addClass('d-none');
        $('#statsDetailedSection').addClass('d-none');

        const targetSection = $(this).data('section');
        $(`#${targetSection}`).removeClass('d-none');
    });
});
