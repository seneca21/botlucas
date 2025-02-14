// public/js/dashboard.js
$(document).ready(function () {
    const today = new Date().toISOString().split('T')[0];
    // A princípio, definimos "hoje" como default do datePicker
    // Mas iremos configurar um range-picker com a lib daterangepicker

    let salesChart;
    let lineComparisonChart;

    //------------------------------------------------------------
    // 1) Plugin para pintar o background do gráfico
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
        adjustCardTextColor();
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
    // Ajusta a cor do texto nos cards (stats-display) dependendo do tema
    //------------------------------------------------------------
    function adjustCardTextColor() {
        const isDark = body.hasClass('dark-mode');
        if (isDark) {
            $('.stats-display').css('color', '#fff');
        } else {
            $('.stats-display').css('color', '#000');
        }
    }
    adjustCardTextColor();

    //------------------------------------------------------------
    // FUNÇÃO PRINCIPAL: updateDashboard(dates, movStatus, page, perPage, botFilter)
    //------------------------------------------------------------
    async function updateDashboard(dateParam, movStatus, page, perPage, botFilterArray) {
        try {
            let url = `/api/bots-stats?date=${encodeURIComponent(dateParam)}`;
            if (movStatus) {
                url += `&movStatus=${movStatus}`;
            }
            if (page) {
                url += `&page=${page}`;
            }
            if (perPage) {
                url += `&perPage=${perPage}`;
            }
            if (botFilterArray && botFilterArray.length > 0) {
                const joined = botFilterArray.join(',');
                url += `&botFilter=${encodeURIComponent(joined)}`;
            }

            const response = await fetch(url);
            if (!response.ok) {
                throw new Error('Erro ao obter dados da API');
            }
            const data = await response.json();

            // Preencher estatísticas do Dia (parte superior)
            $('#totalUsers').text(data.statsAll.totalUsers);
            $('#totalPurchases').text(data.statsAll.totalPurchases);
            $('#conversionRate').text(data.statsAll.conversionRate.toFixed(2) + '%');
            const avgPayDelayMs = data.statsAll.averagePaymentDelayMs || 0;
            $('#avgPaymentTimeText').text(formatDuration(avgPayDelayMs));

            // GRÁFICO DE BARRAS: [Usuários, Compras]
            const barData = {
                labels: ['Usuários', 'Compras'],
                datasets: [{
                    label: 'Quantidade',
                    data: [data.statsAll.totalUsers, data.statsAll.totalPurchases],
                    backgroundColor: ['#36A2EB', '#FF0000']
                }],
            };
            // Define o yMax de forma dinâmica
            const yMax = Math.max(data.statsAll.totalUsers, data.statsAll.totalPurchases) * 1.2;
            const barCtx = document.getElementById('salesChart').getContext('2d');
            if (!salesChart) {
                salesChart = new Chart(barCtx, {
                    type: 'bar',
                    data: barData,
                    options: {
                        responsive: true,
                        maintainAspectRatio: false, // Garante que a altura definida via CSS seja mantida
                        scales: {
                            y: {
                                beginAtZero: true,
                                max: yMax
                            },
                            x: {}
                        },
                        plugins: {
                            chartBackground: {},
                        },
                    },
                });
            } else {
                salesChart.data = barData;
                salesChart.options.scales.y.max = yMax;
            }
            applyChartOptions(salesChart);
            salesChart.update();

            // GRÁFICO DE LINHA (7 dias)
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
                        maintainAspectRatio: false,
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

            // Preencher Tabela de Movimentações
            const movementsTbody = $('#lastMovementsBody');
            movementsTbody.empty();
            if (data.lastMovements && data.lastMovements.length > 0) {
                data.lastMovements.forEach(mov => {
                    const leadId = mov.User ? mov.User.telegramId : 'N/A';
                    let dtGen = mov.pixGeneratedAt ? new Date(mov.pixGeneratedAt).toLocaleString('pt-BR') : '';
                    let dtPaid = mov.purchasedAt ? new Date(mov.purchasedAt).toLocaleString('pt-BR') : '—';
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
                movementsTbody.append('<tr><td colspan="6">Nenhuma movimentação encontrada</td></tr>');
            }

            // Paginação
            const totalMovements = data.totalMovements || 0;
            buildPagination(totalMovements, page, perPage);

            // Ranking simples
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

            // Dashboard Detalhado
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

            // Preenche cards de "TODA" / "MAIN" / "NOT_PURCHASED" / "PURCHASED"
            if (data.statsAll) {
                $('#cardAllLeads').text(data.statsAll.totalUsers);
                $('#cardAllPaymentsConfirmed').text(data.statsAll.totalPurchases);
                $('#cardAllConversionRateDetailed').text(data.statsAll.conversionRate.toFixed(2) + '%');
                $('#cardAllTotalVolume').text('R$ ' + data.statsAll.totalVendasGeradas.toFixed(2));
                $('#cardAllTotalPaidVolume').text('R$ ' + data.statsAll.totalVendasConvertidas.toFixed(2));
            }
            if (data.statsMain) {
                $('#cardMainLeads').text(data.statsMain.totalUsers);
                $('#cardMainPaymentsConfirmed').text(data.statsMain.totalPurchases);
                $('#cardMainConversionRateDetailed').text(data.statsMain.conversionRate.toFixed(2) + '%');
                $('#cardMainTotalVolume').text('R$ ' + data.statsMain.totalVendasGeradas.toFixed(2));
                $('#cardMainTotalPaidVolume').text('R$ ' + data.statsMain.totalVendasConvertidas.toFixed(2));
            }
            if (data.statsNotPurchased) {
                $('#cardNotPurchasedLeads').text(data.statsNotPurchased.totalUsers);
                $('#cardNotPurchasedPaymentsConfirmed').text(data.statsNotPurchased.totalPurchases);
                $('#cardNotPurchasedConversionRateDetailed').text(data.statsNotPurchased.conversionRate.toFixed(2) + '%');
                $('#cardNotPurchasedTotalVolume').text('R$ ' + data.statsNotPurchased.totalVendasGeradas.toFixed(2));
                $('#cardNotPurchasedTotalPaidVolume').text('R$ ' + data.statsNotPurchased.totalVendasConvertidas.toFixed(2));
            }
            if (data.statsPurchased) {
                $('#cardPurchasedLeads').text(data.statsPurchased.totalUsers);
                $('#cardPurchasedPaymentsConfirmed').text(data.statsPurchased.totalPurchases);
                $('#cardPurchasedConversionRateDetailed').text(data.statsPurchased.conversionRate.toFixed(2) + '%');
                $('#cardPurchasedTotalVolume').text('R$ ' + data.statsPurchased.totalVendasGeradas.toFixed(2));
                $('#cardPurchasedTotalPaidVolume').text('R$ ' + data.statsPurchased.totalVendasConvertidas.toFixed(2));
            }

        } catch (err) {
            console.error('Erro no updateDashboard:', err);
        }
    }

    //------------------------------------------------------------
    // buildPagination
    //------------------------------------------------------------
    function buildPagination(total, currentPage, perPage) {
        const container = $('#paginationContainer');
        container.empty();
        if (total <= perPage) return;
        const totalPages = Math.ceil(total / perPage);

        let html = `<nav aria-label="Movements pagination"><ul class="pagination pagination-sm">`;
        for (let p = 1; p <= totalPages; p++) {
            html += `<li class="page-item ${p === currentPage ? 'active' : ''}">
                        <a class="page-link mov-page-link" href="#" data-page="${p}">${p}</a>
                     </li>`;
        }
        html += `</ul></nav>`;
        container.html(html);
    }

    // Evento de clique na paginação
    $('#paginationContainer').on('click', '.mov-page-link', function (e) {
        e.preventDefault();
        const newPage = parseInt($(this).data('page'), 10);
        const dateParam = dateParamGlobal;
        const movStatus = $('#movStatusFilter').val() || '';
        const botArr = getSelectedBots();
        updateDashboard(dateParam, movStatus, newPage, parseInt($('#movPerPage').val()), botArr);
    });

    //------------------------------------------------------------
    // formatDuration (ms -> "Xm Ys")
    //------------------------------------------------------------
    function formatDuration(ms) {
        if (ms <= 0) return '0s';
        const totalSec = Math.floor(ms / 1000);
        const minutes = Math.floor(totalSec / 60);
        const seconds = totalSec % 60;
        return `${minutes}m ${seconds}s`;
    }

    //------------------------------------------------------------
    // BOT FILTER
    //------------------------------------------------------------
    let allBots = [];
    function buildBotFilterDropdown() {
        const container = $('#botFilterContainer');
        container.empty();

        const dropdown = $(`
            <div class="dropdown-multi">
                <button class="btn btn-sm dropdown-toggle" type="button" id="botFilterDropdown" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false">
                    Selecionar Bots
                </button>
                <div class="dropdown-menu" aria-labelledby="botFilterDropdown"></div>
            </div>
        `);
        const menu = dropdown.find('.dropdown-menu');

        const allItem = $(`
            <div class="form-check">
                <input class="form-check-input bot-check" type="checkbox" value="All" id="botCheckAll">
                <label class="form-check-label" for="botCheckAll">Todos</label>
            </div>
        `);
        menu.append(allItem);
        allBots.forEach(botName => {
            const idSafe = 'botCheck_' + botName.replace(/[^a-zA-Z0-9]/g, '');
            const item = $(`
                <div class="form-check">
                    <input class="form-check-input bot-check" type="checkbox" value="${botName}" id="${idSafe}">
                    <label class="form-check-label" for="${idSafe}">${botName}</label>
                </div>
            `);
            menu.append(item);
        });
        container.append(dropdown);

        dropdown.find('.dropdown-toggle').on('click', function (e) {
            e.preventDefault();
            menu.toggleClass('show');
        });
        $('#botCheckAll').on('change', function () {
            if ($(this).is(':checked')) {
                $('.bot-check').not(this).prop('checked', false);
            }
        });
        $('.bot-check').not('#botCheckAll').on('change', function () {
            if ($(this).is(':checked')) {
                $('#botCheckAll').prop('checked', false);
            }
        });
    }

    function getSelectedBots() {
        const checked = $('.bot-check:checked');
        return checked.map((i, el) => $(el).val()).get();
    }

    //------------------------------------------------------------
    // Carrega a lista de bots / buildBotFilter
    //------------------------------------------------------------
    async function loadBotsList() {
        try {
            const resp = await fetch('/api/bots-list');
            if (!resp.ok) return;
            allBots = await resp.json();
            buildBotFilterDropdown();
        } catch (err) {
            console.error('Erro ao carregar bots-list:', err);
        }
    }
    loadBotsList();

    //------------------------------------------------------------
    // datePicker com DateRangePicker
    //------------------------------------------------------------
    let dateParamGlobal = today;
    $('#datePicker').daterangepicker({
        singleDatePicker: false,
        showDropdowns: true,
        autoUpdateInput: false,
        locale: {
            format: 'DD/MM/YYYY',
            applyLabel: 'Aplicar',
            cancelLabel: 'Cancelar',
            customRangeLabel: 'Personalizar Datas',
        },
        ranges: {
            'Hoje': [moment(), moment()],
            'Ontem': [moment().subtract(1, 'days'), moment().subtract(1, 'days')],
            'Últimos 7 dias': [moment().subtract(6, 'days'), moment()],
            'Este Mês': [moment().startOf('month'), moment().endOf('month')],
            'Mês Passado': [moment().subtract(1, 'month').startOf('month'), moment().subtract(1, 'month').endOf('month')],
        }
    }, function (start, end, label) {
        if (label === 'Personalizar Datas') {
            const startStr = start.format('DD/MM/YYYY');
            const endStr = end.format('DD/MM/YYYY');
            if (startStr === endStr) {
                const singleDay = start.format('YYYY-MM-DD');
                dateParamGlobal = singleDay;
                $('#datePicker').val(singleDay);
            } else {
                dateParamGlobal = `${startStr} - ${endStr}`;
                $('#datePicker').val(dateParamGlobal);
            }
        } else {
            const sDay = start.format('YYYY-MM-DD');
            const eDay = end.format('YYYY-MM-DD');
            if (sDay === eDay) {
                dateParamGlobal = sDay;
                $('#datePicker').val(dateParamGlobal);
            } else {
                const st = start.format('DD/MM/YYYY');
                const en = end.format('DD/MM/YYYY');
                dateParamGlobal = `${st} - ${en}`;
                $('#datePicker').val(dateParamGlobal);
            }
        }
        const movStatus = $('#movStatusFilter').val() || '';
        const botArr = getSelectedBots();
        updateDashboard(dateParamGlobal, movStatus, 1, parseInt($('#movPerPage').val()), botArr);
    });

    $('#datePicker').on('cancel.daterangepicker', function () {
        $(this).val('');
        dateParamGlobal = today;
        const movStatus = $('#movStatusFilter').val() || '';
        const botArr = getSelectedBots();
        updateDashboard(dateParamGlobal, movStatus, 1, parseInt($('#movPerPage').val()), botArr);
    });

    $('#datePicker').val(moment().format('YYYY-MM-DD'));
    dateParamGlobal = moment().format('YYYY-MM-DD');

    //------------------------------------------------------------
    // movStatus e perPage
    //------------------------------------------------------------
    $('#movStatusFilter').on('change', function () {
        const movStatus = $(this).val() || '';
        const botArr = getSelectedBots();
        updateDashboard(dateParamGlobal, movStatus, 1, parseInt($('#movPerPage').val()), botArr);
    });
    $('#movPerPage').on('change', function () {
        const movStatus = $('#movStatusFilter').val() || '';
        const botArr = getSelectedBots();
        updateDashboard(dateParamGlobal, movStatus, 1, parseInt($('#movPerPage').val()), botArr);
    });

    $(document).on('click', function (e) {
        const dropdown = $('.dropdown-multi');
        if (!dropdown.is(e.target) && dropdown.has(e.target).length === 0) {
            dropdown.find('.dropdown-menu').removeClass('show');
        }
    });
    $(document).on('change', '.bot-check', function () {
        const movStatus = $('#movStatusFilter').val() || '';
        const botArr = getSelectedBots();
        updateDashboard(dateParamGlobal, movStatus, 1, parseInt($('#movPerPage').val()), botArr);
    });

    //------------------------------------------------------------
    // Toggle Seções no sidebar
    //------------------------------------------------------------
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

    //------------------------------------------------------------
    // Botão hamburguer
    //------------------------------------------------------------
    $('#toggleSidebarBtn').on('click', function () {
        $('#sidebar').toggleClass('collapsed');
    });

    //------------------------------------------------------------
    // Carregar inicial
    const initialStatus = $('#movStatusFilter').val() || '';
    const botArr = getSelectedBots();
    updateDashboard(dateParamGlobal, initialStatus, 1, parseInt($('#movPerPage').val()), botArr);
});
