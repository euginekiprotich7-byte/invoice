async function saveEmployer() {
    const nameInput = document.getElementById('newEmployerName');
    const rateInput = document.getElementById('employerRate');
    
    const name = nameInput.value.trim();
    const rate = parseFloat(rateInput.value) || 0;

    if (!name) {
        alert("Please enter a valid Employer Name.");
        return;
    }

    try {
        // 1. Insert into Supabase
        const { data, error } = await supabaseClient
            .from('employers')
            .insert([{ 
                employer_name: name, 
                rate_per_unit: rate // Saved to drive the 'Pages' default price
            }])
            .select();

        if (error) throw error;

        // 2. UI Reset
        nameInput.value = '';
        rateInput.value = '';

        // 3. Auto-Select the new employer
        if (data && data[0]) {
            currentEmployerId = data[0].id;
            currentEmployerRate = data[0].rate_per_unit;
        }

        console.log(`Employer "${name}" registered and selected.`);
        
        // 4. Global Refresh
        // Using renderEmployerList (which we fixed earlier) to show the new tab
        await renderEmployerList(); 
        
    } catch (err) {
        console.error("Error saving employer:", err.message);
        alert("Failed to save employer: " + err.message);
    }
}

async function loadEmployers() {
    const { data, error } = await supabaseClient
        .from('employers')
        .select('*')
        .order('employer_name', { ascending: true });

    if (error) {
        console.error("Failed to load employers:", error.message);
        return;
    }
    
    const container = document.getElementById('employer-tabs');
    if (!container) return;
    
    container.innerHTML = ''; 

    data.forEach(emp => {
        // 1. Tab Wrapper
        const wrapper = document.createElement('div');
        wrapper.className = 'employer-tab-wrapper';
        wrapper.style.cssText = `
            display: inline-flex;
            align-items: center;
            margin: 5px;
            background: #34495e;
            border-radius: 20px;
            transition: all 0.3s ease;
            overflow: hidden;
        `;

        // 2. Main Employer Selection Button
        const btn = document.createElement('button');
        btn.style.cssText = `
            padding: 8px 15px;
            background: transparent;
            border: none;
            color: white;
            font-size: 14px;
            cursor: pointer;
            font-weight: 500;
        `;
        btn.innerText = emp.employer_name;
        
        btn.onclick = () => {
            // Update Global State
            currentEmployerId = emp.id;
            currentEmployerRate = emp.rate_per_unit || 300;

            // Visual Toggle: Reset all, then highlight active
            document.querySelectorAll('#employer-tabs div').forEach(d => {
                d.style.background = '#34495e';
            });
            wrapper.style.background = '#3498db';
            
            // Sync the input form to this boss's rate
            const cppInput = document.getElementById('cpp');
            if (cppInput) cppInput.value = currentEmployerRate;

            // Load the tasks specifically for this view
            fetchTasks(); 
        };

        // 3. Delete Icon (The "X")
        const delBtn = document.createElement('span');
        delBtn.innerHTML = '&times;';
        delBtn.style.cssText = `
            padding: 0 12px;
            cursor: pointer;
            color: #bdc3c7;
            font-size: 18px;
            transition: color 0.2s;
            border-left: 1px solid rgba(255,255,255,0.1);
        `;
        delBtn.onmouseover = () => delBtn.style.color = '#e74c3c';
        delBtn.onmouseout = () => delBtn.style.color = '#bdc3c7';
        
        delBtn.onclick = (e) => {
            e.stopPropagation(); 
            deleteEmployer(emp.id, emp.employer_name);
        };

        wrapper.appendChild(btn);
        wrapper.appendChild(delBtn);
        container.appendChild(wrapper);
    });
}

function switchToEmployer(employer) {
    // 1. Update Global State
    currentEmployerId = employer.id;
    currentEmployerRate = employer.rate_per_unit || 300;
    
    // 2. Visual Feedback: Find the button inside the wrapper and highlight
    document.querySelectorAll('#employer-tabs div').forEach(wrapper => {
        const btn = wrapper.querySelector('button');
        if (btn && btn.innerText === employer.employer_name) {
            wrapper.style.background = '#3498db';
        } else {
            wrapper.style.background = '#34495e';
        }
    });

    // 3. Sync the Price input
    const cppInput = document.getElementById('cpp');
    if (cppInput) cppInput.value = currentEmployerRate;

    // 4. Load the data
    fetchTasksByEmployer(employer.id);
}

async function deleteEmployer(id, name) {
    const confirmDelete = confirm(`Are you sure you want to delete "${name}"?\n\nWarning: Their tasks will remain in the database but will be hidden from the UI.`);
    
    if (!confirmDelete) return;

    try {
        const { error } = await supabaseClient
            .from('employers')
            .delete()
            .eq('id', id);

        if (error) throw error;

        // If the deleted employer was the one currently open, reset the view
        if (currentEmployerId === id) {
            currentEmployerId = null;
            currentEmployerRate = 300;
            
            // Clear all visible tables
            ['tableBody', 'historyBody', 'done-tasks-container', 'pendingPaymentBody'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.innerHTML = '';
            });
        }

        console.log(`Employer ${name} removed.`);
        await loadEmployers(); // Refresh the tab list
        
    } catch (err) {
        alert("Error deleting employer: " + err.message);
    }
}

async function fetchTasksByEmployer(empId) {
    // 1. Offline Check
    if (!navigator.onLine) {
        console.warn("Offline: Using cached data if available.");
        return;
    }

    // 2. Query only tasks for this Employer
    const { data, error } = await supabaseClient
        .from('tasks')
        .select('*')
        .eq('employer_id', empId)
        .order('created_at', { ascending: false });

    if (error) {
        console.error("Fetch error:", error.message);
        return;
    }

    // 3. Distribute data to the specialized tabs
    const activeTasks = data.filter(t => t.status === 'Pending' || t.status === 'Done');
    const invoicedTasks = data.filter(t => t.status === 'Invoiced');
    const historyTasks = data.filter(t => t.status === 'Paid' || t.status === 'Cancelled');

    // 4. Run the Render Engines
    renderActive(activeTasks);
    renderDoneTable(activeTasks.filter(t => t.status === 'Done')); // Only show "Done" in the invoice section
    renderPendingPayment(invoicedTasks);
    renderHistory(historyTasks);

    // 5. Run the Alarm Engine
    checkDeadlines(activeTasks);
}

async function markAsDone(taskId) {
    // 1. Optional: Add a confirmation for accidental clicks
    if (!confirm("Mark this task as completed?")) return;

    try {
        // 2. Perform the update in Supabase
        const { error } = await supabaseClient
            .from('tasks')
            .update({ 
                status: 'Done',
                notified: true // Prevents the alarm from triggering for a finished task
            })
            .eq('id', taskId);

        if (error) throw error;

        console.log(`Task ${taskId} marked as Done.`);

        // 3. CRITICAL: Refresh the UI immediately
        // This moves the task to the "Completed" tab and updates the Green Total box
        await fetchTasks();

    } catch (error) {
        console.error("Update failed:", error);
        alert("Failed to update status. Please check your connection.");
    }
}

async function submitOrder(employerId) {
    // 1. Collect values from the UI
    // Note: It now looks for the 'client' field we defined in your HTML
    const clientName = document.getElementById('client').value.trim();
    const detail = document.getElementById('detail').value.trim();
    const units = parseFloat(document.getElementById('unit').value) || 0;
    const cpp = parseFloat(document.getElementById('cpp').value) || 0;
    const deadline = document.getElementById('deadline').value;

    // 2. Validation
    if (!clientName || !detail || !deadline) {
        alert("Please fill in Client Name, Task Detail, and Deadline");
        return;
    }

    if (!employerId) {
        alert("No Employer selected. Please click an employer tab first.");
        return;
    }

    // 3. Prepare the data object for Supabase
    const newTask = {
        employer_id: employerId,
        client_name: clientName, // This ensures grouping by individual client
        task_detail: detail,
        task_type: document.getElementById('type').value, // Pages, Quiz, etc.
        units: units,
        cpp: cpp,
        payable: units * cpp,
        deadline: deadline,
        status: 'Pending',
        notified: false
    };

    // 4. Insert into Supabase
    try {
        const { error } = await supabaseClient
            .from('tasks')
            .insert([newTask]);

        if (error) throw error;

        // 5. Success Actions
        console.log("Order successfully registered to Cloud.");
        
        // Clear the inputs using our helper
        if (typeof clearTaskInputs === 'function') {
            clearTaskInputs();
        }

        // Refresh the tables to show the new grouping
        await fetchTasks();
        
        // Provide small feedback instead of an annoying alert if possible
        console.log("UI Refreshed with new order.");

    } catch (err) {
        console.error("Submission Error:", err.message);
        alert("Error saving order: " + err.message);
    }
}