// sql_complaint_form.js
document.addEventListener('DOMContentLoaded', function() {
    const complaintForm = document.querySelector('form');

    if (!complaintForm) {
        console.error('Complaint form not found. Please check the HTML file.');
        return;
    }

    complaintForm.addEventListener('submit', async function(e) {
        e.preventDefault(); // Prevents the default form submission

        const formData = new FormData(complaintForm);
        const data = {};
        for (const [key, value] of formData.entries()) {
            data[key] = value;
        }

        try {
            // Send the data to your new Flask backend for SQL
            const response = await fetch('http://localhost:5001/api/sql-submit-complaint', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data),
            });

            const result = await response.json();

            if (response.ok) {
                alert('Complaint submitted successfully to SQL database!');
                complaintForm.reset(); // Clear the form
            } else {
                alert(`Error: ${result.message}`);
            }
        } catch (error) {
            console.error('Submission failed:', error);
            alert('Failed to connect to the SQL server. Please ensure it is running.');
        }
    });
});