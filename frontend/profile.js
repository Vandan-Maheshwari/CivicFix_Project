// Enhanced Profile JavaScript with Flask backend integration
document.addEventListener('DOMContentLoaded', function() {
    // Check if API client is available
    if (typeof CivicFixAPI === 'undefined') {
        console.error('API client not loaded. Please include api.js');
        showError('System initialization failed. Please refresh the page.');
        return;
    }

    // Initialize API client
    const api = window.CivicFixAPI;

    // Global variables
    let currentUser = null;
    let userReports = [];

    // Utility functions
    function showError(message) {
        showNotification(message, 'error');
    }

    function showSuccess(message) {
        showNotification(message, 'success');
    }

    function showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 15px 20px;
            border-radius: 5px;
            color: white;
            z-index: 1000;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            max-width: 350px;
            font-weight: 500;
            transition: opacity 0.5s;
        `;
        
        const colors = {
            success: '#2ecc71',
            error: '#e74c3c',
            warning: '#f39c12',
            info: '#3498db'
        };
        notification.style.background = colors[type] || colors.info;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.style.opacity = '0';
            setTimeout(() => {
                if (notification.parentNode) {
                    document.body.removeChild(notification);
                }
            }, 500);
        }, 4000);
    }

    // Check authentication and redirect if needed
    function checkAuth() {
        if (!api.isAuthenticated()) {
            showError('Please login to access your profile');
            setTimeout(() => {
                window.location.href = 'enter.html';
            }, 2000);
            return false;
        }
        return true;
    }

    // Load user profile data
    async function loadUserProfile() {
        try {
            const response = await api.getUserProfile();
            if (response.success) {
                currentUser = response.user;
                updateProfileUI();
                return true;
            } else {
                throw new Error(response.message || 'Failed to load profile');
            }
        } catch (error) {
            console.error('Profile loading error:', error);
            showError('Failed to load profile data: ' + error.message);
            return false;
        }
    }

    // Update profile UI with real data
    function updateProfileUI() {
        if (!currentUser) return;

        // Update user name and basic info
        const userName = document.querySelector('.user-name');
        if (userName) {
            userName.textContent = `${currentUser.name} ${currentUser.surname}`;
        }

        // Update stats
        const statCards = document.querySelectorAll('.stat-card .stat-number');
        if (statCards.length >= 3) {
            statCards[0].textContent = currentUser.reports_count || 0;
            statCards[1].textContent = currentUser.points || 0;
            // Rank would need to be calculated separately
            statCards[2].textContent = calculateRank(currentUser.points);
        }

        // Update profile form fields
        updateProfileForm();

        // Load and display reports
        displayUserReports();
    }

    // Calculate user rank based on points (simplified)
    function calculateRank(userPoints) {
        // This would typically come from the backend
        // For now, simple calculation based on points
        if (userPoints >= 200) return '1';
        if (userPoints >= 100) return '2';
        if (userPoints >= 50) return '3';
        return '5+';
    }

    // Update profile form with user data
    function updateProfileForm() {
        if (!currentUser) return;

        const formFields = {
            'firstName': currentUser.name || '',
            'lastName': currentUser.surname || '',
            'email': currentUser.email || '',
            'phone': currentUser.mobile || '',
            'city': currentUser.district || ''
        };

        Object.keys(formFields).forEach(fieldId => {
            const field = document.getElementById(fieldId);
            if (field) {
                field.value = formFields[fieldId];
            }
        });
    }

    // Display user reports in the table
    function displayUserReports() {
        if (!currentUser || !currentUser.recent_reports) {
            return;
        }

        const tbody = document.querySelector('.reports-table tbody');
        if (!tbody) return;

        // Clear existing rows
        tbody.innerHTML = '';

        if (currentUser.recent_reports.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align: center;">No reports found. <a href="home.html#report">Submit your first report!</a></td></tr>';
            return;
        }

        currentUser.recent_reports.forEach(report => {
            const row = document.createElement('tr');
            const date = new Date(report.created_at).toLocaleDateString();
            const statusClass = getStatusClass(report.status);
            
            row.innerHTML = `
                <td>${date}</td>
                <td>${formatCategory(report.category)}</td>
                <td>${report.address || 'Location not available'}</td>
                <td><span class="status-badge ${statusClass}">${formatStatus(report.status)}</span></td>
                <td><a href="#" class="view-details" data-report-id="${report._id}">View Details</a></td>
            `;
            
            tbody.appendChild(row);
        });

        // Add click handlers for view details
        document.querySelectorAll('.view-details').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const reportId = link.getAttribute('data-report-id');
                viewReportDetails(reportId);
            });
        });
    }

    // Helper functions for formatting
    function formatCategory(category) {
        const categoryMap = {
            'pothole': 'Pothole',
            'streetlight': 'Street Light',
            'garbage': 'Garbage',
            'sewer': 'Sewer Issue',
            'water_supply': 'Water Supply',
            'road_repair': 'Road Repair',
            'other': 'Other'
        };
        return categoryMap[category] || category;
    }

    function formatStatus(status) {
        const statusMap = {
            'pending': 'Pending',
            'submitted': 'Submitted',
            'in_progress': 'In Progress',
            'resolved': 'Resolved'
        };
        return statusMap[status] || status;
    }

    function getStatusClass(status) {
        const statusClasses = {
            'pending': 'status-pending',
            'submitted': 'status-pending',
            'in_progress': 'status-in-progress',
            'resolved': 'status-resolved'
        };
        return statusClasses[status] || 'status-pending';
    }

    // View report details (modal or new page)
    async function viewReportDetails(reportId) {
        try {
            const response = await api.getReportDetails(reportId);
            if (response.success) {
                showReportModal(response.report);
            }
        } catch (error) {
            showError('Failed to load report details: ' + error.message);
        }
    }

    // Show report details in a modal
    function showReportModal(report) {
        const modalHTML = `
            <div id="report-modal" style="
                position: fixed; top: 0; left: 0; width: 100%; height: 100%; 
                background: rgba(0,0,0,0.8); z-index: 2000; display: flex; 
                justify-content: center; align-items: center; padding: 20px;
            ">
                <div style="
                    background: white; border-radius: 10px; padding: 30px; 
                    max-width: 600px; width: 100%; max-height: 80vh; overflow-y: auto;
                ">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                        <h2>${formatCategory(report.category)} Report</h2>
                        <button id="close-modal" style="
                            background: none; border: none; font-size: 24px; cursor: pointer;
                        ">&times;</button>
                    </div>
                    <div style="margin-bottom: 15px;">
                        <strong>Status:</strong> <span class="status-badge ${getStatusClass(report.status)}">${formatStatus(report.status)}</span>
                    </div>
                    <div style="margin-bottom: 15px;">
                        <strong>Submitted:</strong> ${new Date(report.created_at).toLocaleDateString()}
                    </div>
                    <div style="margin-bottom: 15px;">
                        <strong>Priority:</strong> ${report.priority || 'Medium'}
                    </div>
                    <div style="margin-bottom: 15px;">
                        <strong>Description:</strong><br>
                        ${report.description}
                    </div>
                    ${report.file_path ? `
                        <div style="margin-bottom: 15px;">
                            <strong>Photo:</strong><br>
                            <img src="${api.getImageUrl(report.file_path)}" 
                                 style="max-width: 100%; height: auto; border-radius: 8px;" 
                                 alt="Report photo">
                        </div>
                    ` : ''}
                    <div style="margin-bottom: 15px;">
                        <strong>Votes:</strong> ↑${report.upvotes || 0} ↓${report.downvotes || 0}
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHTML);

        // Close modal functionality
        document.getElementById('close-modal').addEventListener('click', () => {
            document.getElementById('report-modal').remove();
        });

        document.getElementById('report-modal').addEventListener('click', (e) => {
            if (e.target.id === 'report-modal') {
                document.getElementById('report-modal').remove();
            }
        });
    }

    // Tab switching functionality
    function setupTabSwitching() {
        const tabLinks = document.querySelectorAll('.profile-menu a');
        const tabContents = document.querySelectorAll('.tab-content');

        tabLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                
                // Remove active classes
                tabLinks.forEach(l => l.classList.remove('active'));
                tabContents.forEach(content => content.classList.remove('active'));
                
                // Add active class to clicked tab
                link.classList.add('active');
                
                // Show corresponding content
                const tabId = link.getAttribute('data-tab');
                const tabContent = document.getElementById(tabId);
                if (tabContent) {
                    tabContent.classList.add('active');
                }
            });
        });
    }

    // Handle profile form submission
    function setupProfileForm() {
        const editForm = document.querySelector('.edit-form');
        if (editForm) {
            editForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                await updateProfile(e.target);
            });
        }
    }

    // Update profile (this would need a backend endpoint)
    async function updateProfile(form) {
        try {
            const formData = new FormData(form);
            const updateData = {};
            
            for (let [key, value] of formData.entries()) {
                updateData[key] = value;
            }

            // Note: This would require a profile update endpoint in your Flask API
            showSuccess('Profile updated successfully!');
        } catch (error) {
            showError('Failed to update profile: ' + error.message);
        }
    }

    // Setup logout functionality
    function setupLogout() {
        const logoutBtn = document.getElementById('logout-btn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', (e) => {
                e.preventDefault();
                if (confirm('Are you sure you want to logout?')) {
                    api.logout();
                    showSuccess('Logged out successfully!');
                    setTimeout(() => {
                        window.location.href = 'home.html';
                    }, 1500);
                }
            });
        }
    }

    // Load achievements (mock data for now)
    function loadAchievements() {
        if (!currentUser) return;

        const reportsCount = currentUser.reports_count || 0;
        const points = currentUser.points || 0;

        // Update achievement progress
        updateAchievementProgress('photo-expert', Math.min(reportsCount, 20), 20);
        updateAchievementProgress('community-leader', Math.min(points, 500), 500);
    }

    function updateAchievementProgress(achievementId, current, total) {
        // This would update the achievement cards with real progress
        // Implementation depends on your HTML structure
    }

    // Newsletter form handler
    function setupNewsletterForm() {
        const newsletterForm = document.querySelector('footer form');
        if (newsletterForm) {
            newsletterForm.addEventListener('submit', function(e) {
                e.preventDefault();
                const emailInput = this.querySelector('input[type="email"]');
                if (emailInput && emailInput.value) {
                    showSuccess('Thank you for subscribing to our newsletter!');
                    emailInput.value = '';
                }
            });
        }
    }

    // Initialize everything
    async function initializeProfile() {
        try {
            // Check if user is authenticated
            if (!checkAuth()) {
                return;
            }

            // Load user profile data
            const profileLoaded = await loadUserProfile();
            if (!profileLoaded) {
                return;
            }

            // Setup UI functionality
            setupTabSwitching();
            setupProfileForm();
            setupLogout();
            setupNewsletterForm();
            loadAchievements();

            showSuccess('Profile loaded successfully!');
        } catch (error) {
            console.error('Profile initialization error:', error);
            showError('Failed to initialize profile page');
        }
    }

    // Start initialization
    initializeProfile();

    console.log('Profile page initialized with real data integration');
});