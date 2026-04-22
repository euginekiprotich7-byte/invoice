async function updatePerformanceGraph() {
    const ctx = document.getElementById('performanceChart');
    if (!ctx) return;

    try {
        const { data, error } = await supabaseClient
            .from('performance_history')
            .select('submission_date, final_payable')
            .order('submission_date', { ascending: true })
            .limit(7);

        if (error) throw error;

        const labels = data.map(d => new Date(d.submission_date).toLocaleDateString());
        const values = data.map(d => d.final_payable);

        if (window.myChart) window.myChart.destroy();

        window.myChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Earnings (KES)',
                    data: values,
                    borderColor: '#27ae60',
                    tension: 0.3,
                    fill: true,
                    backgroundColor: 'rgba(39, 174, 96, 0.1)'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } }
            }
        });
    } catch (err) {
        console.error("Chart Error:", err.message);
    }
}