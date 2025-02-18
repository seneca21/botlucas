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
    // PLUGIN: chartBackground
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
    // renderPagination
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

        // 3 páginas
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

        // > (avançar 1)
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

        // >> (avançar 10)
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
    // loadBotList
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
    // getDateRangeParams
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
    // updateDashboard
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

            // Atualiza os dados e gráficos
            fillDashboardData(data);
        } catch (err) {
            console.error('Erro no updateDashboard:', err);
        }
    }

    //------------------------------------------------------------
    // Preenche dados e gráficos
    //------------------------------------------------------------
    function fillDashboardData(data) {
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
                    plugins: { chartBackground: {} }
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
                    tension: 0.4,
                    yAxisID: 'y-axis-convertido'
                },
                {
                    label: 'Valor Gerado (R$)',
                    data: generatedValues,
                    fill: false,
                    borderColor: '#36A2EB',
                    pointBackgroundColor: '#36A2EB',
                    tension: 0.4,
                    yAxisID: 'y-axis-gerado'
                },
                {
                    label: 'Taxa de Conversão (%)',
                    data: conversionRates,
                    fill: false,
                    borderColor: 'green',
                    pointBackgroundColor: 'green',
                    tension: 0.4,
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
                            beginAtZero: true
                        },
                        'y-axis-gerado': {
                            type: 'linear',
                            position: 'right',
                            beginAtZero: true,
                            grid: { drawOnChartArea: false }
                        },
                        'y-axis-conversion': {
                            type: 'linear',
                            position: 'right',
                            beginAtZero: true,
                            suggestedMax: 100,
                            grid: { drawOnChartArea: false },
                            ticks: { callback: value => value + '%' }
                        }
                    },
                    plugins: {
                        chartBackground: {},
                        tooltip: {
                            callbacks: {
                                label: ctx => {
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

        totalMovementsCount = data.totalMovements || 0;
        renderPagination(totalMovementsCount, currentPage, currentPerPage);

        const movementsTbody = $('#lastMovementsBody');
        movementsTbody.empty();
        if (data.lastMovements && data.lastMovements.length > 0) {
            data.lastMovements.forEach(mov => {
                const leadId = mov.User ? mov.User.telegramId : 'N/A';
                let dtGen = mov.pixGeneratedAt ? new Date(mov.pixGeneratedAt).toLocaleString('pt-BR') : '';
                let dtPaid = mov.purchasedAt ? new Date(mov.purchasedAt).toLocaleString('pt-BR') : '—';
                let statusHtml = mov.status === 'paid' ? `<span style="color:green;font-weight:bold;">Paid</span>` :
                    mov.status === 'pending' ? `<span style="color:#ff9900;font-weight:bold;">Pending</span>` :
                        `<span style="font-weight:bold;">${mov.status}</span>`;
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
            movementsTbody.append(`<tr><td colspan="6">Nenhuma movimentação encontrada</td></tr>`);
        }
    }

    //------------------------------------------------------------
    // refreshDashboard
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

    // Mostra ou esconde #botFilterContainer conforme a aba ativa
    const defaultSection = $('#sidebarNav .nav-link.active').data('section');
    if (defaultSection === 'statsSection' || defaultSection === 'statsDetailedSection') {
        $('#botFilterContainer').show();
    } else {
        $('#botFilterContainer').hide();
    }

    // Eventos de filtros e abas
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
        $('#statsSection, #rankingSimplesSection, #rankingDetalhadoSection, #statsDetailedSection').addClass('d-none');
        const targetSection = $(this).data('section');
        $(`#${targetSection}`).removeClass('d-none');
        if (targetSection === 'statsSection' || targetSection === 'statsDetailedSection') {
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
});