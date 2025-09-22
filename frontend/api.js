// Enhanced API Integration Module for CivicFix Frontend
// Fixed with proper authentication flow and error handling

class CivicFixAPI {
    constructor() {
        // Update this URL to match your Flask server
        this.baseURL = 'http://localhost:5000/api';
        this.token = null;
        
        // Initialize from localStorage
        this.loadFromStorage();
        
        // Set up periodic token validation
        this.setupTokenValidation();
    }

    // Load authentication data from localStorage
    loadFromStorage() {
        try {
            this.token = localStorage.getItem('auth_token');
            const userData = localStorage.getItem('user_data');
            this.currentUser = userData ? JSON.parse(userData) : null;
        } catch (error) {
            console.error('Error loading from storage:', error);
            this.clearStorage();
        }
    }

    // Clear authentication data
    clearStorage() {
        this.token = null;
        this.currentUser = null;
        localStorage.removeItem('auth_token');
        localStorage.removeItem('user_data');
    }

    // Save authentication data
    saveToStorage(token, user) {
        this.token = token;
        this.currentUser = user;
        localStorage.setItem('auth_token', token);
        localStorage.setItem('user_data', JSON.stringify(user));
    }

    // Setup periodic token validation
    setupTokenValidation() {
        // Check token validity every 5 minutes
        setInterval(() => {
            if (this.isAuthenticated()) {
                this.validateToken();
            }
        }, 5 * 60 * 1000);
    }

    // Validate token with server
    async validateToken() {
        try {
            await this.getUserProfile();
        } catch (error) {
            if (error.message.includes('Token') || error.message.includes('401')) {
                console.warn('Token expired or invalid, logging out');
                this.logout();
            }
        }
    }

    // Helper method to make API calls
    async apiCall(endpoint, options = {}) {
        const url = `${this.baseURL}${endpoint}`;
        const headers = {
            ...options.headers
        };

        // Only set Content-Type for JSON requests, not FormData
        if (!(options.body instanceof FormData)) {
            headers['Content-Type'] = 'application/json';
        }

        if (this.token && !options.skipAuth) {
            headers['Authorization'] = `Bearer ${this.token}`;
        }

        try {
            const response = await fetch(url, {
                ...options,
                headers,
                mode: 'cors',
                credentials: 'omit'
            });

            let data;
            const contentType = response.headers.get('content-type');
            
            if (contentType && contentType.includes('application/json')) {
                data = await response.json();
            } else {
                const text = await response.text();
                throw new Error(`Server returned non-JSON response: ${text.substring(0, 200)}`);
            }
            
            if (!response.ok) {
                // Handle authentication errors
                if (response.status === 401 && !options.skipAuth) {
                    this.logout();
                    throw new Error('Session expired. Please login again.');
                }
                throw new Error(data.error || data.message || `HTTP error! status: ${response.status}`);
            }

            return data;
        } catch (error) {
            console.error('API call failed:', {
                url,
                error: error.message,
                options: { ...options, body: options.body instanceof FormData ? '[FormData]' : options.body }
            });
            
            // Handle network errors
            if (error.name === 'TypeError' && error.message.includes('fetch')) {
                throw new Error('Unable to connect to server. Please check your connection and ensure the server is running.');
            }
            
            throw error;
        }
    }

    // Authentication Methods
    async register(userData) {
        try {
            const response = await this.apiCall('/register', {
                method: 'POST',
                body: JSON.stringify(userData),
                skipAuth: true
            });

            if (response.success && response.token) {
                this.saveToStorage(response.token, response.user);
                return response;
            } else {
                throw new Error(response.message || 'Registration failed');
            }
        } catch (error) {
            console.error('Registration error:', error);
            throw error;
        }
    }

    async login(credentials) {
        try {
            const response = await this.apiCall('/login', {
                method: 'POST',
                body: JSON.stringify(credentials),
                skipAuth: true
            });

            if (response.success && response.token) {
                this.saveToStorage(response.token, response.user);
                return response;
            } else {
                throw new Error(response.message || 'Login failed');
            }
        } catch (error) {
            console.error('Login error:', error);
            throw error;
        }
    }

    logout() {
        this.clearStorage();
        // Redirect to home page
        if (typeof window !== 'undefined') {
            window.location.href = 'home.html';
        }
    }

    // User Profile Methods
    async getUserProfile() {
        try {
            const response = await this.apiCall('/profile', {
                method: 'GET'
            });

            if (response.success) {
                // Update stored user data
                this.currentUser = response.user;
                localStorage.setItem('user_data', JSON.stringify(response.user));
                return response;
            } else {
                throw new Error(response.message || 'Failed to fetch profile');
            }
        } catch (error) {
            console.error('Profile fetch error:', error);
            throw error;
        }
    }

    async updateProfile(profileData) {
        try {
            const response = await this.apiCall('/profile', {
                method: 'PUT',
                body: JSON.stringify(profileData)
            });

            if (response.success) {
                // Refresh profile data
                await this.getUserProfile();
                return response;
            } else {
                throw new Error(response.message || 'Failed to update profile');
            }
        } catch (error) {
            console.error('Profile update error:', error);
            throw error;
        }
    }

    async changePassword(passwordData) {
        try {
            const response = await this.apiCall('/change-password', {
                method: 'POST',
                body: JSON.stringify(passwordData)
            });

            if (response.success) {
                return response;
            } else {
                throw new Error(response.message || 'Failed to change password');
            }
        } catch (error) {
            console.error('Password change error:', error);
            throw error;
        }
    }

    // Report Methods
    async submitReport(reportData, imageFile = null) {
        try {
            if (imageFile) {
                // If image file is provided, use FormData
                const formData = new FormData();
                Object.keys(reportData).forEach(key => {
                    if (reportData[key] !== null && reportData[key] !== undefined) {
                        formData.append(key, reportData[key]);
                    }
                });
                formData.append('image', imageFile);

                return await this.apiCall('/submit-report', {
                    method: 'POST',
                    body: formData,
                    headers: {}, // Let browser set Content-Type for FormData
                    skipAuth: !this.token // Allow anonymous reports
                });
            } else {
                // Regular JSON submission
                return await this.apiCall('/submit-report', {
                    method: 'POST',
                    body: JSON.stringify(reportData),
                    skipAuth: !this.token
                });
            }
        } catch (error) {
            console.error('Submit report error:', error);
            throw error;
        }
    }

    async getReports(filters = {}) {
        const queryParams = new URLSearchParams();
        Object.keys(filters).forEach(key => {
            if (filters[key] !== null && filters[key] !== undefined && filters[key] !== '') {
                queryParams.append(key, filters[key]);
            }
        });
        
        const queryString = queryParams.toString();
        return await this.apiCall(`/reports${queryString ? '?' + queryString : ''}`, {
            method: 'GET',
            skipAuth: true
        });
    }

    async getReportDetails(reportId) {
        return await this.apiCall(`/reports/${reportId}`, {
            method: 'GET',
            skipAuth: true
        });
    }

    // Utility Methods
    async getLeaderboard(limit = 10) {
        return await this.apiCall(`/leaderboard?limit=${limit}`, {
            method: 'GET',
            skipAuth: true
        });
    }

    async healthCheck() {
        return await this.apiCall('/health', {
            method: 'GET',
            skipAuth: true
        });
    }

    // Authentication status
    isAuthenticated() {
        return !!(this.token && this.currentUser);
    }

    getCurrentUser() {
        return this.currentUser;
    }

    getImageUrl(fileId) {
        return `${this.baseURL}/image/${fileId}`;
    }

    // Server connection test
    async testConnection() {
        try {
            const response = await this.healthCheck();
            return response.success;
        } catch (error) {
            console.error('Connection test failed:', error);
            return false;
        }
    }

    // Navigation helpers
    redirectToLogin() {
        if (typeof window !== 'undefined') {
            window.location.href = 'enter.html';
        }
    }

    redirectToProfile() {
        if (typeof window !== 'undefined') {
            window.location.href = 'profile.html';
        }
    }

    redirectToHome() {
        if (typeof window !== 'undefined') {
            window.location.href = 'home.html';
        }
    }

    // Update auth UI across all pages
    updateAuthUI() {
        const authButtons = document.querySelector('.auth-buttons');
        if (!authButtons) return;
        
        if (this.isAuthenticated()) {
            const user = this.getCurrentUser();
            authButtons.innerHTML = `
                <a href="profile.html" class="btn btn-login" style="margin-right: 15px;">
                    <i class="fas fa-user"></i> ${user.name}
                </a>
                <a href="#" id="logout-btn" class="btn btn-signup">Logout</a>
            `;
            
            // Add logout event listener
            const logoutBtn = document.getElementById('logout-btn');
            if (logoutBtn) {
                logoutBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    if (confirm('Are you sure you want to logout?')) {
                        this.logout();
                    }
                });
            }
        } else {
            authButtons.innerHTML = `
                <a href="enter.html" class="btn btn-login">Login</a>
                <a href="enter.html" class="btn btn-signup">Sign up</a>
            `;
        }
    }

    // Check authentication status on page load
    checkAuthOnLoad() {
        const currentPage = window.location.pathname.split('/').pop();
        
        // Pages that require authentication
        const protectedPages = ['profile.html'];
        
        // Pages that logged-in users shouldn't access
        const guestOnlyPages = ['enter.html'];
        
        if (protectedPages.includes(currentPage) && !this.isAuthenticated()) {
            console.warn('Access denied: Authentication required');
            this.redirectToLogin();
            return false;
        }
        
        if (guestOnlyPages.includes(currentPage) && this.isAuthenticated()) {
            console.info('Redirecting authenticated user to profile');
            this.redirectToProfile();
            return false;
        }
        
        // Update UI for current auth state
        this.updateAuthUI();
        return true;
    }
}

// Initialize API client
const api = new CivicFixAPI();

// Auto-check authentication when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    api.checkAuthOnLoad();
});

// Test connection on load
api.testConnection().then(connected => {
    if (connected) {
        console.log('Successfully connected to CivicFix backend');
    } else {
        console.warn('Could not connect to CivicFix backend. Please ensure the Flask server is running on http://localhost:5000');
        
        // Show connection error to user
        const showConnectionError = () => {
            const notification = document.createElement('div');
            notification.innerHTML = `
                <div style="
                    position: fixed; top: 20px; right: 20px; 
                    background: #e74c3c; color: white; 
                    padding: 15px 20px; border-radius: 5px; 
                    z-index: 1000; max-width: 300px;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                ">
                    <strong>Connection Error</strong><br>
                    Cannot connect to server. Please ensure the Flask backend is running.
                </div>
            `;
            document.body.appendChild(notification);
            
            setTimeout(() => {
                if (notification.parentNode) {
                    document.body.removeChild(notification);
                }
            }, 10000);
        };
        
        // Show error after page loads
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', showConnectionError);
        } else {
            showConnectionError();
        }
    }
}).catch(error => {
    console.error('Connection test error:', error);
});

// Export for use in other files
if (typeof window !== 'undefined') {
    window.CivicFixAPI = api;
}

// For Node.js environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CivicFixAPI;
}